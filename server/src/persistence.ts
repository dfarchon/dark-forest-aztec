import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IndexerSnapshot } from "../../packages/indexer-server-core/src/index.ts";
import {
  rawToState,
  TABLE_NAMES,
} from "../../packages/indexer-server-core/src/index.ts";

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

const METADATA_KEY_SNAPSHOT_SCHEMA_VERSION = "snapshot_schema_version";

export interface SnapshotStoreVersionOptions {
  dbSchemaVersion?: number;
  snapshotSchemaVersion?: number;
}

export class SnapshotStore {
  private db: Database.Database;
  private lastPersistTime = 0;
  private readonly dbSchemaVersion: number;
  private readonly snapshotSchemaVersion: number;
  private readonly minIntervalMs: number;
  private readonly countSnapshotsStmt: Database.Statement;
  private readonly deleteSnapshotsStmt: Database.Statement;
  private readonly selectMetadataStmt: Database.Statement;
  private readonly upsertMetadataStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly selectStmt: Database.Statement;

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
    this.db.exec(CREATE_TABLE_SQL);
    this.db.exec(CREATE_METADATA_TABLE_SQL);
    this.dbSchemaVersion = Math.max(1, versionOptions.dbSchemaVersion ?? 1);
    this.snapshotSchemaVersion = Math.max(
      1,
      versionOptions.snapshotSchemaVersion ?? 1,
    );
    this.minIntervalMs = minIntervalSec * 1000;
    this.countSnapshotsStmt = this.db.prepare(SELECT_SNAPSHOT_COUNT_SQL);
    this.deleteSnapshotsStmt = this.db.prepare(DELETE_SNAPSHOTS_SQL);
    this.selectMetadataStmt = this.db.prepare(SELECT_METADATA_SQL);
    this.upsertMetadataStmt = this.db.prepare(UPSERT_METADATA_SQL);
    this.upsertStmt = this.db.prepare(UPSERT_SQL);
    this.selectStmt = this.db.prepare(SELECT_SQL);
    this.ensureSchemaVersions();
  }

  /**
   * Save snapshot JSON string to SQLite. Respects minimum interval.
   * Returns true if saved, false if skipped (too soon).
   */
  save(blockNumber: number, jsonString: string): boolean {
    const now = Date.now();
    if (now - this.lastPersistTime < this.minIntervalMs) {
      return false;
    }
    this.upsertStmt.run(blockNumber, jsonString);
    this.lastPersistTime = now;
    console.log(`[Persistence] Saved snapshot at block ${blockNumber}`);
    return true;
  }

  /** Force save regardless of interval (e.g. on shutdown). */
  forceSave(blockNumber: number, jsonString: string): void {
    this.upsertStmt.run(blockNumber, jsonString);
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

  close(): void {
    this.db.close();
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
    this.deleteSnapshotsStmt.run();
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
