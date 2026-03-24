import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import type {
  IndexerService,
  TableName,
} from "../../packages/indexer-server-core/src/index.ts";
import { TABLE_NAMES } from "../../packages/indexer-server-core/src/index.ts";
import { createApp } from "./api.ts";
import { SnapshotCache } from "./snapshotCache.ts";
import type {
  StoredChunkManifest,
  StoredEncodedChunk,
  StoredSnapshotPayload,
  StoredSnapshotSummary,
} from "./persistence.ts";

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

function createStoreStub(overrides?: {
  getActiveSnapshotPayload?: () => StoredSnapshotPayload | null;
  getActiveSnapshotSummary?: () => StoredSnapshotSummary | null;
  getActiveChunkManifest?: (chunkRows: number) => StoredChunkManifest | null;
  getActiveEncodedChunk?: (
    table: TableName,
    chunkIndex: number,
    chunkRows: number,
  ) => StoredEncodedChunk | null;
}) {
  return {
    createBackupBuffer: async () => Buffer.from("stub"),
    getActiveSnapshotPayload:
      overrides?.getActiveSnapshotPayload ?? (() => null),
    getActiveSnapshotSummary:
      overrides?.getActiveSnapshotSummary ?? (() => null),
    getActiveChunkManifest: overrides?.getActiveChunkManifest ?? (() => null),
    getActiveEncodedChunk: overrides?.getActiveEncodedChunk ?? (() => null),
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

test("GET /snapshot uses active SQLite payload when available", async () => {
  const indexer = createFakeIndexer({}, 123);
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const store = createStoreStub({
    getActiveSnapshotPayload: () => ({
      blockNumber: 999,
      jsonByteLength: Buffer.byteLength(
        JSON.stringify({
          lastProcessedBlock: 999,
          world: { "0": { paused: false } },
        }),
      ),
      jsonString: JSON.stringify({
        lastProcessedBlock: 999,
        world: { "0": { paused: false } },
      }),
    }),
  });
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request("http://localhost/snapshot", {
    headers: { "accept-encoding": "gzip" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-snapshot-block"), "999");
  const body = JSON.parse(
    gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"),
  ) as { lastProcessedBlock: number };
  assert.equal(body.lastProcessedBlock, 999);
});

test("GET /snapshot/hash uses active SQLite payload when available", async () => {
  const indexer = createFakeIndexer({}, 123);
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const jsonString = JSON.stringify({
    lastProcessedBlock: 999,
    world: { "0": { paused: false } },
  });
  const expectedHash = createHash("sha256").update(jsonString).digest("hex");
  const store = createStoreStub({
    getActiveSnapshotPayload: () => ({
      blockNumber: 999,
      jsonByteLength: Buffer.byteLength(jsonString),
      jsonString,
    }),
  });
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request("http://localhost/snapshot/hash");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    hash: string;
    lastProcessedBlock: number;
  };
  assert.equal(body.lastProcessedBlock, 999);
  assert.equal(body.hash, expectedHash);
});

test("GET /blocks/latest uses active SQLite summary when available", async () => {
  const indexer = createFakeIndexer({}, 123);
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const store = createStoreStub({
    getActiveSnapshotSummary: () => ({
      blockNumber: 999,
      jsonByteLength: 4567,
    }),
  });
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request("http://localhost/blocks/latest");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    blockNumber: number;
    snapshotBlock: number;
    snapshotBytes: number;
  };
  assert.equal(body.blockNumber, 123);
  assert.equal(body.snapshotBlock, 999);
  assert.equal(body.snapshotBytes, 4567);
});

test("GET /health uses active SQLite summary when available", async () => {
  const indexer = createFakeIndexer({}, 123);
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const store = createStoreStub({
    getActiveSnapshotSummary: () => ({
      blockNumber: 999,
      jsonByteLength: 4567,
    }),
  });
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request("http://localhost/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    metrics: { snapshotBlock: number; snapshotBytes: number };
  };
  assert.equal(body.metrics.snapshotBlock, 999);
  assert.equal(body.metrics.snapshotBytes, 4567);
});

test("GET /snapshot/manifest prefers SQLite manifest when available even if cache block differs", async () => {
  const indexer = createFakeIndexer({}, 123);
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const store = createStoreStub({
    getActiveChunkManifest: () => ({
      chunkRows: 1000,
      lastProcessedBlock: 999,
      tables: Object.fromEntries(
        TABLE_NAMES.map((table) => [table, { chunkCount: 0, rowCount: 0 }]),
      ) as StoredChunkManifest["tables"],
      version: 2,
    }),
  });
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request("http://localhost/snapshot/manifest");
  assert.equal(response.status, 200);
  const body = (await response.json()) as StoredChunkManifest;
  assert.equal(body.lastProcessedBlock, 999);
});

test("GET /snapshot/chunks prefers SQLite chunk payload when available even if cache block differs", async () => {
  const indexer = createFakeIndexer({}, 123);
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const payloadJson = JSON.stringify({
    chunkCount: 1,
    chunkIndex: 0,
    chunkRows: 1000,
    lastProcessedBlock: 999,
    rowCount: 1,
    rows: { p_db: { score: "42" } },
    table: "player",
    version: 2,
  });
  const store = createStoreStub({
    getActiveEncodedChunk: () => ({
      chunkCount: 1,
      chunkRows: 1000,
      encoding: "gzip",
      jsonByteLength: Buffer.byteLength(payloadJson),
      payload: gzipSync(Buffer.from(payloadJson)),
      snapshotBlock: 999,
    }),
  });
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request(
    "http://localhost/snapshot/chunks/player/0",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-snapshot-block"), "999");
  assert.equal(response.headers.get("content-encoding"), "gzip");
  const body = JSON.parse(
    gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"),
  ) as { rows: Record<string, unknown> };
  assert.ok(body.rows.p_db);
});

test("GET /snapshot/chunks falls back to cache when store chunk unavailable", async () => {
  const indexer = createFakeIndexer(
    { player: { p1: { score: "1" } } },
    123,
  );
  const cache = new SnapshotCache(indexer);
  cache.buildFull();
  const store = createStoreStub();
  const app = createApp({
    adminToken: "",
    cache,
    corsOrigins: [],
    indexer,
    store: store as never,
  });

  const response = await app.request(
    "http://localhost/snapshot/chunks/player/0?chunkRows=1000",
    { headers: { "accept-encoding": "gzip" } },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-snapshot-block"), "123");
});
