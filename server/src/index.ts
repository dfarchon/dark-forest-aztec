import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";

import {
  createAztecNodeBlockSource,
  IndexerService,
} from "../../packages/indexer-server-core/src/index.ts";
import { createApp } from "./api.ts";
import type { ServerRuntimeConfig } from "./config.ts";
import { parseServerConfig } from "./config.ts";
import type { ContractsRuntimeConfig } from "./contractsConfig.ts";
import { validateContractsConfig } from "./contractsConfig.ts";
import { jsonToSnapshot, SnapshotStore } from "./persistence.ts";
import { SnapshotCache } from "./snapshotCache.ts";

interface ServerRuntimeDeps {
  cache: SnapshotCache;
  config: ServerRuntimeConfig;
  contracts: ContractsRuntimeConfig;
  indexer: IndexerService;
  registerShutdownHandlers?: boolean;
  serveFn?: typeof serve;
  store: SnapshotStore;
}

export async function runServerRuntime({
  cache,
  config,
  contracts,
  indexer,
  registerShutdownHandlers = true,
  serveFn = serve,
  store,
}: ServerRuntimeDeps): Promise<void> {
  const stored = store.restore();
  if (stored) {
    const snapshot = jsonToSnapshot(stored.data);
    indexer.applySnapshot(snapshot);
    cache.restoreFrom(stored.data);
    console.log(
      `[Server] Restored to block ${stored.blockNumber}, catching up...`,
    );
    // Phase 1 verification: compare v1 snapshot with v2 chunk reconstruction
    store.verifyChunkConsistency(JSON.stringify(stored.data));
  }

  const app = createApp({
    adminToken: config.adminToken,
    cache,
    corsOrigins: config.corsOrigins,
    indexer,
    store,
  });
  serveFn({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[Server] HTTP listening on port ${info.port}`);
  });

  const shutdown = () => {
    console.log("[Server] Shutting down...");
    store.forceSave(cache.getProcessedBlockNumber(), cache.getJsonString());
    indexer.destroy();
    store.close();
    process.exit(0);
  };
  if (registerShutdownHandlers) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  const { syncedToBlock } = await indexer.start();
  console.log(`[Server] Synced to block ${syncedToBlock}`);

  cache.buildFull();
  indexer.subscribe((payload) => {
    cache.applyChange(payload);
    store.save(cache.getProcessedBlockNumber(), cache.getJsonString());
  });

  indexer.startPolling();
  console.log(`[Server] Live — polling for new blocks`);
}

async function main(): Promise<void> {
  const contracts = validateContractsConfig();
  const config = parseServerConfig();
  console.log(
    `[Server] Aztec node: ${config.aztecNodeUrl} (${config.nodeKind})`,
  );
  console.log(`[Server] Start block: ${config.indexerStartBlock}`);
  console.log(`[Server] Contracts start block: ${contracts.startBlock}`);
  console.log(`[Server] Core contract: ${contracts.addresses.core}`);
  console.log(`[Server] SQLite path: ${config.sqlitePath}`);
  console.log(
    `[Server] CORS origins: ${config.corsOrigins.join(", ") || "(disabled)"}`,
  );
  console.log(
    `[Server] Snapshot schema version: ${config.snapshotSchemaVersion}`,
  );
  if (config.indexerStartBlock !== contracts.startBlock) {
    console.warn(
      `[Server] INDEXER_START_BLOCK override ${config.indexerStartBlock} differs from @dfpunk/contracts START_BLOCK ${contracts.startBlock}.`,
    );
  }
  if (config.nodeKind === "local") {
    console.warn(
      "[Server] AZTEC_NODE_URL points to localhost; this is local sandbox mode, not the remote devnet.",
    );
  }

  // 1. Initialize persistence
  const store = new SnapshotStore(
    config.sqlitePath,
    config.persistMinIntervalSec,
    {
      dbSchemaVersion: 1,
      snapshotSchemaVersion: config.snapshotSchemaVersion,
    },
  );

  // 2. Create IndexerService
  const source = createAztecNodeBlockSource(config.aztecNodeUrl);
  const indexer = new IndexerService({
    source,
    startBlock: config.indexerStartBlock,
    debounceMs: 1000,
    pollIntervalMs: 2000,
    maxBlocksPerRequest: 100,
  });

  const cache = new SnapshotCache(indexer);
  await runServerRuntime({
    cache,
    config,
    contracts,
    indexer,
    store,
  });
}

const isEntrypoint =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((err) => {
    console.error("[Server] Fatal error:", err);
    process.exit(1);
  });
}
