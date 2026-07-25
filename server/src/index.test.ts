import assert from "node:assert/strict";
import test from "node:test";

import type { ContractsRuntimeConfig } from "./contractsConfig.ts";
import type { ServerRuntimeConfig } from "./config.ts";
import { runServerRuntime } from "./index.ts";
import { SnapshotCache } from "./snapshotCache.ts";

function createTestConfig(): ServerRuntimeConfig {
  return {
    adminToken: "",
    aztecNodeUrl: "https://canonical.testnet.rpc.aztec-labs.com",
    aztecNodeUrlBackup: "",
    corsOrigins: ["http://localhost:5173"],
    indexerStartBlock: 32202,
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

  assert.equal(events.includes("subscribe"), true);
  assert.equal(events.includes("startPolling"), true);
});
