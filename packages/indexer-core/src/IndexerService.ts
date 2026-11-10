/**
 * IndexerService: maintains latest chain table state by syncing block-by-block
 * with debounce. Supports init from off-chain indexer and query API for tx inputs.
 *
 * Lifecycle: idle → bootstrapping → syncing → live → destroyed.
 * Subscriber notifications are only dispatched in the "live" phase so that
 * callers never receive partial state during initial catch-up.
 */

import type {
  ArrivalState,
  ArtifactLocationState,
  ArtifactState,
  PlanetArtifactsState,
  PlanetEventsState,
  PlanetRevealedCoordsState,
  PlanetState,
  PlayerState,
  WorldState,
} from "./TableTypes/chain.ts";
import { loadInitialState } from "./service/bootstrap.ts";
import { BlockSyncer } from "./service/BlockSyncer.ts";
import { ChangeEmitter } from "./service/ChangeEmitter.ts";
import { IndexerStore } from "./service/IndexerStore.ts";
import type {
  IBlockEventSource,
  IndexerChangePayload,
  IndexerLifecycle,
  IndexerSnapshot,
  IndexerStatus,
  PublicEventStats,
  TableId,
  TableName,
  TableRowType,
} from "./types.ts";
import { TABLE_NAMES } from "./types.ts";

export interface IndexerServiceOptions {
  /**
   * Optional bootstrap: used only at start() to load initial state up to block X.
   * Only getSnapshot() is called; never used for getLatestBlockNumber or getBlockUpdates.
   * Typical: off-chain indexer API (e.g. OffChainBlockSource).
   */
  bootstrapSource?: IBlockEventSource;
  /**
   * Chain data source: used for getLatestBlockNumber and getBlockUpdates for the entire
   * lifecycle. All blocks after the bootstrap (or after startBlock) are maintained by the
   * frontend via this source (e.g. AztecNode-based source).
   */
  source: IBlockEventSource;
  /**
   * When no bootstrap snapshot is used, start processing from this block (inclusive).
   * Ignored if bootstrapSource.getSnapshot() returns a snapshot. Default 0 (process from block 1).
   */
  startBlock?: number;
  /** Debounce delay in ms for processing new blocks. Default 1000. */
  debounceMs?: number;
  /** Poll interval for latest block when not using push. Default 2000. */
  pollIntervalMs?: number;
  /**
   * Max blocks per getBlockUpdates call when syncing from chain. Prevents a single
   * huge request (e.g. 1 to 50000). Default 100; tune to match node/RPC limits (e.g. 50–200).
   */
  maxBlocksPerRequest?: number;
  /** Called after each block range is applied. */
  onBlockProcessed?: (fromBlock: number, toBlock: number) => void;
  /** Max wait between background retries after failures; 0 = no backoff (current behavior). */
  maxBackoffMs?: number;
  /** Attempts for the initial sync in start(); 1 = no retry (current behavior). */
  initialSyncMaxRetries?: number;
  /**
   * Called before waiting to retry a failed initial sync. Not called on the
   * attempt that exhausts initialSyncMaxRetries and rejects start().
   */
  onInitialSyncRetry?: (
    attempt: number,
    waitMs: number,
    error: unknown,
  ) => void;
  /**
   * Before using a bootstrap snapshot, check its last block hash on the source;
   * discard it on mismatch. Default false.
   */
  verifyBootstrapSnapshot?: boolean;
}

export class IndexerService {
  private readonly bootstrapSource: IBlockEventSource | undefined;
  private readonly source: IBlockEventSource;
  private readonly startBlock: number;
  private readonly initialSyncMaxRetries: number;
  private readonly onInitialSyncRetry?: IndexerServiceOptions["onInitialSyncRetry"];
  private readonly verifyBootstrapSnapshot: boolean;
  private onBlockProcessed?: (fromBlock: number, toBlock: number) => void;

  private readonly store: IndexerStore;
  private readonly syncer: BlockSyncer;
  private lifecycle: IndexerLifecycle = "idle";

