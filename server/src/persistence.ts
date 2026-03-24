import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import type { IndexerSnapshot } from "../../packages/indexer-server-core/src/index.ts";
import {
  rawToState,
  TABLE_NAMES,
  type TableName,
} from "../../packages/indexer-server-core/src/index.ts";

// ---------------------------------------------------------------------------
// v1 tables (existing)
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    block_number INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`;

const CREATE_METADATA_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`;

// ---------------------------------------------------------------------------
// v2 chunk tables (Phase 1)
// ---------------------------------------------------------------------------

const CREATE_SNAPSHOT_CHUNKS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS snapshot_chunks (
    snapshot_block INTEGER NOT NULL,
    table_name TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    encoding TEXT NOT NULL,
    payload BLOB NOT NULL,
    payload_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (snapshot_block, table_name, chunk_index)
  )
`;

const CREATE_SNAPSHOT_CHUNKS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_snapshot_chunks_table
  ON snapshot_chunks (table_name, snapshot_block, chunk_index)
`;

const CREATE_SNAPSHOT_MANIFESTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS snapshot_manifests (
    snapshot_block INTEGER PRIMARY KEY,
    chunk_rows INTEGER NOT NULL,
    manifest_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

// ---------------------------------------------------------------------------
// SQL statements
// ---------------------------------------------------------------------------

const UPSERT_SQL = `
  INSERT INTO snapshots (id, block_number, data, updated_at)
  VALUES (1, ?, ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    block_number = excluded.block_number,
    data = excluded.data,
    updated_at = datetime('now')
`;

const SELECT_SQL = `SELECT block_number, data FROM snapshots WHERE id = 1`;
const DELETE_SNAPSHOTS_SQL = `DELETE FROM snapshots`;
const SELECT_SNAPSHOT_COUNT_SQL = `SELECT COUNT(*) AS count FROM snapshots`;
const SELECT_METADATA_SQL = `SELECT value FROM metadata WHERE key = ?`;
const UPSERT_METADATA_SQL = `
  INSERT INTO metadata (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = datetime('now')
`;

const UPSERT_CHUNK_SQL = `
  INSERT INTO snapshot_chunks
    (snapshot_block, table_name, chunk_index, row_count, encoding, payload, payload_hash, created_at)
  VALUES (?, ?, ?, ?, 'gzip', ?, ?, datetime('now'))
  ON CONFLICT(snapshot_block, table_name, chunk_index) DO UPDATE SET
    row_count = excluded.row_count,
    encoding = excluded.encoding,
    payload = excluded.payload,
    payload_hash = excluded.payload_hash,
    created_at = datetime('now')
`;

const UPSERT_MANIFEST_SQL = `
  INSERT INTO snapshot_manifests (snapshot_block, chunk_rows, manifest_json, created_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(snapshot_block) DO UPDATE SET
    chunk_rows = excluded.chunk_rows,
    manifest_json = excluded.manifest_json,
    created_at = datetime('now')
`;

const SELECT_CHUNK_COUNT_FOR_BLOCK_SQL = `
  SELECT table_name, COUNT(*) AS cnt
  FROM snapshot_chunks
  WHERE snapshot_block = ?
  GROUP BY table_name
`;

const SELECT_MANIFEST_BY_BLOCK_SQL = `
  SELECT chunk_rows, manifest_json
  FROM snapshot_manifests
  WHERE snapshot_block = ?
`;

const SELECT_CHUNK_BY_BLOCK_SQL = `
  SELECT encoding, payload
  FROM snapshot_chunks
  WHERE snapshot_block = ? AND table_name = ? AND chunk_index = ?
`;

const SELECT_ALL_CHUNKS_BY_BLOCK_SQL = `
  SELECT table_name, chunk_index, encoding, payload
  FROM snapshot_chunks
  WHERE snapshot_block = ?
  ORDER BY table_name, chunk_index
`;

const DELETE_OLD_CHUNKS_SQL = `
  DELETE FROM snapshot_chunks WHERE snapshot_block NOT IN (?, ?)
`;

const DELETE_OLD_MANIFESTS_SQL = `
  DELETE FROM snapshot_manifests WHERE snapshot_block NOT IN (?, ?)
`;

const DELETE_ALL_CHUNKS_SQL = `DELETE FROM snapshot_chunks`;
const DELETE_ALL_MANIFESTS_SQL = `DELETE FROM snapshot_manifests`;

const DEFAULT_CHUNK_ROWS = 1000;

const METADATA_KEY_SNAPSHOT_SCHEMA_VERSION = "snapshot_schema_version";

export interface SnapshotStoreVersionOptions {
  dbSchemaVersion?: number;
  snapshotSchemaVersion?: number;
  chunkRows?: number;
}

export interface StoredChunkManifest {
  chunkRows: number;
  lastProcessedBlock: number;
  tables: Record<
    TableName,
    {
      chunkCount: number;
      rowCount: number;
    }
  >;
  version: 2;
}

export interface StoredEncodedChunk {
  chunkCount: number;
  chunkRows: number;
  encoding: "gzip" | "br";
  jsonByteLength: number;
  payload: Buffer;
  snapshotBlock: number;
}

export interface StoredSnapshotPayload {
  blockNumber: number;
  jsonByteLength: number;
  jsonString: string;
}

export interface StoredSnapshotSummary {
  blockNumber: number;
  jsonByteLength: number;
}

export class SnapshotStore {
  private db: Database.Database;
  private cachedActiveSnapshotPayload: StoredSnapshotPayload | null = null;
  private cachedActiveSnapshotPayloadBlock: number | null = null;
  private lastPersistTime = 0;
  private readonly dbSchemaVersion: number;
  private readonly snapshotSchemaVersion: number;
  private readonly minIntervalMs: number;
  private readonly chunkRows: number;
  // v1 statements
  private readonly countSnapshotsStmt: Database.Statement;
  private readonly deleteSnapshotsStmt: Database.Statement;
  private readonly deleteAllChunksStmt: Database.Statement;
  private readonly deleteAllManifestsStmt: Database.Statement;
  private readonly selectMetadataStmt: Database.Statement;
  private readonly upsertMetadataStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly selectStmt: Database.Statement;
  // v2 chunk statements
  private readonly upsertChunkStmt: Database.Statement;
  private readonly upsertManifestStmt: Database.Statement;
  private readonly selectChunkCountsStmt: Database.Statement;
  private readonly selectManifestByBlockStmt: Database.Statement;
  private readonly selectChunkByBlockStmt: Database.Statement;
  private readonly selectAllChunksByBlockStmt: Database.Statement;
  private readonly deleteOldChunksStmt: Database.Statement;
  private readonly deleteOldManifestsStmt: Database.Statement;
  /** Previous active block — used for retention (keep N=2).
   *  Initialized from metadata on construction so it survives restarts. */
  private previousActiveBlock: number | null = null;

  constructor(
    dbPath: string,
    minIntervalSec: number,
    versionOptions: SnapshotStoreVersionOptions = {},
  ) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    // v1 tables
    this.db.exec(CREATE_TABLE_SQL);
    this.db.exec(CREATE_METADATA_TABLE_SQL);
    // v2 chunk tables
    this.db.exec(CREATE_SNAPSHOT_CHUNKS_TABLE_SQL);
    this.db.exec(CREATE_SNAPSHOT_CHUNKS_INDEX_SQL);
    this.db.exec(CREATE_SNAPSHOT_MANIFESTS_TABLE_SQL);

    this.dbSchemaVersion = Math.max(1, versionOptions.dbSchemaVersion ?? 1);
    this.snapshotSchemaVersion = Math.max(
      1,
      versionOptions.snapshotSchemaVersion ?? 1,
    );
    this.minIntervalMs = minIntervalSec * 1000;
    this.chunkRows = versionOptions.chunkRows ?? DEFAULT_CHUNK_ROWS;
    // v1 prepared statements
    this.countSnapshotsStmt = this.db.prepare(SELECT_SNAPSHOT_COUNT_SQL);
    this.deleteSnapshotsStmt = this.db.prepare(DELETE_SNAPSHOTS_SQL);
    this.deleteAllChunksStmt = this.db.prepare(DELETE_ALL_CHUNKS_SQL);
    this.deleteAllManifestsStmt = this.db.prepare(DELETE_ALL_MANIFESTS_SQL);
    this.selectMetadataStmt = this.db.prepare(SELECT_METADATA_SQL);
    this.upsertMetadataStmt = this.db.prepare(UPSERT_METADATA_SQL);
    this.upsertStmt = this.db.prepare(UPSERT_SQL);
    this.selectStmt = this.db.prepare(SELECT_SQL);
    // v2 prepared statements
    this.upsertChunkStmt = this.db.prepare(UPSERT_CHUNK_SQL);
    this.upsertManifestStmt = this.db.prepare(UPSERT_MANIFEST_SQL);
    this.selectChunkCountsStmt = this.db.prepare(
      SELECT_CHUNK_COUNT_FOR_BLOCK_SQL,
    );
    this.selectManifestByBlockStmt = this.db.prepare(
      SELECT_MANIFEST_BY_BLOCK_SQL,
    );
    this.selectChunkByBlockStmt = this.db.prepare(SELECT_CHUNK_BY_BLOCK_SQL);
    this.selectAllChunksByBlockStmt = this.db.prepare(
      SELECT_ALL_CHUNKS_BY_BLOCK_SQL,
    );
    this.deleteOldChunksStmt = this.db.prepare(DELETE_OLD_CHUNKS_SQL);
    this.deleteOldManifestsStmt = this.db.prepare(DELETE_OLD_MANIFESTS_SQL);

    this.ensureSchemaVersions();

    // Initialize previousActiveBlock from metadata so cleanup survives restarts
    this.previousActiveBlock = this.getMetadataInt("active_snapshot_block");
  }

  /**
   * Save snapshot JSON string to SQLite. Respects minimum interval.
   * Dual-writes to both v1 (single-row) and v2 (chunk) tables.
   * Returns true if saved, false if skipped (too soon).
   */
  save(blockNumber: number, jsonString: string): boolean {
    const now = Date.now();
    if (now - this.lastPersistTime < this.minIntervalMs) {
      return false;
    }
    this.dualWrite(blockNumber, jsonString);
    this.lastPersistTime = now;
    console.log(`[Persistence] Saved snapshot at block ${blockNumber}`);
    return true;
  }

  /** Force save regardless of interval (e.g. on shutdown). */
  forceSave(blockNumber: number, jsonString: string): void {
    this.dualWrite(blockNumber, jsonString);
    this.lastPersistTime = Date.now();
    console.log(`[Persistence] Force-saved snapshot at block ${blockNumber}`);
  }

  /**
   * Restore snapshot from SQLite. Returns parsed JSON object and block number,
   * or null if no snapshot exists. Caller converts to IndexerSnapshot Maps.
   */
  restore(): { blockNumber: number; data: Record<string, unknown> } | null {
    const row = this.selectStmt.get() as
      | { block_number: number; data: string }
      | undefined;
    if (!row) return null;
    try {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      console.log(
        `[Persistence] Restored snapshot from block ${row.block_number}`,
      );
      return { blockNumber: row.block_number, data };
    } catch (err) {
      console.warn("[Persistence] Failed to parse stored snapshot:", err);
      return null;
    }
  }

  /**
   * Read active v2 manifest from SQLite for a specific chunkRows request.
   * Returns null if no active manifest exists or chunkRows does not match.
   */
  getActiveChunkManifest(
    requestedChunkRows: number,
  ): StoredChunkManifest | null {
    if (!Number.isInteger(requestedChunkRows) || requestedChunkRows <= 0) {
      return null;
    }
    const activeBlock = this.getMetadataInt("active_snapshot_block");
    if (activeBlock == null) return null;

    const row = this.selectManifestByBlockStmt.get(activeBlock) as
      | { chunk_rows: number; manifest_json: string }
      | undefined;
    if (!row) return null;
    if (row.chunk_rows !== requestedChunkRows) return null;

    return parseStoredManifest(row.manifest_json);
  }

  /**
   * Read the active snapshot payload using the store's version pointer.
   * Prefers the legacy v1 row only when it matches the active block exactly;
   * otherwise reconstructs from active v2 chunks to preserve version coherence.
   */
  getActiveSnapshotPayload(): StoredSnapshotPayload | null {
    const activeBlock = this.getMetadataInt("active_snapshot_block");
    if (activeBlock == null) return null;
    if (
      this.cachedActiveSnapshotPayload &&
      this.cachedActiveSnapshotPayloadBlock === activeBlock
    ) {
      return this.cachedActiveSnapshotPayload;
    }

    const row = this.selectStmt.get() as
      | { block_number: number; data: string }
      | undefined;
    if (row && row.block_number === activeBlock) {
      try {
        JSON.parse(row.data);
        const payload = {
          blockNumber: row.block_number,
          jsonByteLength: Buffer.byteLength(row.data),
          jsonString: row.data,
        };
        this.cachedActiveSnapshotPayload = payload;
        this.cachedActiveSnapshotPayloadBlock = activeBlock;
        return payload;
      } catch (err) {
        console.warn(
          "[Persistence] Failed to parse active v1 snapshot row; reconstructing from v2:",
          err,
        );
      }
    }

    const manifestRow = this.selectManifestByBlockStmt.get(activeBlock) as
      | { chunk_rows: number; manifest_json: string }
      | undefined;
    if (!manifestRow) return null;
    const manifest = parseStoredManifest(manifestRow.manifest_json);
    if (!manifest) return null;
    if (manifest.lastProcessedBlock !== activeBlock) {
      console.warn(
        `[Persistence] Active manifest block mismatch: metadata=${activeBlock} manifest=${manifest.lastProcessedBlock}`,
      );
      return null;
    }
    const payload = this.reconstructSnapshotPayload(activeBlock, manifest);
    if (payload) {
      this.cachedActiveSnapshotPayload = payload;
      this.cachedActiveSnapshotPayloadBlock = activeBlock;
    }
    return payload;
  }

  getActiveSnapshotSummary(): StoredSnapshotSummary | null {
    const payload = this.getActiveSnapshotPayload();
    if (!payload) return null;
    return {
      blockNumber: payload.blockNumber,
      jsonByteLength: payload.jsonByteLength,
    };
  }

  /**
   * Read one active v2 chunk payload from SQLite.
   */
  getActiveEncodedChunk(
    table: TableName,
    chunkIndex: number,
    requestedChunkRows: number,
  ): StoredEncodedChunk | null {
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
    const manifest = this.getActiveChunkManifest(requestedChunkRows);
    if (!manifest) return null;

    const activeBlock = this.getMetadataInt("active_snapshot_block");
    if (activeBlock == null) return null;

    const tableInfo = manifest.tables[table];
    if (!tableInfo) return null;
    if (chunkIndex >= tableInfo.chunkCount) return null;

    const row = this.selectChunkByBlockStmt.get(
      activeBlock,
      table,
      chunkIndex,
    ) as
      | {
          encoding: string;
          payload: Buffer;
        }
      | undefined;
    if (!row) return null;
    if (row.encoding !== "gzip" && row.encoding !== "br") return null;

    const payload = Buffer.from(row.payload);
    const parsedChunk = parseEncodedChunkPayload(payload, row.encoding);
    if (
      !parsedChunk ||
      parsedChunk.table !== table ||
      parsedChunk.chunkIndex !== chunkIndex ||
      parsedChunk.chunkRows !== manifest.chunkRows
    ) {
      console.warn(
        `[Persistence] Ignoring invalid stored chunk ${table}/${chunkIndex} for chunkRows=${manifest.chunkRows}; falling back to SnapshotCache`,
      );
      return null;
    }
    const jsonByteLength =
      row.encoding === "gzip"
        ? gunzipSync(payload).byteLength
        : payload.byteLength;

    return {
      chunkCount: tableInfo.chunkCount,
      chunkRows: manifest.chunkRows,
      encoding: row.encoding,
      jsonByteLength,
      payload,
      snapshotBlock: manifest.lastProcessedBlock,
    };
  }

  /**
   * Create a transactionally-consistent SQLite backup buffer.
   * Uses SQLite backup API instead of reading the live db file directly.
   */
  async createBackupBuffer(): Promise<Buffer> {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dfpunk-indexer-backup-"),
    );
    const backupFile = path.join(tempDir, "indexer-backup.db");
    try {
      await this.db.backup(backupFile);
      return fs.readFileSync(backupFile);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.warn("[Persistence] Failed to cleanup temp backup dir:", err);
      }
    }
  }

  /**
   * Run a sampling consistency check: reconstruct the full snapshot from v2
   * chunks for the active block and compare its SHA-256 hash with the v1 JSON.
   * Logs a warning on mismatch. Returns true if consistent (or no chunks yet).
   */
  verifyChunkConsistency(v1JsonString: string): boolean {
    const activeBlock = this.getMetadataInt("active_snapshot_block");
    if (activeBlock == null) return true; // no chunks written yet

    const rows = this.db
      .prepare(
        `SELECT table_name, chunk_index, payload, encoding
         FROM snapshot_chunks
         WHERE snapshot_block = ?
         ORDER BY table_name, chunk_index`,
      )
      .all(activeBlock) as Array<{
      table_name: string;
      chunk_index: number;
      payload: Buffer;
      encoding: string;
    }>;
    if (rows.length === 0) return true;

    // Reconstruct per-table data from chunks, matching v1 key order:
    // { lastProcessedBlock, ...tables in TABLE_NAMES order }
    const tableData: Record<string, Record<string, unknown>> = {};
    let lastProcessedBlock = 0;
    for (const row of rows) {
      const decompressed =
        row.encoding === "gzip" ? gunzipSync(row.payload) : row.payload;
      const chunkPayload = JSON.parse(decompressed.toString()) as {
        table: string;
        rows: Record<string, unknown>;
        lastProcessedBlock: number;
      };
      lastProcessedBlock = chunkPayload.lastProcessedBlock;
      const existing = tableData[chunkPayload.table] ?? {};
      Object.assign(existing, chunkPayload.rows);
      tableData[chunkPayload.table] = existing;
    }

    // Build in same key order as v1 JSON
    const reconstructed: Record<string, unknown> = { lastProcessedBlock };
    for (const table of TABLE_NAMES) {
      reconstructed[table] = tableData[table] ?? {};
    }

    // Normalize both to sorted-key JSON for comparison (key order may differ)
    const v1Parsed = JSON.parse(v1JsonString) as Record<string, unknown>;
    const v1Normalized = JSON.stringify(sortKeys(v1Parsed));
    const v2Normalized = JSON.stringify(sortKeys(reconstructed));
    const v1Hash = createHash("sha256").update(v1Normalized).digest("hex");
    const v2Hash = createHash("sha256").update(v2Normalized).digest("hex");

    if (v1Hash !== v2Hash) {
      console.warn(
        `[Persistence] v1/v2 consistency MISMATCH at block ${activeBlock} (v1=${v1Hash.slice(0, 12)}… v2=${v2Hash.slice(0, 12)}…)`,
      );
      return false;
    }
    console.log(`[Persistence] v1/v2 consistency OK at block ${activeBlock}`);
    return true;
  }

  close(): void {
    this.db.close();
  }

  private reconstructSnapshotPayload(
    snapshotBlock: number,
    manifest: StoredChunkManifest,
  ): StoredSnapshotPayload | null {
    const rows = this.selectAllChunksByBlockStmt.all(snapshotBlock) as Array<{
      table_name: string;
      chunk_index: number;
      encoding: string;
      payload: Buffer;
    }>;

    const tableData: Record<string, Record<string, unknown>> = {};
    const chunkIndexes = new Map<TableName, Set<number>>();
    for (const table of TABLE_NAMES) {
      tableData[table] = {};
    }

    for (const row of rows) {
      if (!TABLE_NAMES.includes(row.table_name as TableName)) {
        console.warn(
          `[Persistence] Ignoring unknown table in stored chunk set: ${row.table_name}`,
        );
        return null;
      }
      const parsedChunk = parseEncodedChunkPayload(row.payload, row.encoding);
      if (!parsedChunk) return null;
      const table = row.table_name as TableName;
      const tableInfo = manifest.tables[table];
      if (
        parsedChunk.table !== table ||
        parsedChunk.chunkIndex !== row.chunk_index ||
        parsedChunk.chunkRows !== manifest.chunkRows ||
        parsedChunk.chunkCount !== tableInfo.chunkCount ||
        parsedChunk.rowCount !== tableInfo.rowCount ||
        parsedChunk.lastProcessedBlock !== manifest.lastProcessedBlock
      ) {
        console.warn(
          `[Persistence] Invalid stored chunk while reconstructing active snapshot: ${table}/${row.chunk_index}`,
        );
        return null;
      }
      let received = chunkIndexes.get(table);
      if (!received) {
        received = new Set<number>();
        chunkIndexes.set(table, received);
      }
      if (received.has(parsedChunk.chunkIndex)) {
        console.warn(
          `[Persistence] Duplicate stored chunk while reconstructing active snapshot: ${table}/${parsedChunk.chunkIndex}`,
        );
        return null;
      }
      received.add(parsedChunk.chunkIndex);
      Object.assign(tableData[table], parsedChunk.rows);
    }

    for (const table of TABLE_NAMES) {
      const expected = manifest.tables[table];
      const receivedCount = chunkIndexes.get(table)?.size ?? 0;
      const receivedRows = Object.keys(tableData[table]).length;
      if (receivedCount !== expected.chunkCount || receivedRows !== expected.rowCount) {
        console.warn(
          `[Persistence] Incomplete stored chunk set while reconstructing active snapshot: ${table} chunks=${receivedCount}/${expected.chunkCount} rows=${receivedRows}/${expected.rowCount}`,
        );
        return null;
      }
    }

    const reconstructed: Record<string, unknown> = {
      lastProcessedBlock: manifest.lastProcessedBlock,
    };
    for (const table of TABLE_NAMES) {
      reconstructed[table] = tableData[table];
    }
    const jsonString = JSON.stringify(reconstructed);
    return {
      blockNumber: manifest.lastProcessedBlock,
      jsonByteLength: Buffer.byteLength(jsonString),
      jsonString,
    };
  }

  // ---------------------------------------------------------------------------
  // Dual-write (v1 + v2)
  // ---------------------------------------------------------------------------

  /**
   * Write snapshot to both v1 single-row table and v2 chunk tables.
   * v2 follows the two-phase protocol from the design doc:
   *   Phase A — stage chunks for targetBlock
   *   Phase B — commit pointer switch atomically
   */
  private dualWrite(blockNumber: number, jsonString: string): void {
    this.invalidateActiveSnapshotCache();
    // v1: single-row upsert (unchanged)
    this.upsertStmt.run(blockNumber, jsonString);

    // v2: chunked write
    try {
      this.writeChunks(blockNumber, jsonString);
    } catch (err) {
      // Non-fatal during Phase 1: v1 is still the source of truth
      console.warn("[Persistence] v2 chunk write failed (non-fatal):", err);
    }
  }

  /**
   * Phase A + B: stage chunks then atomically switch pointer.
   */
  private writeChunks(blockNumber: number, jsonString: string): void {
    const data = JSON.parse(jsonString) as Record<string, unknown>;
    const lastProcessedBlock =
      typeof data.lastProcessedBlock === "number" ? data.lastProcessedBlock : 0;

    const manifestTables: Record<
      string,
      { chunkCount: number; rowCount: number }
    > = {};

    // Phase A: stage chunks
    for (const table of TABLE_NAMES) {
      const tableData = data[table];
      if (
        !tableData ||
        typeof tableData !== "object" ||
        Array.isArray(tableData)
      ) {
        manifestTables[table] = { chunkCount: 0, rowCount: 0 };
        continue;
      }
      const entries = Object.entries(tableData as Record<string, unknown>);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const rowCount = entries.length;
      const chunkCount =
        rowCount === 0 ? 0 : Math.ceil(rowCount / this.chunkRows);

      for (let i = 0; i < chunkCount; i++) {
        const start = i * this.chunkRows;
        const end = start + this.chunkRows;
        const chunkEntries = entries.slice(start, end);
        const chunkJson = JSON.stringify({
          version: 2,
          table,
          chunkIndex: i,
          chunkCount,
          chunkRows: this.chunkRows,
          rowCount,
          rows: Object.fromEntries(chunkEntries),
          lastProcessedBlock,
        });
        const compressed = gzipSync(Buffer.from(chunkJson));
        const hash = createHash("sha256").update(chunkJson).digest("hex");
        this.upsertChunkStmt.run(
          blockNumber,
          table,
          i,
          chunkEntries.length,
          compressed,
          hash,
        );
      }

      manifestTables[table] = { chunkCount, rowCount };
    }

    // Write manifest
    const manifestJson = JSON.stringify({
      version: 2,
      chunkRows: this.chunkRows,
      lastProcessedBlock,
      tables: manifestTables,
    });
    this.upsertManifestStmt.run(blockNumber, this.chunkRows, manifestJson);

    // Phase B: commit pointer switch atomically
    const commitTx = this.db.transaction(() => {
      // Verify expected chunks exist
      const counts = this.selectChunkCountsStmt.all(blockNumber) as Array<{
        table_name: string;
        cnt: number;
      }>;
      const countMap = new Map(counts.map((r) => [r.table_name, r.cnt]));
      for (const table of TABLE_NAMES) {
        const expected = manifestTables[table].chunkCount;
        const actual = countMap.get(table) ?? 0;
        if (actual !== expected) {
          throw new Error(
            `Chunk count mismatch for ${table}: expected ${expected}, got ${actual}`,
          );
        }
      }

      // Switch active pointer
      this.setMetadataInt("active_snapshot_block", blockNumber);
      this.setMetadataInt(
        "snapshot_schema_version",
        this.snapshotSchemaVersion,
      );
    });
    commitTx();

    // Cleanup: keep only current + previous block
    this.cleanupOldSnapshots(blockNumber);
  }

  /**
   * Retain only N=2 snapshot versions (active + previous).
   */
  private cleanupOldSnapshots(currentBlock: number): void {
    const keepA = currentBlock;
    const keepB = this.previousActiveBlock ?? currentBlock;
    this.deleteOldChunksStmt.run(keepA, keepB);
    this.deleteOldManifestsStmt.run(keepA, keepB);
    this.previousActiveBlock = currentBlock;
  }

  private ensureSchemaVersions(): void {
    const snapshotCount = this.getSnapshotCount();

    const dbVersionRow = this.db.prepare("PRAGMA user_version").get() as
      | { user_version: number }
      | undefined;
    const currentDbSchemaVersion = Number(dbVersionRow?.user_version ?? 0);
    if (currentDbSchemaVersion !== this.dbSchemaVersion) {
      if (snapshotCount > 0) {
        this.clearSnapshots(
          `db schema version mismatch ${currentDbSchemaVersion} -> ${this.dbSchemaVersion}`,
        );
      }
      this.db.pragma(`user_version = ${this.dbSchemaVersion}`);
      console.log(
        `[Persistence] Set SQLite user_version=${this.dbSchemaVersion}`,
      );
    }

    const storedSnapshotSchemaVersion = this.getMetadataInt(
      METADATA_KEY_SNAPSHOT_SCHEMA_VERSION,
    );
    if (storedSnapshotSchemaVersion !== this.snapshotSchemaVersion) {
      if (snapshotCount > 0) {
        this.clearSnapshots(
          `snapshot schema mismatch ${storedSnapshotSchemaVersion ?? "none"} -> ${this.snapshotSchemaVersion}`,
        );
      }
      this.setMetadataInt(
        METADATA_KEY_SNAPSHOT_SCHEMA_VERSION,
        this.snapshotSchemaVersion,
      );
      console.log(
        `[Persistence] Set snapshot_schema_version=${this.snapshotSchemaVersion}`,
      );
    }
  }

  private clearSnapshots(reason: string): void {
    this.invalidateActiveSnapshotCache();
    this.deleteSnapshotsStmt.run();
    this.deleteAllChunksStmt.run();
    this.deleteAllManifestsStmt.run();
    this.lastPersistTime = 0;
    console.warn(`[Persistence] Cleared stored snapshot: ${reason}`);
  }

  private getSnapshotCount(): number {
    const row = this.countSnapshotsStmt.get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  private getMetadataInt(key: string): number | null {
    const row = this.selectMetadataStmt.get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    const parsed = Number(row.value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private setMetadataInt(key: string, value: number): void {
    this.upsertMetadataStmt.run(key, String(value));
  }

  private invalidateActiveSnapshotCache(): void {
    this.cachedActiveSnapshotPayload = null;
    this.cachedActiveSnapshotPayloadBlock = null;
  }
}

function parseEncodedChunkPayload(
  payload: Buffer,
  encoding: string,
): {
  chunkCount: number;
  chunkIndex: number;
  chunkRows: number;
  lastProcessedBlock: number;
  rowCount: number;
  rows: Record<string, Record<string, unknown>>;
  table: string;
} | null {
  try {
    const decoded =
      encoding === "gzip"
        ? gunzipSync(payload)
        : encoding === "br"
          ? brotliDecompressSync(payload)
          : payload;
    const value = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    if (typeof value.table !== "string") return null;
    if (!Number.isInteger(value.chunkIndex) || (value.chunkIndex as number) < 0) {
      return null;
    }
    if (!Number.isInteger(value.chunkCount) || (value.chunkCount as number) <= 0) {
      return null;
    }
    if (!Number.isInteger(value.chunkRows) || (value.chunkRows as number) <= 0) {
      return null;
    }
    if (!Number.isInteger(value.rowCount) || (value.rowCount as number) < 0) {
      return null;
    }
    if (
      !Number.isInteger(value.lastProcessedBlock) ||
      (value.lastProcessedBlock as number) < 0
    ) {
      return null;
    }
    if (!value.rows || typeof value.rows !== "object" || Array.isArray(value.rows)) {
      return null;
    }
    const rows: Record<string, Record<string, unknown>> = {};
    for (const [id, row] of Object.entries(
      value.rows as Record<string, unknown>,
    )) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      rows[id] = row as Record<string, unknown>;
    }
    return {
      chunkCount: value.chunkCount as number,
      chunkIndex: value.chunkIndex as number,
      chunkRows: value.chunkRows as number,
      lastProcessedBlock: value.lastProcessedBlock as number,
      rowCount: value.rowCount as number,
      rows,
      table: value.table,
    };
  } catch {
    return null;
  }
}

/**
 * Convert a persisted JSON object back to IndexerSnapshot (with Maps).
 * Mirrors OffChainSource.parseSnapshot() logic.
 */
export function jsonToSnapshot(data: Record<string, unknown>): IndexerSnapshot {
  const lastProcessedBlock =
    typeof data.lastProcessedBlock === "number" ? data.lastProcessedBlock : 0;

  const snapshot: IndexerSnapshot = {
    lastProcessedBlock,
    world: new Map(),
    player: new Map(),
    planet: new Map(),
    planet_revealed_coords: new Map(),
    planet_events: new Map(),
    planet_artifacts: new Map(),
    arrival: new Map(),
    artifact: new Map(),
    artifact_location: new Map(),
  };

  for (const table of TABLE_NAMES) {
    const raw = data[table];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const map = snapshot[table] as Map<string, unknown>;
    for (const [id, state] of Object.entries(raw as Record<string, unknown>)) {
      if (state === null || typeof state !== "object" || Array.isArray(state)) {
        continue;
      }
      try {
        map.set(id, rawToState(table, state as Record<string, unknown>));
      } catch (err) {
        console.warn(
          `[Persistence] Failed to rehydrate ${table}:${id} from snapshot:`,
          err,
        );
      }
    }
  }

  return snapshot;
}

function parseStoredManifest(raw: string): StoredChunkManifest | null {
  try {
    const value = JSON.parse(raw) as {
      version?: unknown;
      chunkRows?: unknown;
      lastProcessedBlock?: unknown;
      tables?: unknown;
    };
    if (value.version !== 2) return null;
    if (
      !Number.isInteger(value.chunkRows) ||
      (value.chunkRows as number) <= 0
    ) {
      return null;
    }
    if (
      !Number.isInteger(value.lastProcessedBlock) ||
      (value.lastProcessedBlock as number) < 0
    ) {
      return null;
    }
    if (
      !value.tables ||
      typeof value.tables !== "object" ||
      Array.isArray(value.tables)
    ) {
      return null;
    }

    const tables = {} as StoredChunkManifest["tables"];
    for (const table of TABLE_NAMES) {
      const info = (value.tables as Record<string, unknown>)[table];
      if (!info || typeof info !== "object" || Array.isArray(info)) return null;
      const rowCount = (info as { rowCount?: unknown }).rowCount;
      const chunkCount = (info as { chunkCount?: unknown }).chunkCount;
      if (!Number.isInteger(rowCount) || (rowCount as number) < 0) return null;
      if (!Number.isInteger(chunkCount) || (chunkCount as number) < 0)
        return null;
      tables[table] = {
        chunkCount: chunkCount as number,
        rowCount: rowCount as number,
      };
    }

    return {
      chunkRows: value.chunkRows as number,
      lastProcessedBlock: value.lastProcessedBlock as number,
      tables,
      version: 2,
    };
  } catch {
    return null;
  }
}

/**
 * Recursively sort object keys for deterministic JSON comparison.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}
