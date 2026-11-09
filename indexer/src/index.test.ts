import assert from "node:assert/strict";
import test from "node:test";

import type { ContractsRuntimeConfig } from "./contractsConfig.ts";
import type { ServerRuntimeConfig } from "./config.ts";
import { runServerRuntime, shouldSaveSnapshotOnShutdown } from "./index.ts";
import { SnapshotCache } from "./snapshotCache.ts";

function createTestConfig(): ServerRuntimeConfig {
  return {
    adminToken: "",
    aztecNodeUrl: "https://canonical.testnet.rpc.aztec-labs.com",
    corsOrigins: ["http://localhost:5173"],
    indexerStartBlock: 32202,
    indexerTipTag: "proven",
    nodeKind: "remote",
    persistMinIntervalSec: 10,
    port: 3001,
    snapshotSchemaVersion: 1,
    sqlitePath: "/tmp/indexer.db",
  };
}

function createTestContracts(): ContractsRuntimeConfig {
  return {
    startBlock: 32202,
    addresses: {
      admin:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      arrival:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      artifact:
        "0x0000000000000000000000000000000000000000000000000000000000000003",
      artifactLocation:
        "0x0000000000000000000000000000000000000000000000000000000000000004",
      config:
        "0x0000000000000000000000000000000000000000000000000000000000000005",
      core: "0x0000000000000000000000000000000000000000000000000000000000000006",
      move: "0x0000000000000000000000000000000000000000000000000000000000000007",
      planet:
        "0x0000000000000000000000000000000000000000000000000000000000000008",
      planetArtifacts:
        "0x0000000000000000000000000000000000000000000000000000000000000009",
      planetEvents:
        "0x000000000000000000000000000000000000000000000000000000000000000a",
      planetRevealedCoords:
        "0x000000000000000000000000000000000000000000000000000000000000000b",
      player:
        "0x000000000000000000000000000000000000000000000000000000000000000c",
      world:
        "0x000000000000000000000000000000000000000000000000000000000000000d",
    },
  };
}

test("runServerRuntime starts HTTP before initial sync completes", async () => {
  const events: string[] = [];
  let resolveStart!: (value: { syncedToBlock: number }) => void;
  const startPromise = new Promise<{ syncedToBlock: number }>((resolve) => {
    resolveStart = resolve;
  });

  const indexer = {
    destroy: () => {
      events.push("destroy");
    },
    getProcessedBlockNumber: () => 0,
    getStatus: () => ({
      isSyncing: true,
      lastProcessedBlock: 0,
      latestKnownBlock: 0,
      lifecycle: "starting",
    }),
    getTable: () => ({}),
    start: async () => {
      events.push("start");
      return startPromise;
    },
    startPolling: () => {
      events.push("startPolling");
    },
    subscribe: () => {
      events.push("subscribe");
    },
  };

  const store = {
    close: () => undefined,
    createBackupBuffer: async () => Buffer.alloc(0),
    forceSave: () => {
      events.push("forceSave");
    },
    restore: () => null,
    save: () => true,
  };

  const cache = new SnapshotCache(indexer as never);
  const runtimePromise = runServerRuntime({
    cache,
    config: createTestConfig(),
    contracts: createTestContracts(),
    indexer: indexer as never,
    registerShutdownHandlers: false,
    serveFn: (_options, onListen) => {
      events.push("serve");
      onListen?.({ port: 3001 } as never);
      return { close: () => undefined } as never;
    },
    store: store as never,
  });

  await Promise.resolve();

  assert.deepEqual(events, ["serve", "start"]);

  resolveStart({ syncedToBlock: 42 });
  await runtimePromise;

  assert.deepEqual(events, [
    "serve",
    "start",
    "forceSave",
    "subscribe",
    "startPolling",
  ]);
});

test("failed persistence never marks a fresh snapshot as published", async () => {
  const publication = { published: false };
  const indexer = {
    destroy: () => undefined,
    getProcessedBlockNumber: () => 7,
    getProcessedBlockHash: () => "hash-7",
    getStatus: () => ({ reorgRecovering: false }),
    getTable: () => ({}),
    start: async () => ({ syncedToBlock: 7 }),
    startPolling: () => undefined,
    subscribe: () => undefined,
  };
  const store = {
    restore: () => null,
    forceSave: () => {
      throw new Error("disk full");
    },
    close: () => undefined,
  };
  await runServerRuntime({
    cache: new SnapshotCache(indexer as never),
    publication,
    config: createTestConfig(),
    contracts: createTestContracts(),
    indexer: indexer as never,
    store: store as never,
    registerShutdownHandlers: false,
    serveFn: () => ({ close: () => undefined }) as never,
  });
  assert.equal(publication.published, false);
});

