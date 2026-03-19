import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import type {
  IndexerService,
  TableName,
} from "../../packages/indexer-server-core/src/index.ts";
import { TABLE_NAMES } from "../../packages/indexer-server-core/src/index.ts";
import { createApp } from "./api.ts";
import { SnapshotCache } from "./snapshotCache.ts";

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
  };
}

test("GET /snapshot/manifest exposes chunk metadata while keeping v1 endpoints untouched", async () => {
  const indexer = createFakeIndexer({
    player: {
      p1: { score: "1" },
      p2: { score: "2" },
    },
    world: {
      "0": {
        paused: false,
        radius: "1",
        misc_nonce: "1",
        next_change_block: 0,
      },
    },
  });
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: createStoreStub() as never,
  });

  const response = await app.request(
    "http://localhost/snapshot/manifest?chunkRows=1",
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    chunkRows: number;
    tables: Record<string, { chunkCount: number; rowCount: number }>;
    version: number;
  };
  assert.equal(body.version, 2);
  assert.equal(body.chunkRows, 1);
  assert.equal(body.tables.player.rowCount, 2);
  assert.equal(body.tables.player.chunkCount, 2);
});

test("GET /snapshot/chunks/:table/:chunkIndex returns compressed chunk payload", async () => {
  const indexer = createFakeIndexer({
    player: {
      p1: { score: "1" },
      p2: { score: "2" },
    },
  });
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: createStoreStub() as never,
  });

  const response = await app.request(
    "http://localhost/snapshot/chunks/player/0?chunkRows=1",
    {
      headers: {
        "accept-encoding": "gzip",
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal(response.headers.get("x-snapshot-chunk-index"), "0");
  assert.equal(response.headers.get("x-snapshot-chunk-rows"), "1");

  const payload = gunzipSync(
    Buffer.from(await response.arrayBuffer()),
  ).toString("utf8");
  const chunk = JSON.parse(payload) as {
    chunkCount: number;
    chunkIndex: number;
    chunkRows: number;
    rowCount: number;
    rows: Record<string, unknown>;
    table: string;
    version: number;
  };
  assert.equal(chunk.version, 2);
  assert.equal(chunk.table, "player");
  assert.equal(chunk.chunkIndex, 0);
  assert.equal(chunk.chunkRows, 1);
  assert.equal(chunk.chunkCount, 2);
  assert.equal(chunk.rowCount, 2);
  assert.equal(Object.keys(chunk.rows).length, 1);
});

test("GET /snapshot/chunks returns 404 for unknown table", async () => {
  const indexer = createFakeIndexer({});
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: createStoreStub() as never,
  });

  const response = await app.request(
    "http://localhost/snapshot/chunks/unknown/0",
  );
  assert.equal(response.status, 404);
});
