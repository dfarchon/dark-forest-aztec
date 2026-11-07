import type Database from "better-sqlite3";

import type { ChainBlock, ChainLog } from "./model.ts";
import { columnsFor, stateColumns, type EventTableName } from "./tables.ts";
import { stateValues } from "./rows.ts";

export function writeChunk(
  db: Database.Database,
  blocks: ChainBlock[],
  logs: ChainLog[],
): void {
  const insertBlock = db.prepare(
    `INSERT INTO blocks (number, hash, timestamp, derived) VALUES (?, ?, ?, 0)`,
  );
  const inserts = new Map<EventTableName, Database.Statement>();
  const statementFor = (table: EventTableName): Database.Statement => {
    const existing = inserts.get(table);
    if (existing) return existing;
    const cols = columnsFor(table);
    const sql = `INSERT INTO ${table} (${cols.map((column) => column.name).join(", ")})
      VALUES (${cols.map(() => "?").join(", ")})`;
    const stmt = db.prepare(sql);
    inserts.set(table, stmt);
    return stmt;
  };
  const tx = db.transaction(() => {
    for (const block of blocks) {
      insertBlock.run(block.number, block.hash, block.timestamp);
    }
    for (const log of logs) {
      statementFor(log.table).run(
        log.blockNumber,
        log.txIndex,
        log.logIndex,
        log.txHash,
        log.id,
        ...stateValues(log.table, log.state),
      );
    }
  });
  tx();
}

export interface StoredEvent {
  table: EventTableName;
  blockNumber: number;
  blockTimestamp: number;
  txHash: string | null;
  txIndex: number;
  logIndex: number;
  id: string;
  state: Record<string, string | number | null>;
}

function readState(
  table: EventTableName,
  row: Record<string, unknown>,
): Record<string, string | number | null> {
  const state: Record<string, string | number | null> = {};
  for (const column of stateColumns(table)) {
    const value = row[column.name];
    state[column.name] =
      value === undefined || value === null
        ? column.zero
        : (value as string | number);
  }
  if (table === "arrival_update") state.id = String(row.id);
  return state;
}

export function loadEvents(
  db: Database.Database,
  from: number,
  to: number,
): StoredEvent[] {
  const events: StoredEvent[] = [];
  for (const table of [
    "world_update",
    "player_update",
    "planet_update",
    "planet_revealed_coords_update",
    "planet_events_update",
    "planet_artifacts_update",
    "arrival_update",
    "artifact_update",
    "artifact_location_update",
  ] as const) {
    const rows = db
      .prepare(
        `SELECT e.*, b.timestamp AS block_timestamp
         FROM ${table} e
         JOIN blocks b ON b.number = e.block_number
         WHERE e.block_number BETWEEN ? AND ?
         ORDER BY e.block_number, e.tx_index, e.log_index`,
      )
      .all(from, to) as Array<Record<string, unknown>>;
    for (const row of rows) {
      events.push({
        table,
        blockNumber: Number(row.block_number),
        blockTimestamp: Number(row.block_timestamp),
        txHash: row.tx_hash == null ? null : String(row.tx_hash),
        txIndex: Number(row.tx_index),
        logIndex: Number(row.log_index),
        id: String(row.id),
        state: readState(table, row),
      });
    }
  }
  events.sort((left, right) => {
    return (
      left.blockNumber - right.blockNumber ||
      left.txIndex - right.txIndex ||
      left.logIndex - right.logIndex ||
      left.table.localeCompare(right.table)
    );
  });
  return events;
}

export function loadLatestState(
  db: Database.Database,
  table: EventTableName,
  id: string,
  beforeBlock: number,
): Record<string, string | number | null> | undefined {
  const row = db
    .prepare(
      `SELECT * FROM ${table}
       WHERE id = ? AND block_number < ?
       ORDER BY block_number DESC, tx_index DESC, log_index DESC
       LIMIT 1`,
    )
    .get(id, beforeBlock) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return readState(table, row);
}

export function loadKnownIds(
  db: Database.Database,
  table: EventTableName,
  beforeBlock: number,
): Set<string> {
  const rows = db
    .prepare(`SELECT DISTINCT id FROM ${table} WHERE block_number < ?`)
    .all(beforeBlock) as Array<{ id: string }>;
  return new Set(rows.map((row) => String(row.id)));
}