  /** Subscribers notified when state changes (after applying updates). */
  private readonly changes = new ChangeEmitter();

  constructor(options: IndexerServiceOptions) {
    this.bootstrapSource = options.bootstrapSource;
    this.source = options.source;
    this.startBlock = Math.max(0, options.startBlock ?? 0);
    this.initialSyncMaxRetries = Math.max(
      1,
      options.initialSyncMaxRetries ?? 1,
    );
    this.onInitialSyncRetry = options.onInitialSyncRetry;
    this.verifyBootstrapSnapshot = options.verifyBootstrapSnapshot ?? false;
    this.onBlockProcessed = options.onBlockProcessed;
    this.store = new IndexerStore(this.startBlock);
    this.syncer = new BlockSyncer({
      source: this.source,
      store: this.store,
      debounceMs: options.debounceMs ?? 1000,
      pollIntervalMs: options.pollIntervalMs ?? 2000,
      maxBlocksPerRequest: Math.max(1, options.maxBlocksPerRequest ?? 100),
      maxBackoffMs: Math.max(0, options.maxBackoffMs ?? 0),
      isStopped: () => this.lifecycle === "destroyed",
      onChunk: (fromBlock, toBlock, committed) => {
        this.onBlockProcessed?.(fromBlock, toBlock);
        this.notifyListeners({
          tables: committed.tables,
          fromBlock,
          toBlock,
          updatedIdsByTable: committed.updatedIdsByTable,
        });
      },
    });
  }

  /** Override the onBlockProcessed callback after construction. */
  setOnBlockProcessed(cb: (fromBlock: number, toBlock: number) => void): void {
    this.onBlockProcessed = cb;
  }