test("shutdown before initial sync does not write a snapshot", async () => {
  let resolveStart!: (value: { syncedToBlock: number }) => void;
  const startPromise = new Promise<{ syncedToBlock: number }>((resolve) => {
    resolveStart = resolve;
  });
  const saved: number[] = [];
  let shutdown!: () => void;

  const indexer = {
    destroy: () => undefined,
    getProcessedBlockNumber: () => 0,
    getStatus: () => ({
      isSyncing: true,
      lastProcessedBlock: 0,
      latestKnownBlock: 0,
      lifecycle: "syncing",
      reorgRecovering: false,
    }),
    getTable: () => ({}),
    start: async () => startPromise,
    startPolling: () => undefined,
    subscribe: () => undefined,
  };
  const store = {
    close: () => undefined,
    createBackupBuffer: async () => Buffer.alloc(0),
    forceSave: (blockNumber: number) => {
      saved.push(blockNumber);
    },
    restore: () => null,
    save: () => true,
  };

  const runtimePromise = runServerRuntime({
    cache: new SnapshotCache(indexer as never),
    captureShutdown: (fn) => {
      shutdown = fn;
    },
    config: createTestConfig(),
    contracts: createTestContracts(),
    indexer: indexer as never,
    registerShutdownHandlers: false,
    serveFn: (_options, onListen) => {
      onListen?.({ port: 3001 } as never);
      return { close: () => undefined } as never;
    },
    store: store as never,
  });

  await Promise.resolve();
  shutdown();
  assert.deepEqual(saved, []);

  resolveStart({ syncedToBlock: 42 });
  await runtimePromise;
});

test("shouldSaveSnapshotOnShutdown waits for a finished sync outside reorg recovery", () => {
  assert.equal(
    shouldSaveSnapshotOnShutdown({
      reorgRecovering: false,
      syncCompleted: false,
    }),
    false,
  );
  assert.equal(
    shouldSaveSnapshotOnShutdown({
      reorgRecovering: true,
      syncCompleted: true,
    }),
    false,
  );
  assert.equal(
    shouldSaveSnapshotOnShutdown({
      reorgRecovering: false,
      syncCompleted: true,
    }),
    true,
  );
});

test("runServerRuntime serves the stored snapshot and resyncs from an empty indexer", async () => {
  const events: string[] = [];
  let cache!: SnapshotCache;
  const indexer = {
    applySnapshot: () => {
      events.push("applySnapshot");
    },
    destroy: () => undefined,
    getProcessedBlockNumber: () => 0,
    getStatus: () => ({
      isSyncing: false,
      lastProcessedBlock: 0,
      latestKnownBlock: 0,
      lifecycle: "idle",
    }),
    getTable: () => ({}),
    start: async () => {
      events.push("start");
      assert.equal(cache.getProcessedBlockNumber(), 500);
      return { syncedToBlock: 1 };
    },
    startPolling: () => undefined,
    subscribe: () => undefined,
  };

  const stored = {
    blockNumber: 500,
    data: {
      lastProcessedBlock: 500,
      world: {},
    },
  };
  const store = {
    close: () => undefined,
    createBackupBuffer: async () => Buffer.alloc(0),
    forceSave: () => undefined,
    restore: () => stored,
    save: () => true,
    verifyChunkConsistency: () => {
      events.push("verifyChunkConsistency");
      return true;
    },
  };

  cache = new SnapshotCache(indexer as never);
  const originalRestore = cache.restoreFrom.bind(cache);
  cache.restoreFrom = (data) => {
    events.push("restoreFrom");
    originalRestore(data);
  };

  await runServerRuntime({
    cache,
    config: createTestConfig(),
    contracts: createTestContracts(),
    indexer: indexer as never,
    registerShutdownHandlers: false,
    serveFn: (_options, onListen) => {
      onListen?.({ port: 3001 } as never);
      return { close: () => undefined } as never;
    },
    store: store as never,
  });

  assert.deepEqual(events, ["restoreFrom", "verifyChunkConsistency", "start"]);
  assert.equal(events.includes("applySnapshot"), false);
  assert.equal(indexer.getProcessedBlockNumber(), 0);
});
