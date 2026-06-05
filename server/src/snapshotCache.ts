import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import type {
  IndexerChangePayload,
  IndexerService,
  TableName,
} from "@dfpunk/indexer-core";
import { TABLE_NAMES } from "@dfpunk/indexer-core";

type SnapshotJson = {
  lastProcessedBlock: number;
  [table: string]: unknown;
};

export interface SnapshotChunkManifest {
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

interface EncodedChunk {
  brotli: Buffer;
  chunkCount: number;
  gzip: Buffer;
  jsonByteLength: number;
  rowCount: number;
}

/**
 * Maintains a JSON-serializable mirror of IndexerService's Maps.
 * Updated incrementally on each block (only changed rows).
 * Caches both Brotli and gzip compressed Buffers for HTTP responses.
 */
export class SnapshotCache {
  private jsonObject: SnapshotJson = { lastProcessedBlock: 0 };
  private brotliBuffer: Buffer | null = null;
  private gzipBuffer: Buffer | null = null;
  private jsonString: string | null = null;
  private jsonByteLength: number | null = null;
  private chunkBufferCache = new Map<string, EncodedChunk>();
  private chunkManifestCache = new Map<number, SnapshotChunkManifest>();

  constructor(private readonly indexer: IndexerService) {
    for (const table of TABLE_NAMES) {
      this.jsonObject[table] = {};
    }
  }

  /** Build full cache from current IndexerService state (used on startup). */
  buildFull(): void {
    this.jsonObject.lastProcessedBlock = this.indexer.getProcessedBlockNumber();
    for (const table of TABLE_NAMES) {
      const map = this.indexer.getTable(table) as
        | Record<string, unknown>
        | undefined;
      this.jsonObject[table] = map ?? {};
    }
    this.invalidateBuffers();
  }

  /** Incrementally update cache from a change payload (called on each block). */
  applyChange(payload: IndexerChangePayload): void {
    this.jsonObject.lastProcessedBlock = this.indexer.getProcessedBlockNumber();

    const { updatedIdsByTable } = payload;
    if (!updatedIdsByTable) {
      this.buildFull();
      return;
    }

    for (const table of TABLE_NAMES) {
      const ids = updatedIdsByTable[table];
      if (!ids || ids.length === 0) continue;
      const tableObj = this.jsonObject[table] as Record<string, unknown>;
      for (const id of ids) {
        const row = this.indexer.getTable(table as TableName, id);
        if (row !== undefined) {
          tableObj[id] = row;
        }
      }
    }
    this.invalidateBuffers();
  }

  /** Restore cache from a persisted JSON object (on startup from SQLite). */
  restoreFrom(data: Record<string, unknown>): void {
    const restored: SnapshotJson = {
      lastProcessedBlock:
        typeof data.lastProcessedBlock === "number"
          ? data.lastProcessedBlock
          : 0,
    };
    for (const table of TABLE_NAMES) {
      const value = data[table];
      restored[table] =
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
    }
    this.jsonObject = restored;
    this.invalidateBuffers();
  }

  /** Get the cached Brotli Buffer for HTTP response. */
  getBrotliBuffer(): Buffer {
    if (!this.brotliBuffer) {
      const str = this.getJsonString();
      this.brotliBuffer = brotliCompressSync(Buffer.from(str), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
      });
    }
    return this.brotliBuffer;
  }

  /** Get the cached gzip Buffer for HTTP response (fallback). */
  getGzipBuffer(): Buffer {
    if (!this.gzipBuffer) {
      const str = this.getJsonString();
      this.gzipBuffer = gzipSync(Buffer.from(str));
    }
    return this.gzipBuffer;
  }

  /** Get the cached JSON string (used for SQLite persistence). */
  getJsonString(): string {
    if (!this.jsonString) {
      this.jsonString = JSON.stringify(this.jsonObject, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      this.jsonByteLength = Buffer.byteLength(this.jsonString);
    }
    return this.jsonString;
  }

  /** Get the current snapshot JSON payload size without forcing gzip recomputation. */
  getJsonByteLength(): number {
    if (this.jsonByteLength == null) {
      this.getJsonString();
    }
    return this.jsonByteLength ?? 0;
  }

  getProcessedBlockNumber(): number {
    return this.jsonObject.lastProcessedBlock;
  }

  getChunkManifest(chunkRows: number): SnapshotChunkManifest {
    const normalizedChunkRows = normalizeChunkRows(chunkRows);
    const cached = this.chunkManifestCache.get(normalizedChunkRows);
    if (cached) return cached;

    const tables = {} as SnapshotChunkManifest["tables"];
    for (const table of TABLE_NAMES) {
      const rowCount = this.getTableEntries(table).length;
      tables[table] = {
        chunkCount:
          rowCount === 0 ? 0 : Math.ceil(rowCount / normalizedChunkRows),
        rowCount,
      };
    }

    const manifest: SnapshotChunkManifest = {
      chunkRows: normalizedChunkRows,
      lastProcessedBlock: this.getProcessedBlockNumber(),
      tables,
      version: 2,
    };
    this.chunkManifestCache.set(normalizedChunkRows, manifest);
    return manifest;
  }

  getEncodedChunk(
    table: TableName,
    chunkIndex: number,
    chunkRows: number,
  ): EncodedChunk | null {
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
    const normalizedChunkRows = normalizeChunkRows(chunkRows);
    const cacheKey = `${table}:${chunkIndex}:${normalizedChunkRows}`;
    const cached = this.chunkBufferCache.get(cacheKey);
    if (cached) return cached;

    const rows = this.getTableEntries(table);
    if (rows.length === 0) return null;

    const chunkCount = Math.ceil(rows.length / normalizedChunkRows);
    if (chunkIndex >= chunkCount) return null;

    const start = chunkIndex * normalizedChunkRows;
    const end = start + normalizedChunkRows;
    const chunkRowsObj = Object.fromEntries(rows.slice(start, end));
    const chunkJson = JSON.stringify(
      {
        chunkCount,
        chunkIndex,
        chunkRows: normalizedChunkRows,
        lastProcessedBlock: this.getProcessedBlockNumber(),
        rowCount: rows.length,
        rows: chunkRowsObj,
        table,
        version: 2,
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );
    const chunkBuffer = Buffer.from(chunkJson);
    const encoded: EncodedChunk = {
      brotli: brotliCompressSync(chunkBuffer, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
      }),
      chunkCount,
      gzip: gzipSync(chunkBuffer),
      jsonByteLength: chunkBuffer.byteLength,
      rowCount: rows.length,
    };
    this.chunkBufferCache.set(cacheKey, encoded);
    return encoded;
  }

  private getTableEntries(table: TableName): Array<[string, unknown]> {
    const tableValue = this.jsonObject[table];
    if (
      !tableValue ||
      typeof tableValue !== "object" ||
      Array.isArray(tableValue)
    )
      return [];
    const entries = Object.entries(tableValue as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries;
  }

  private invalidateBuffers(): void {
    this.jsonString = null;
    this.jsonByteLength = null;
    this.brotliBuffer = null;
    this.gzipBuffer = null;
    this.chunkBufferCache.clear();
    this.chunkManifestCache.clear();
  }
}

function normalizeChunkRows(chunkRows: number): number {
  if (!Number.isInteger(chunkRows) || chunkRows <= 0) return 1000;
  return Math.min(chunkRows, 20_000);
}
