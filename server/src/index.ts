import { serve } from "@hono/node-server";
import { START_BLOCK } from "@dfpunk/contracts";

import { createApp } from "./api.ts";
import { createAztecNodeBlockSource } from "./indexer/AztecNodeSource.ts";
import { IndexerService } from "./indexer/IndexerService.ts";
import { jsonToSnapshot, SnapshotStore } from "./persistence.ts";
import { SnapshotCache } from "./snapshotCache.ts";

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const PORT = Number(process.env.PORT ?? 3001);
const SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/indexer.db";
const PERSIST_MIN_INTERVAL_SEC = Number(
  process.env.PERSIST_MIN_INTERVAL_SEC ?? 10
);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const CORS_ORIGINS = (process.env.CORS_ORIGINS ??
  "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

async function main(): Promise<void> {
  console.log(`[Server] Aztec node: ${AZTEC_NODE_URL}`);
  console.log(`[Server] SQLite path: ${SQLITE_PATH}`);
  console.log(`[Server] CORS origins: ${CORS_ORIGINS.join(", ") || "(disabled)"}`);

  // 1. Initialize persistence
  const store = new SnapshotStore(SQLITE_PATH, PERSIST_MIN_INTERVAL_SEC);

  // 2. Create IndexerService
  const source = createAztecNodeBlockSource(AZTEC_NODE_URL);
  const indexer = new IndexerService({
    source,
    startBlock: START_BLOCK,
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
      `[Server] Restored to block ${stored.blockNumber}, catching up...`
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
    adminToken: ADMIN_TOKEN,
    corsOrigins: CORS_ORIGINS,
  });
  serve({ fetch: app.fetch, port: PORT }, (info) => {
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
