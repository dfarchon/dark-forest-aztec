import { serve } from "@hono/node-server";

import {
  createAztecNodeBlockSource,
  IndexerService,
} from "../../packages/indexer-server-core/src/index.ts";
import { createApp } from "./api.ts";
import { parseServerConfig } from "./config.ts";
import { validateContractsConfig } from "./contractsConfig.ts";
import { jsonToSnapshot, SnapshotStore } from "./persistence.ts";
import { SnapshotCache } from "./snapshotCache.ts";

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

  // 3. Try restoring from SQLite
  const stored = store.restore();
  if (stored) {
    const snapshot = jsonToSnapshot(stored.data);
    indexer.applySnapshot(snapshot);
    console.log(
      `[Server] Restored to block ${stored.blockNumber}, catching up...`,
    );
  }

  // 4. Sync to latest block
  const { syncedToBlock } = await indexer.start();
  console.log(`[Server] Synced to block ${syncedToBlock}`);

  // 5. Initialize snapshot cache
  const cache = new SnapshotCache(indexer);
  cache.buildFull();

  // 6. Subscribe to updates: incremental cache + persistence
  indexer.subscribe((payload) => {
    cache.applyChange(payload);
    store.save(cache.getProcessedBlockNumber(), cache.getJsonString());
  });

  // 7. Start real-time polling
  indexer.startPolling();
  console.log(`[Server] Live — polling for new blocks`);

  // 8. Start HTTP server
  const app = createApp({
    indexer,
    cache,
    store,
    adminToken: config.adminToken,
    corsOrigins: config.corsOrigins,
  });
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[Server] HTTP listening on port ${info.port}`);
  });

  // Graceful shutdown: force-save on exit
  const shutdown = () => {
    console.log("[Server] Shutting down...");
    store.forceSave(cache.getProcessedBlockNumber(), cache.getJsonString());
    indexer.destroy();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});
