/**
 * IndexerService: maintains latest chain table state by syncing block-by-block
 * with debounce. Supports init from off-chain indexer and query API for tx inputs.
 *
 * Lifecycle: idle → bootstrapping → syncing → live → destroyed.
 * Subscriber notifications are only dispatched in the "live" phase so that
 * callers never receive partial state during initial catch-up.
 */

import {
  InitialStateLoader,
  type BootstrapOptions,
} from "./service/bootstrap.ts";
import { BlockSyncer, type SyncOptions } from "./service/BlockSyncer.ts";
import { ChangeEmitter } from "./service/ChangeEmitter.ts";
import { IndexerStore } from "./service/IndexerStore.ts";
import type {
  IndexerChangePayload,
  IndexerLifecycle,
  IndexerSnapshot,
  IndexerStatus,
} from "./types.ts";
import { TABLE_NAMES } from "./types.ts";

export interface IndexerServiceOptions {
  /** Called after each block range is applied. */
  onBlockProcessed?: (fromBlock: number, toBlock: number) => void;
  /** Chain source, optional off-chain snapshot, and start block. */
  bootstrap: BootstrapOptions;
  /** Polling, chunk size, and initial-sync retries. */
  sync?: SyncOptions;
}

export class IndexerService extends IndexerStore {
  private onBlockProcessed?: (fromBlock: number, toBlock: number) => void;

  private readonly syncer: BlockSyncer;
  private readonly initialLoad: InitialStateLoader;
  private lifecycle: IndexerLifecycle = "idle";

  /** Subscribers notified when state changes (after applying updates). */
  private readonly changes = new ChangeEmitter();

  constructor(options: IndexerServiceOptions) {
    const bootstrap = options.bootstrap;
    const sync = options.sync;
    super(Math.max(0, bootstrap.startBlock ?? 0));
    this.onBlockProcessed = options.onBlockProcessed;
    this.syncer = new BlockSyncer({
      source: bootstrap.source,
      store: this,
      debounceMs: sync?.debounceMs ?? 1000,
      pollIntervalMs: sync?.pollIntervalMs ?? 2000,
      maxBlocksPerRequest: Math.max(1, sync?.maxBlocksPerRequest ?? 100),
      maxBackoffMs: Math.max(0, sync?.maxBackoffMs ?? 0),
      initialSyncMaxRetries: sync?.initialSyncMaxRetries,
      onInitialSyncRetry: sync?.onInitialSyncRetry,
      onChunk: (fromBlock, toBlock, committed) => {
        try {
          this.onBlockProcessed?.(fromBlock, toBlock);
        } catch (err) {
          console.error("[IndexerService] onBlockProcessed threw:", err);
        }
        this.notifyListeners({
          tables: committed.tables,
          fromBlock,
          toBlock,
          updatedIdsByTable: committed.updatedIdsByTable,
        });
      },
    });
    this.initialLoad = new InitialStateLoader(bootstrap);
  }

  /** Override the onBlockProcessed callback after construction. */
  setOnBlockProcessed(cb: (fromBlock: number, toBlock: number) => void): void {
    this.onBlockProcessed = cb;
  }

  /** Load full snapshot (e.g. from off-chain indexer) and set lastProcessedBlock. */
  applySnapshot(snapshot: IndexerSnapshot): void {
    const block = this.replaceSnapshot(snapshot);
    this.notifyListeners({
      tables: [...TABLE_NAMES],
      fromBlock: block,
      toBlock: block,
    });
  }

  /**
   * Notify subscribers. Only dispatches during the "live" phase so that
   * initial sync never leaks partial updates to callers.
   */
  private notifyListeners(payload: IndexerChangePayload): void {
    if (this.lifecycle !== "live") return;
    this.changes.emit(payload);
  }

  /**
   * Start the indexer: optionally load snapshot from bootstrapSource (init to block X);
   * otherwise start from startBlock. Then catch up to latest block (no notifications).
   * Once fully synced, transition to "ready" — snapshot is consistent and safe to read,
   * but polling has NOT started yet. Call startPolling() to begin real-time updates.
   *
   * @returns syncedToBlock — the block number at which the snapshot is consistent.
   *   All subsequent subscriber notifications correspond to blocks after this point.
   */
  async start(): Promise<{ syncedToBlock: number }> {
    this.lifecycle = "bootstrapping";
    const snapshot = await this.initialLoad.load();
    if (snapshot) {
      this.installSnapshot(snapshot);
      this.syncer.setLatestKnownBlock(snapshot.lastProcessedBlock);
    } else {
      this.applyStartBlock();
    }

    this.lifecycle = "syncing";
    await this.syncer.catchUp();

    const syncedToBlock = this.processedBlock;

    this.lifecycle = "ready";

    return { syncedToBlock };
  }

