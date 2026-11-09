import { serve } from "@hono/node-server";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { pathToFileURL } from "node:url";

import {
  createAztecNodeBlockSource,
  IndexerService,
  resolveStorageContractAddresses,
} from "@dfpunk/indexer-core";
import { createApp, type SnapshotPublication } from "./api.ts";
import type { ServerRuntimeConfig } from "./config.ts";
import { parseServerConfig } from "./config.ts";
import type { ContractsRuntimeConfig } from "./contractsConfig.ts";
import { validateContractsConfig } from "./contractsConfig.ts";
import { SnapshotStore } from "./persistence.ts";
import { SnapshotCache } from "./snapshotCache.ts";

interface ServerRuntimeDeps {
  cache: SnapshotCache;
  captureShutdown?: (shutdown: () => void) => void;
  config: ServerRuntimeConfig;
  contracts: ContractsRuntimeConfig;
  indexer: IndexerService;
  loadSnapshotIdentity?: () => Promise<void>;
  publication?: SnapshotPublication;
  registerShutdownHandlers?: boolean;
  serveFn?: typeof serve;
  store: SnapshotStore;
}

/** Persist only a finished sync that is not in the middle of a reorg replay. */
export function shouldSaveSnapshotOnShutdown(state: {
  reorgRecovering: boolean;
  syncCompleted: boolean;
}): boolean {
  return state.syncCompleted && !state.reorgRecovering;
}

export async function runServerRuntime({
  cache,
  captureShutdown,
  config,
  contracts,
  indexer,
  loadSnapshotIdentity,
  publication = { published: false },
  registerShutdownHandlers = true,
  serveFn = serve,
  store,
}: ServerRuntimeDeps): Promise<void> {
  const stored = store.restore();
  if (stored) {
    cache.restoreFrom(stored.data);
    console.log(
      `[Server] Serving stored snapshot at block ${stored.blockNumber}; full resync from startBlock...`,
    );
    store.verifyChunkConsistency(JSON.stringify(stored.data));
  }

  let syncCompleted = false;
  let acceptRecoveryPublish = false;
  const publishSyncedSnapshot = () => {
    cache.buildFull();
    try {
      store.forceSave(cache.getProcessedBlockNumber(), cache.getJsonString());
      publication.published = true;
      syncCompleted = true;
    } catch (err) {
      console.error("[Server] Failed to publish snapshot:", err);
    }
  };

  const app = createApp({
    adminToken: config.adminToken,
    cache,
    corsOrigins: config.corsOrigins,
    indexer,
    publication,
    store,
  });
  serveFn({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[Server] HTTP listening on port ${info.port}`);
  });

  const shutdown = (exit: boolean) => {
    console.log("[Server] Shutting down...");
    if (
      shouldSaveSnapshotOnShutdown({
        reorgRecovering: indexer.getStatus().reorgRecovering,
        syncCompleted,
      })
    ) {
      store.forceSave(cache.getProcessedBlockNumber(), cache.getJsonString());
    } else {
      console.log(
        "[Server] Skipping snapshot save until sync and reorg recovery finish",
      );
    }
    indexer.destroy();
    store.close();
    if (exit) process.exit(0);
  };
  if (registerShutdownHandlers) {
    process.on("SIGINT", () => shutdown(true));
    process.on("SIGTERM", () => shutdown(true));
  }
  captureShutdown?.(() => shutdown(false));

  indexer.setOnReorgRecovered?.(() => {
    if (!acceptRecoveryPublish) return;
    console.log("[Server] Reorg replay finished; publishing snapshot");
    publishSyncedSnapshot();
  });

  const { syncedToBlock } = await indexer.start();
  console.log(`[Server] Synced to block ${syncedToBlock}`);

  if (loadSnapshotIdentity) {
    for (;;) {
      try {
        await loadSnapshotIdentity();
        break;
      } catch (err) {
        console.warn(
          "[Server] Could not read snapshot chain identity; retrying:",
          err,
        );
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  if (!indexer.getStatus().reorgRecovering) {
    publishSyncedSnapshot();
  } else {
    cache.buildFull();
    syncCompleted = true;
  }
  acceptRecoveryPublish = true;
  indexer.subscribe((payload) => {
    if (payload.reorgStarted) return;
    if (payload.fullRefresh) return; // onReorgRecovered already published the complete replay
    cache.applyChange(payload);
    if (indexer.getStatus().reorgRecovering) return;
    try {
      if (store.save(cache.getProcessedBlockNumber(), cache.getJsonString())) {
        publication.published = true;
        syncCompleted = true;
      }
    } catch (err) {
      console.error("[Server] Failed to persist live snapshot:", err);
    }
  });

  indexer.startPolling();
  console.log(`[Server] Live — polling for new blocks`);
}

async function main(): Promise<void> {
  const contracts = validateContractsConfig();
  const config = parseServerConfig();
  console.log(
    `[Server] Aztec node: ${config.aztecNodeUrl} (${config.nodeKind}, tip=${config.indexerTipTag})`,
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
      "[Server] AZTEC_NODE_URL points to localhost; this is local sandbox mode, not the remote testnet.",
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
  const source = createAztecNodeBlockSource(config.aztecNodeUrl, undefined, {
    tipTag: config.indexerTipTag,
    requestTimeoutMs: 30_000,
  });
  const indexer = new IndexerService({
    source,
    startBlock: config.indexerStartBlock,
    debounceMs: 1000,
    pollIntervalMs: 2000,
    maxBlocksPerRequest: 100,
    initialSyncMaxRetries: Infinity,
    maxBackoffMs: 60_000,
    verifyBlockHashes: true,
    onReorgDetected: (info) => {
      console.error(
        `[Server] reorg detected at block ${info.blockNumber}: local=${info.localHash} source=${info.sourceHash}`,
      );
    },
  });

  const cache = new SnapshotCache(indexer);
  await runServerRuntime({
    cache,
    config,
    contracts,
    indexer,
    loadSnapshotIdentity: async () => {
      const nodeInfo = await createAztecNodeClient(
        config.aztecNodeUrl,
      ).getNodeInfo();
      store.setSnapshotIdentity({
        networkId: `${nodeInfo.l1ChainId}:${nodeInfo.l1ContractAddresses.rollupAddress.toString()}`,
        startBlock: config.indexerStartBlock,
        tipTag: config.indexerTipTag,
        schemaVersion: config.snapshotSchemaVersion,
        storageAddresses: resolveStorageContractAddresses(),
      });
    },
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
