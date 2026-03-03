import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import type { IndexerSnapshot } from "./indexer/types.ts";
import { TABLE_NAMES } from "./indexer/types.ts";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    block_number INTEGER NOT NULL,
    data TEXT NOT NULL,
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

export class SnapshotStore {
  private db: Database.Database;
  private lastPersistTime = 0;
  private readonly minIntervalMs: number;
  private readonly upsertStmt: Database.Statement;
  private readonly selectStmt: Database.Statement;

  constructor(dbPath: string, minIntervalSec: number) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_TABLE_SQL);
    this.minIntervalMs = minIntervalSec * 1000;
    this.upsertStmt = this.db.prepare(UPSERT_SQL);
    this.selectStmt = this.db.prepare(SELECT_SQL);
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
        `[Persistence] Restored snapshot from block ${row.block_number}`
      );
      return { blockNumber: row.block_number, data };
    } catch (err) {
      console.warn("[Persistence] Failed to parse stored snapshot:", err);
      return null;
    }
  }

  /** Get the database file path (for backup endpoint). */
  getDatabasePath(): string {
    return this.db.name;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Convert a persisted JSON object back to IndexerSnapshot (with Maps).
 * Mirrors OffChainSource.parseSnapshot() logic.
 */
export function jsonToSnapshot(
  data: Record<string, unknown>
): IndexerSnapshot {
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
      if (state !== null && typeof state === "object") map.set(id, state);
    }
  }

  return snapshot;
}