  /**
   * Begin real-time polling for new blocks and dispatching notifications.
   * Must be called after start() has completed (lifecycle === "ready").
   * Mirrors the pattern in darkforest-v0.6 where GameManager calls
   * contractsAPI.setupEventListeners() only after game state is loaded.
   */
  startPolling(): void {
    if (this.lifecycle !== "ready") {
      throw new Error(
        `[IndexerService] startPolling() requires lifecycle "ready", ` +
          `current: "${this.lifecycle}"`,
      );
    }
    this.lifecycle = "live";
    this.syncer.startPolling();
  }

  /** Stop polling and clear timer. */
  destroy(): void {
    this.lifecycle = "destroyed";
    this.syncer.stop();
    this.changes.clear();
  }

  /**
   * Subscribe to state changes (e.g. for React re-render).
   * Callback receives which tables were updated so you can update only relevant state.
   * Only fires in the "live" lifecycle phase.
   */
  subscribe(listener: (payload: IndexerChangePayload) => void): () => void {
    return this.changes.subscribe(listener);
  }

  // ---------- Lifecycle ----------

  /** Current lifecycle phase. */
  getLifecycle(): IndexerLifecycle {
    return this.lifecycle;
  }

  /** Whether the service is in "live" mode (initial sync complete, processing real-time blocks). */
  isLive(): boolean {
    return this.lifecycle === "live";
  }

  // ---------- Query API ----------
  // Inherited from IndexerStore. Each line is the method callers already use.
  // getWorld() — the single world row.
  // getPlayer(id) — one player.
  // getPlanet(id) — one planet.
  // getPlanetRevealedCoords(id) — revealed coordinates for a planet.
  // getPlanetEvents(id) — event list on a planet.
  // getPlanetArtifacts(id) — artifacts stored on a planet.
  // getArrival(id) — one arrival.
  // getArtifact(id) — one artifact.
  // getArtifactLocation(id) — where an artifact is.
  // getTable(table, id?) — one row, or the whole table when id is omitted.
  // getPlanetIds() — all planet ids currently in state.
  // getPlayerIds() — all player ids (addresses).
  // getArrivalIds() — all arrival ids.
  // getArtifactIds() — all artifact ids.
  // getArtifactCount() — total number of artifacts in state.
  // getArtifactIdsByOwner(ownerId) — artifact ids whose owner is this address.
  // getArtifactIdsByController(controllerId) — artifact ids controlled by this address.
  // getPlayerMap() — id → PlayerState.
  // getPlanetMap() — id → PlanetState.
  // getArrivalMap() — id → ArrivalState.
  // getRevealedCoordsMap() — id → PlanetRevealedCoordsState.

  /** Sync progress, lifecycle, and the last error. */
  getStatus(): IndexerStatus {
    const sync = this.syncer.status();
    return {
      lastProcessedBlock: this.processedBlock,
      latestKnownBlock: sync.latestKnownBlock,
      isSyncing: sync.isSyncing,
      lifecycle: this.lifecycle,
      consecutiveFailures: sync.consecutiveFailures,
      lastError: sync.lastError,
    };
  }

  /** Last block whose events have been applied. Use for tx inputs (e.g. next_change_block). */
  getProcessedBlockNumber(): number {
    return this.processedBlock;
  }

  /** Hash of the last applied block, when the source reported one. */
  getProcessedBlockHash(): string | undefined {
    return this.processedBlockHash;
  }

  /** Highest block number observed from the chain source. */
  getLatestKnownBlock(): number {
    return this.syncer.status().latestKnownBlock;
  }

  /** Full snapshot JSON, same shape as indexer GET /snapshot. */
  getSnapshotAsJsonString(): string {
    return this.toJsonString();
  }

  /**
   * Returns a promise that resolves when the indexer has processed
   * at least up to the given block number.
   */
  async waitForBlock(blockNumber: number, timeoutMs = 30_000): Promise<void> {
    if (this.processedBlock >= blockNumber) {
      return;
    }

    try {
      await this.syncer.syncNow();
    } catch (err) {
      console.warn("[IndexerService] immediate sync failed:", err);
    }

    if (this.processedBlock >= blockNumber) {
      return;
    }

    return this.changes.waitUntil(
      () => this.processedBlock >= blockNumber,
      timeoutMs,
      new Error(`waitForBlock(${blockNumber}) timed out after ${timeoutMs}ms`),
    );
  }
}
