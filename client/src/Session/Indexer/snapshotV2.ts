/**
 * Snapshot v2 chunked bootstrap: types, wire-format validation, and assembler.
 *
 * v2 splits the full snapshot into per-table chunks so the client can download
 * them concurrently with progress feedback and retry.
 */

import {
  type IndexerSnapshot,
  TABLE_NAMES,
  type TableId,
  type TableName,
} from "@dfpunk/indexer-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotV2Manifest {
  version: 2;
  lastProcessedBlock: number;
  chunkRows: number;
  tables: Record<TableName, { chunkCount: number; rowCount: number }>;
}

export interface SnapshotV2ChunkPayload {
  version: 2;
  table: TableName;
  chunkIndex: number;
  chunkCount: number;
  chunkRows: number;
  rowCount: number;
  lastProcessedBlock: number;
  rows: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Wire-format validators (parse unknown → typed or null)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

export function parseSnapshotV2Manifest(
  value: unknown
): SnapshotV2Manifest | null {
  if (!isRecord(value)) return null;
  if (value.version !== 2) return null;
  if (!isNonNegativeInt(value.lastProcessedBlock)) return null;
  if (!isPositiveInt(value.chunkRows)) return null;

  const tablesValue = value.tables;
  if (!isRecord(tablesValue)) return null;

  const tables = {} as SnapshotV2Manifest["tables"];
  for (const table of TABLE_NAMES) {
    const info = tablesValue[table];
    if (!isRecord(info)) return null;
    if (!isNonNegativeInt(info.rowCount) || !isNonNegativeInt(info.chunkCount))
      return null;
    tables[table] = {
      rowCount: info.rowCount,
      chunkCount: info.chunkCount,
    };
  }

  return {
    version: 2,
    lastProcessedBlock: value.lastProcessedBlock,
    chunkRows: value.chunkRows,
    tables,
  };
}

export function parseSnapshotV2ChunkPayload(
  value: unknown
): SnapshotV2ChunkPayload | null {
  if (!isRecord(value)) return null;
  if (value.version !== 2) return null;
  if (
    typeof value.table !== "string" ||
    !TABLE_NAMES.includes(value.table as TableName)
  )
    return null;
  if (!isNonNegativeInt(value.chunkIndex)) return null;
  if (!isPositiveInt(value.chunkCount)) return null;
  if (!isPositiveInt(value.chunkRows)) return null;
  if (!isNonNegativeInt(value.rowCount)) return null;
  if (!isNonNegativeInt(value.lastProcessedBlock)) return null;
  if (!isRecord(value.rows)) return null;

  const rows: Record<string, Record<string, unknown>> = {};
  for (const [id, row] of Object.entries(value.rows)) {
    if (!isRecord(row)) return null;
    rows[id] = row;
  }

  return {
    version: 2,
    table: value.table as TableName,
    chunkIndex: value.chunkIndex,
    chunkCount: value.chunkCount,
    chunkRows: value.chunkRows,
    rowCount: value.rowCount,
    lastProcessedBlock: value.lastProcessedBlock,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Assembler — collects validated chunks and produces an IndexerSnapshot
// ---------------------------------------------------------------------------

export class SnapshotV2Assembler {
  private readonly snapshot: IndexerSnapshot;
  private readonly received = new Map<TableName, Set<number>>();

  constructor(private readonly manifest: SnapshotV2Manifest) {
    this.snapshot = {
      lastProcessedBlock: manifest.lastProcessedBlock,
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
  }

  addChunk(chunk: SnapshotV2ChunkPayload): void {
    const info = this.manifest.tables[chunk.table];
    if (!info) {
      throw new Error(`[SnapshotV2] unknown table: ${chunk.table}`);
    }
    if (chunk.lastProcessedBlock !== this.manifest.lastProcessedBlock) {
      throw new Error(
        `[SnapshotV2] block mismatch ${chunk.table}#${chunk.chunkIndex}: ` +
          `${chunk.lastProcessedBlock} !== ${this.manifest.lastProcessedBlock}`
      );
    }
    if (chunk.chunkRows !== this.manifest.chunkRows) {
      throw new Error(
        `[SnapshotV2] chunkRows mismatch ${chunk.table}#${chunk.chunkIndex}: ` +
          `${chunk.chunkRows} !== ${this.manifest.chunkRows}`
      );
    }
    if (chunk.chunkCount !== info.chunkCount) {
      throw new Error(
        `[SnapshotV2] chunkCount mismatch ${chunk.table}: ` +
          `${chunk.chunkCount} !== ${info.chunkCount}`
      );
    }
    if (chunk.rowCount !== info.rowCount) {
      throw new Error(
        `[SnapshotV2] rowCount mismatch ${chunk.table}: ` +
          `${chunk.rowCount} !== ${info.rowCount}`
      );
    }
    if (chunk.chunkIndex >= chunk.chunkCount) {
      throw new Error(
        `[SnapshotV2] invalid chunkIndex ${chunk.chunkIndex} for ${chunk.table}`
      );
    }

    let set = this.received.get(chunk.table);
    if (!set) {
      set = new Set();
      this.received.set(chunk.table, set);
    }
    if (set.has(chunk.chunkIndex)) {
      throw new Error(
        `[SnapshotV2] duplicate chunk ${chunk.table}#${chunk.chunkIndex}`
      );
    }
    set.add(chunk.chunkIndex);

    const map = this.snapshot[chunk.table] as Map<TableId, unknown>;
    for (const [id, state] of Object.entries(chunk.rows)) {
      map.set(id, state);
    }
  }

  finalize(): IndexerSnapshot {
    for (const table of TABLE_NAMES) {
      const expected = this.manifest.tables[table];
      const gotChunks = this.received.get(table)?.size ?? 0;
      const gotRows = (this.snapshot[table] as Map<TableId, unknown>).size;
      if (gotChunks !== expected.chunkCount) {
        throw new Error(
          `[SnapshotV2] missing chunks for ${table}: ${gotChunks}/${expected.chunkCount}`
        );
      }
      if (gotRows !== expected.rowCount) {
        throw new Error(
          `[SnapshotV2] row count mismatch for ${table}: ${gotRows}/${expected.rowCount}`
        );
      }
    }
    return this.snapshot;
  }
}