  /** Load full snapshot (e.g. from off-chain indexer) and set lastProcessedBlock. */
  applySnapshot(snapshot: IndexerSnapshot): void {
    const block = this.store.replaceSnapshot(snapshot);
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
    const loaded = await loadInitialState({
      bootstrapSource: this.bootstrapSource,
      source: this.source,
      verify: this.verifyBootstrapSnapshot,
    });
    if (loaded.snapshot) {
      this.store.replaceSnapshot(loaded.snapshot);
      this.syncer.setTip(loaded.snapshot.lastProcessedBlock);
    } else {
      if (loaded.clear) this.store.clear();
      if (loaded.statsResetBlock !== undefined) {
        this.store.resetStatsAfterSnapshot(loaded.statsResetBlock);
      }
      if (loaded.resetTip) this.syncer.setTip(0);
      if (this.startBlock > 0) this.store.resetTo(this.startBlock - 1);
      if (this.store.processedBlock === 0) {
        this.store.markStatsComplete(Math.max(1, this.startBlock));
      }
    }

    this.lifecycle = "syncing";
    await this.syncer.catchUp({
      maxRetries: this.initialSyncMaxRetries,
      onRetry: this.onInitialSyncRetry,
    });

    const syncedToBlock = this.store.processedBlock;

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

  getStatus(): IndexerStatus {
    const sync = this.syncer.status();
    return {
      lastProcessedBlock: this.store.processedBlock,
      latestKnownBlock: sync.latestKnownBlock,
      isSyncing: sync.isSyncing,
      lifecycle: this.lifecycle,
      consecutiveFailures: sync.consecutiveFailures,
      lastError: sync.lastError,
    };
  }

  /** Last block whose events have been applied. Use for tx inputs (e.g. next_change_block). */
  getProcessedBlockNumber(): number {
    return this.store.processedBlock;
  }

  /** Hash of the last applied block, when the source reported one. */
  getProcessedBlockHash(): string | undefined {
    return this.store.processedBlockHash;
  }

  getLatestKnownBlock(): number {
    return this.syncer.status().latestKnownBlock;
  }

  /** Public events fetched from the node, counted before same-id rows overwrite. */
  getPublicEventStats(): PublicEventStats {
    return this.store.getPublicEventStats();
  }

  getWorld(): WorldState | undefined {
    return this.store.getWorld();
  }

  getPlayer(id: TableId): PlayerState | undefined {
    return this.store.getPlayer(id);
  }

  getPlanet(id: TableId): PlanetState | undefined {
    return this.store.getPlanet(id);
  }

  getPlanetRevealedCoords(id: TableId): PlanetRevealedCoordsState | undefined {
    return this.store.getPlanetRevealedCoords(id);
  }

  getPlanetEvents(id: TableId): PlanetEventsState | undefined {
    return this.store.getPlanetEvents(id);
  }

  getPlanetArtifacts(id: TableId): PlanetArtifactsState | undefined {
    return this.store.getPlanetArtifacts(id);
  }

  getArrival(id: TableId): ArrivalState | undefined {
    return this.store.getArrival(id);
  }

  getArtifact(id: TableId): ArtifactState | undefined {
    return this.store.getArtifact(id);
  }

  getArtifactLocation(id: TableId): ArtifactLocationState | undefined {
    return this.store.getArtifactLocation(id);
  }

  /** Generic: get table row(s). Typed by table name for function inputs. */
  getTable<K extends TableName>(
    table: K,
    id?: TableId,
  ): TableRowType[K] | Record<string, TableRowType[K]> | undefined {
    return this.store.getTable(table, id);
  }

  /**
   * Full snapshot as JSON string (same shape as indexer GET /snapshot).
   * Use for debugging or exporting the current synced state.
   */
  getSnapshotAsJsonString(): string {
    return this.store.toJsonString();
  }

  /** All planet ids currently in state. */
  getPlanetIds(): string[] {
    return this.store.getPlanetIds();
  }

  /** All player ids (addresses). */
  getPlayerIds(): string[] {
    return this.store.getPlayerIds();
  }

  /** All arrival ids. */
  getArrivalIds(): string[] {
    return this.store.getArrivalIds();
  }

  /** All artifact ids. */
  getArtifactIds(): string[] {
    return this.store.getArtifactIds();
  }

  /** Total number of artifacts in state. */
  getArtifactCount(): number {
    return this.store.getArtifactCount();
  }

  /** Artifact ids owned by the given address (via owner field). */
  getArtifactIdsByOwner(ownerId: string): string[] {
    return this.store.getArtifactIdsByOwner(ownerId);
  }

  /** Artifact ids controlled by the given address (via controller field). */
  getArtifactIdsByController(controllerId: string): string[] {
    return this.store.getArtifactIdsByController(controllerId);
  }

  /** Full player map (id → PlayerState). */
  getPlayerMap(): Map<string, PlayerState> {
    return this.store.getPlayerMap();
  }

  /** Full planet map (id → PlanetState). */
  getPlanetMap(): Map<string, PlanetState> {
    return this.store.getPlanetMap();
  }

  /** Full arrival map (id → ArrivalState). */
  getArrivalMap(): Map<string, ArrivalState> {
    return this.store.getArrivalMap();
  }

  /** Full revealed coords map (id → PlanetRevealedCoordsState). */
  getRevealedCoordsMap(): Map<string, PlanetRevealedCoordsState> {
    return this.store.getRevealedCoordsMap();
  }

  /**
   * Returns a promise that resolves when the indexer has processed
   * at least up to the given block number.
   */
  async waitForBlock(blockNumber: number, timeoutMs = 30_000): Promise<void> {
    if (this.store.processedBlock >= blockNumber) {
      return;
    }

    try {
      await this.syncer.syncNow();
    } catch (err) {
      console.warn("[IndexerService] immediate sync failed:", err);
    }

    if (this.store.processedBlock >= blockNumber) {
      return;
    }

    return this.changes.waitUntil(
      () => this.store.processedBlock >= blockNumber,
      timeoutMs,
      new Error(`waitForBlock(${blockNumber}) timed out after ${timeoutMs}ms`),
    );
  }
}
