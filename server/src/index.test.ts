import assert from "node:assert/strict";
import test from "node:test";

import type { ServerRuntimeConfig } from "./config.ts";
import { runServerRuntime } from "./index.ts";
import { SnapshotCache } from "./snapshotCache.ts";

function createTestConfig(): ServerRuntimeConfig {
  return {
    adminToken: "",
    aztecNodeUrl: "https://v4-devnet-2.aztec-labs.com",
    corsOrigins: ["http://localhost:5173"],
    debounceMs: 2000,
    indexerStartBlock: 32202,
    maxBlocksPerRequest: 100,
    networkPreset: "devnet",
    nodeKind: "remote",
    persistMinIntervalSec: 30,
    pollIntervalMs: 10000,
    port: 3001,
    sqlitePath: "/tmp/indexer.db",
  };
}

test("runServerRuntime starts HTTP before initial sync completes", async () => {
  const events: string[] = [];
  let resolveStart!: (value: { syncedToBlock: number }) => void;
  const startPromise = new Promise<{ syncedToBlock: number }>((resolve) => {
    resolveStart = resolve;
  });

  const indexer = {
    applySnapshot: () => {
      events.push("applySnapshot");
    },
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
    forceSave: () => undefined,
    restore: () => null,
    save: () => true,
  };

  const cache = new SnapshotCache(indexer as never);
  const runtimePromise = runServerRuntime({
    cache,
    config: createTestConfig(),
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

  assert.equal(events.includes("subscribe"), true);
  assert.equal(events.includes("startPolling"), true);
});
