/**
 * IndexerService: maintains latest chain table state by syncing block-by-block
 * with debounce. Supports init from off-chain indexer and query API for tx inputs.
 *
 * Lifecycle: idle → bootstrapping → syncing → live → destroyed.
 * Subscriber notifications are only dispatched in the "live" phase so that
 * callers never receive partial state during initial catch-up.
 */

import lodash from "lodash";
import type { DebouncedFunc } from "lodash";
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
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxBlocksPerRequest: number;
  private readonly maxBackoffMs: number;
  private readonly initialSyncMaxRetries: number;
  private readonly onInitialSyncRetry?: IndexerServiceOptions["onInitialSyncRetry"];
  private readonly verifyBootstrapSnapshot: boolean;
  private onBlockProcessed?: (fromBlock: number, toBlock: number) => void;

  private readonly store: IndexerStore;
  private latestKnownBlock: number = 0;
  private isSyncing: boolean = false;
  private syncPromise: Promise<void> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly debouncedProcess: DebouncedFunc<() => void>;
  private lifecycle: IndexerLifecycle = "idle";
  private consecutiveFailures = 0;
  private nextRetryAt = 0;
  private lastError: string | undefined;

  /** Subscribers notified when state changes (after applying updates). */
  private readonly changes = new ChangeEmitter();

  constructor(options: IndexerServiceOptions) {
    this.bootstrapSource = options.bootstrapSource;
    this.source = options.source;
    this.startBlock = Math.max(0, options.startBlock ?? 0);
    this.debounceMs = options.debounceMs ?? 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxBlocksPerRequest = Math.max(1, options.maxBlocksPerRequest ?? 100);
    this.maxBackoffMs = Math.max(0, options.maxBackoffMs ?? 0);
    this.initialSyncMaxRetries = Math.max(
      1,
      options.initialSyncMaxRetries ?? 1,
    );
    this.onInitialSyncRetry = options.onInitialSyncRetry;
    this.verifyBootstrapSnapshot = options.verifyBootstrapSnapshot ?? false;
    this.onBlockProcessed = options.onBlockProcessed;
    this.store = new IndexerStore(this.startBlock);

    // Background (poll/push) syncs are fire-and-forget: log failures here so
    // rethrown sync errors never become unhandled rejections. The next poll
    // cycle retries from lastProcessedBlock + 1, after the backoff if one is set.
    this.debouncedProcess = lodash.debounce(
      () => {
        if (this.isDestroyed()) return;
        if (Date.now() < this.nextRetryAt) return;
        this.processNewBlocks()
          .then(() => {
            this.consecutiveFailures = 0;
            this.lastError = undefined;
            this.nextRetryAt = 0;
          })
          .catch((err) => {
            this.noteSyncFailure(err);
          });
      },
      this.debounceMs,
      { leading: true, trailing: true },
    );

    /** Called when we learn of a new latest block (poll or push). */
    this.onLatestBlock = (latest: number) => {
      this.latestKnownBlock = Math.max(this.latestKnownBlock, latest);
      this.debouncedProcess();
    };
  }

  private onLatestBlock: (latest: number) => void;

  /** Override the onBlockProcessed callback after construction. */
  setOnBlockProcessed(cb: (fromBlock: number, toBlock: number) => void): void {
    this.onBlockProcessed = cb;
  }

  /**
   * Process blocks from (lastProcessedBlock + 1) up to latestKnownBlock in chunks of
   * at most maxBlocksPerRequest to avoid a single huge getBlockUpdates call.
   */
  private async processNewBlocks(options?: {
    ignoreBackoff?: boolean;
  }): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    const syncPromise = this.processPendingBlocks(options);
    this.syncPromise = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (this.syncPromise === syncPromise) {
        this.syncPromise = undefined;
      }
    }
  }

  private backoffMs(): number {
    if (this.maxBackoffMs <= 0) return 0;
    // 2s, 4s, 8s, ... capped at maxBackoffMs
    return Math.min(
      this.maxBackoffMs,
      2_000 * 2 ** Math.max(0, this.consecutiveFailures - 1),
    );
  }

  private noteSyncFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    this.lastError = err instanceof Error ? err.message : String(err);
    const wait = this.backoffMs();
    this.nextRetryAt = Date.now() + wait;
    console.warn(
      `[IndexerService] sync failed (${this.consecutiveFailures}x), retry in ${wait}ms:`,
      err,
    );
  }

  private isDestroyed(): boolean {
    return this.lifecycle === "destroyed";
  }

  private async processPendingBlocks(options?: {
    ignoreBackoff?: boolean;
  }): Promise<void> {
    if (this.isDestroyed()) return;
    if (!options?.ignoreBackoff && Date.now() < this.nextRetryAt) return;

    let fromBlock = this.store.processedBlock + 1;
    const toBlock = this.latestKnownBlock;
    if (fromBlock > toBlock) return;

    this.isSyncing = true;
    try {
      while (fromBlock <= toBlock) {
        if (this.isDestroyed()) return;
        const chunkEnd = Math.min(
          fromBlock + this.maxBlocksPerRequest - 1,
          toBlock,
        );
        const updates = await this.source.getBlockUpdates(fromBlock, chunkEnd);
        if (this.isDestroyed()) return;
        const committedTo = updates.toBlock;
        if (committedTo < fromBlock) break; // node behind; retry next poll
        const committed = this.store.commit(updates);
        this.onBlockProcessed?.(fromBlock, committed.toBlock);
        this.notifyListeners({
          tables: committed.tables,
          fromBlock,
          toBlock: committed.toBlock,
          updatedIdsByTable: committed.updatedIdsByTable,
        });
        if (committedTo < chunkEnd) break;
        fromBlock = committedTo + 1;
      }
    } finally {
      // Errors propagate to the caller: start() rejects during initial sync,
      // background syncs log via the debounce catch boundary. Fully committed
      // chunks are kept; the next sync resumes from lastProcessedBlock + 1.
      this.isSyncing = false;
    }
  }

  /**
   * Immediately fetches the node's latest L2 tip and processes any missing blocks.
   * Concurrent callers share the in-flight processing work.
   */
  private async syncToLatest(): Promise<void> {
    const latest = await this.source.getLatestBlockNumber();
    this.latestKnownBlock = Math.max(this.latestKnownBlock, latest);
    await this.processNewBlocks({ ignoreBackoff: true });
    if (this.store.processedBlock < this.latestKnownBlock) {
      await this.processNewBlocks({ ignoreBackoff: true });
    }
    this.consecutiveFailures = 0;
    this.lastError = undefined;
    this.nextRetryAt = 0;
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
    let snapshotLoaded = false;
    if (this.bootstrapSource?.getSnapshot) {
      try {
        const snap = await this.bootstrapSource.getSnapshot();
        if (snap) {
          this.store.replaceSnapshot(snap);
          this.latestKnownBlock = snap.lastProcessedBlock;
          snapshotLoaded = true;
        }
      } catch (err) {
        console.warn(
          "[IndexerService] bootstrap snapshot rejected, falling back to full sync:",
          err,
        );
        this.store.clear();
        snapshotLoaded = false;
      }
    }
    if (snapshotLoaded && this.verifyBootstrapSnapshot) {
      const ok = await this.verifyBootstrapHash();
      if (!ok) {
        this.store.clear();
        this.latestKnownBlock = 0;
        snapshotLoaded = false;
      }
    }
    if (!snapshotLoaded && this.startBlock > 0) {
      this.store.resetTo(this.startBlock - 1);
    }
    if (!snapshotLoaded && this.store.processedBlock === 0) {
      this.store.markStatsComplete(Math.max(1, this.startBlock));
    }

    this.lifecycle = "syncing";
    for (let attempt = 1; ; attempt++) {
      try {
        this.latestKnownBlock = await this.source.getLatestBlockNumber();
        await this.processNewBlocks();
        if (this.store.processedBlock < this.latestKnownBlock) {
          // The node may have been behind the previously observed tip. Refresh once.
          this.latestKnownBlock = await this.source.getLatestBlockNumber();
          await this.processNewBlocks();
        }
        if (this.store.processedBlock < this.latestKnownBlock) {
          console.warn(
            `[IndexerService] initial sync incomplete: processed up to block ` +
              `${this.store.processedBlock}, expected ${this.latestKnownBlock}. ` +
              `Will continue from the next poll.`,
          );
        }
        this.consecutiveFailures = 0;
        this.lastError = undefined;
        this.nextRetryAt = 0;
        break;
      } catch (err) {
        this.consecutiveFailures = attempt;
        this.lastError = err instanceof Error ? err.message : String(err);
        if (attempt >= this.initialSyncMaxRetries) throw err;
        const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
        this.onInitialSyncRetry?.(attempt, wait, err);
        console.warn(
          `[IndexerService] initial sync failed (attempt ${attempt}), retry in ${wait}ms:`,
          err,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    const syncedToBlock = this.store.processedBlock;

    this.lifecycle = "ready";

    return { syncedToBlock };
  }

  /**
   * Compare the bootstrap snapshot's last block hash with the chain source.
   * Missing hash, a missing block, or a failed request accepts the snapshot.
   * A present hash that differs discards it.
   */
  private async verifyBootstrapHash(): Promise<boolean> {
    const n = this.store.processedBlock;
    const expected = this.store.processedBlockHash;
    if (!expected || n <= 0 || !this.source.getBlockHash) return true;
    try {
      const actual = await this.source.getBlockHash(n);
      if (actual === undefined) {
        console.warn(
          `[IndexerService] snapshot block ${n} not found on node yet; accepting snapshot`,
        );
        return true;
      }
      if (actual === expected) return true;
      console.error(
        `[IndexerService] snapshot hash mismatch at block ${n}: snapshot=${expected} node=${actual}; falling back to full sync`,
      );
      return false;
    } catch (err) {
      console.warn(
        "[IndexerService] snapshot hash check failed; accepting snapshot:",
        err,
      );
      return true;
    }
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

    this.pollTimer = setInterval(async () => {
      if (this.lifecycle === "destroyed") return;
      if (Date.now() < this.nextRetryAt) return;
      try {
        const next = await this.source.getLatestBlockNumber();
        this.onLatestBlock(next);
      } catch (err) {
        this.noteSyncFailure(err);
      }
    }, this.pollIntervalMs);
  }

  /** Stop polling and clear timer. */
  destroy(): void {
    this.lifecycle = "destroyed";
    this.debouncedProcess.cancel();
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
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
    return {
      lastProcessedBlock: this.store.processedBlock,
      latestKnownBlock: this.latestKnownBlock,
      isSyncing: this.isSyncing,
      lifecycle: this.lifecycle,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
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
    return this.latestKnownBlock;
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
      await this.syncToLatest();
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
