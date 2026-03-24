import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import type { IndexerService, TableName } from "../../packages/indexer-server-core/src/index.ts";
import { TABLE_NAMES } from "../../packages/indexer-server-core/src/index.ts";
import { createApp } from "./api.ts";
import { SnapshotCache } from "./snapshotCache.ts";

type ContractManifest = {
  version: 2;
  chunkRows: number;
  lastProcessedBlock: number;
  tables: Record<TableName, { chunkCount: number; rowCount: number }>;
};

type ContractChunk = {
  version: 2;
  table: TableName;
  chunkIndex: number;
  chunkCount: number;
  chunkRows: number;
  rowCount: number;
  lastProcessedBlock: number;
  rows: Record<string, Record<string, unknown>>;
};

function createFakeIndexer(
  tables: Partial<Record<TableName, Record<string, unknown>>>,
  processedBlock = 123,
): IndexerService {
  const normalized = {} as Record<TableName, Record<string, unknown>>;
  for (const table of TABLE_NAMES) {
    normalized[table] = tables[table] ?? {};
  }

  return {
    getProcessedBlockNumber: () => processedBlock,
    getStatus: () => ({
      isSyncing: false,
      lastProcessedBlock: processedBlock,
      latestKnownBlock: processedBlock,
      lifecycle: "live",
    }),
    getTable: (table: TableName, id?: string) => {
      const tableObj = normalized[table];
      if (id != null) return tableObj[id];
      return tableObj;
    },
  } as unknown as IndexerService;
}

function createStoreStub() {
  return {
    createBackupBuffer: async () => Buffer.from("stub"),
    getActiveSnapshotPayload: () => null,
    getActiveSnapshotSummary: () => null,
    getActiveChunkManifest: () => null,
    getActiveEncodedChunk: () => null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseContractManifest(value: unknown): ContractManifest | null {
  if (!isRecord(value)) return null;
  if (value.version !== 2) return null;
  if (!Number.isInteger(value.chunkRows) || (value.chunkRows as number) <= 0) {
    return null;
  }
  if (
    !Number.isInteger(value.lastProcessedBlock) ||
    (value.lastProcessedBlock as number) < 0
  ) {
    return null;
  }
  if (!isRecord(value.tables)) return null;

  const tables = {} as ContractManifest["tables"];
  for (const table of TABLE_NAMES) {
    const tableInfo = value.tables[table];
    if (!isRecord(tableInfo)) return null;
    if (
      !Number.isInteger(tableInfo.chunkCount) ||
      (tableInfo.chunkCount as number) < 0 ||
      !Number.isInteger(tableInfo.rowCount) ||
      (tableInfo.rowCount as number) < 0
    ) {
      return null;
    }
    tables[table] = {
      chunkCount: tableInfo.chunkCount as number,
      rowCount: tableInfo.rowCount as number,
    };
  }

  return {
    version: 2,
    chunkRows: value.chunkRows as number,
    lastProcessedBlock: value.lastProcessedBlock as number,
    tables,
  };
}

function parseContractChunk(value: unknown): ContractChunk | null {
  if (!isRecord(value)) return null;
  if (value.version !== 2) return null;
  if (
    typeof value.table !== "string" ||
    !TABLE_NAMES.includes(value.table as TableName)
  ) {
    return null;
  }
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
  if (!isRecord(value.rows)) return null;
  for (const row of Object.values(value.rows)) {
    if (!isRecord(row)) return null;
  }

  return {
    version: 2,
    table: value.table as TableName,
    chunkIndex: value.chunkIndex as number,
    chunkCount: value.chunkCount as number,
    chunkRows: value.chunkRows as number,
    rowCount: value.rowCount as number,
    lastProcessedBlock: value.lastProcessedBlock as number,
    rows: value.rows as Record<string, Record<string, unknown>>,
  };
}

test("server v2 manifest/chunks satisfy snapshot contract end-to-end", async () => {
  const indexer = createFakeIndexer(
    {
      world: {
        "0": {
          paused: false,
          radius: "1",
          misc_nonce: "1",
          next_change_block: 0,
        },
      },
      player: {
        p1: { score: "1" },
        p2: { score: "2" },
      },
    },
    321,
  );
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: createStoreStub() as never,
  });

  const manifestRes = await app.request("http://localhost/snapshot/manifest?chunkRows=1");
  assert.equal(manifestRes.status, 200);
  const manifest = parseContractManifest(await manifestRes.json());
  assert.ok(manifest);

  const receivedChunkIndexes = new Map<TableName, Set<number>>();
  const rowCounts = new Map<TableName, number>();

  for (const table of TABLE_NAMES) {
    const chunkCount = manifest.tables[table].chunkCount;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const response = await app.request(
        `http://localhost/snapshot/chunks/${table}/${chunkIndex}?chunkRows=${manifest.chunkRows}`,
        {
          headers: {
            "accept-encoding": "gzip",
          },
        },
      );
      assert.equal(response.status, 200);
      const payload = gunzipSync(
        Buffer.from(await response.arrayBuffer()),
      ).toString("utf8");
      const chunk = parseContractChunk(JSON.parse(payload));
      assert.ok(chunk, `chunk ${table}/${chunkIndex} should parse`);
      assert.equal(chunk.table, table);
      assert.equal(chunk.chunkIndex, chunkIndex);
      assert.equal(chunk.chunkRows, manifest.chunkRows);
      assert.equal(chunk.lastProcessedBlock, manifest.lastProcessedBlock);
      assert.equal(chunk.chunkCount, manifest.tables[table].chunkCount);
      assert.equal(chunk.rowCount, manifest.tables[table].rowCount);

      const received = receivedChunkIndexes.get(table) ?? new Set<number>();
      assert.equal(received.has(chunkIndex), false);
      received.add(chunkIndex);
      receivedChunkIndexes.set(table, received);

      const currentRows = rowCounts.get(table) ?? 0;
      rowCounts.set(table, currentRows + Object.keys(chunk.rows).length);
    }
  }

  for (const table of TABLE_NAMES) {
    assert.equal(
      receivedChunkIndexes.get(table)?.size ?? 0,
      manifest.tables[table].chunkCount,
    );
    assert.equal(rowCounts.get(table) ?? 0, manifest.tables[table].rowCount);
  }
});

test("snapshot contract requires matching chunkRows and block across manifest/chunks", () => {
  const manifest = parseContractManifest({
    version: 2,
    chunkRows: 1000,
    lastProcessedBlock: 500,
    tables: Object.fromEntries(
      TABLE_NAMES.map((table) => [
        table,
        { chunkCount: table === "world" ? 1 : 0, rowCount: table === "world" ? 1 : 0 },
      ]),
    ),
  });
  assert.ok(manifest);

  const wrongChunkRows = parseContractChunk({
    version: 2,
    table: "world",
    chunkIndex: 0,
    chunkCount: 1,
    chunkRows: 999,
    rowCount: 1,
    lastProcessedBlock: 500,
    rows: {
      "0": {
        paused: false,
      },
    },
  });
  assert.ok(wrongChunkRows);
  assert.notEqual(wrongChunkRows.chunkRows, manifest.chunkRows);

  const wrongBlock = parseContractChunk({
    version: 2,
    table: "world",
    chunkIndex: 0,
    chunkCount: 1,
    chunkRows: 1000,
    rowCount: 1,
    lastProcessedBlock: 501,
    rows: {
      "0": {
        paused: false,
      },
    },
  });
  assert.ok(wrongBlock);
  assert.notEqual(wrongBlock.lastProcessedBlock, manifest.lastProcessedBlock);
});
