import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import {
  ACTION_INDEXES,
  CREATE_ACTIONS_SQL,
  CREATE_BLOCKS_SQL,
  EVENT_TABLES,
  createEventIndexSql,
  createEventTableSql,
  type EventTableName,
} from "./tables.ts";

export function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(CREATE_BLOCKS_SQL);
  db.exec(CREATE_ACTIONS_SQL);
  for (const sql of ACTION_INDEXES) db.exec(sql);
  for (const table of EVENT_TABLES) {
    db.exec(createEventTableSql(table));
    db.exec(createEventIndexSql(table));
  }
  return db;
}

export interface BlockRow {
  number: number;
  hash: string;
  timestamp: number;
  derived: number;
}

export function blockTip(db: Database.Database): BlockRow | undefined {
  return db
    .prepare(
      `SELECT number, hash, timestamp, derived FROM blocks ORDER BY number DESC LIMIT 1`,
    )
    .get() as BlockRow | undefined;
}

export function blockRow(
  db: Database.Database,
  number: number,
): BlockRow | undefined {
  return db
    .prepare(
      `SELECT number, hash, timestamp, derived FROM blocks WHERE number = ?`,
    )
    .get(number) as BlockRow | undefined;
}

export function deleteAfter(db: Database.Database, blockNumber: number): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM actions WHERE block_number > ?`).run(blockNumber);
    for (const table of EVENT_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE block_number > ?`).run(
        blockNumber,
      );
    }
    db.prepare(`DELETE FROM blocks WHERE number > ?`).run(blockNumber);
  });
  tx();
}

export interface Integrity {
  contiguous: boolean;
  holes: string[];
  eventsOutside: number;
}

export function inspectIntegrity(
  db: Database.Database,
  startBlock: number,
): Integrity {
  const span = db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(number) AS min, MAX(number) AS max FROM blocks`,
    )
    .get() as { count: number; min: number | null; max: number | null };
  const holes: string[] = [];
  if (span.count === 0) {
    return { contiguous: true, holes, eventsOutside: 0 };
  }
  const min = span.min as number;
  const max = span.max as number;
  if (min !== startBlock) holes.push(`${startBlock}..${min - 1}`);
  if (span.count !== max - min + 1) {
    const gaps = db
      .prepare(
        `SELECT b.number + 1 AS gap_start, (
           SELECT MIN(n.number) - 1 FROM blocks n WHERE n.number > b.number
         ) AS gap_end
         FROM blocks b
         LEFT JOIN blocks next ON next.number = b.number + 1
         WHERE b.number < ? AND next.number IS NULL`,
      )
      .all(max) as Array<{ gap_start: number; gap_end: number }>;
    for (const gap of gaps) holes.push(`${gap.gap_start}..${gap.gap_end}`);
  }
  let eventsOutside = 0;
  for (const table of EVENT_TABLES) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${table} e
         LEFT JOIN blocks b ON b.number = e.block_number
         WHERE b.number IS NULL OR e.block_number < ?`,
      )
      .get(startBlock) as { count: number };
    eventsOutside += row.count;
  }
  return {
    contiguous: holes.length === 0 && eventsOutside === 0,
    holes,
    eventsOutside,
  };
}

export function eventsAtBlock(
  db: Database.Database,
  blockNumber: number,
): number {
  let total = 0;
  for (const table of EVENT_TABLES) {
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE block_number = ?`)
      .get(blockNumber) as { count: number };
    total += row.count;
  }
  return total;
}

export function derivedThrough(db: Database.Database): number | null {
  const row = db
    .prepare(
      `SELECT MAX(number) AS n FROM blocks b
       WHERE derived = 1
         AND NOT EXISTS (
           SELECT 1 FROM blocks earlier
           WHERE earlier.number < b.number AND earlier.derived = 0
         )`,
    )
    .get() as { n: number | null };
  return row.n;
}

export function actionsMaxBlock(db: Database.Database): number | null {
  const row = db
    .prepare(`SELECT MAX(block_number) AS n FROM actions`)
    .get() as { n: number | null };
  return row.n;
}

export function pendingDeriveSpan(
  db: Database.Database,
): { from: number; to: number } | null {
  const row = db
    .prepare(
      `SELECT MIN(number) AS lo, MAX(number) AS hi FROM blocks WHERE derived = 0`,
    )
    .get() as { lo: number | null; hi: number | null };
  if (row.lo == null || row.hi == null) return null;
  return { from: row.lo, to: row.hi };
}

export function assertEventTable(
  table: string,
): asserts table is EventTableName {
  if (!(EVENT_TABLES as readonly string[]).includes(table)) {
    throw new Error(`[analytics] unknown event table ${table}`);
  }
}
