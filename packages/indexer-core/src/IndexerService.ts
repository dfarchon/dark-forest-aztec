/**
 * IndexerService: maintains latest chain table state by syncing block-by-block
 * with debounce. Supports init from off-chain indexer and query API for tx inputs.
 *
 * Lifecycle: idle → bootstrapping → syncing → live → destroyed.
 * Subscriber notifications are only dispatched in the "live" phase so that
 * callers never receive partial state during initial catch-up.
 */

import { rawIdToTableId, rawToState } from "./convert.ts";
import { debounce } from "./debounce.ts";
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
import type {
  BlockUpdates,
  IBlockEventSource,
  IndexerChangePayload,
  IndexerLifecycle,
  IndexerSnapshot,
  IndexerStatus,
  TableId,
  TableName,
  TableRowType,
  TableUpdate,
} from "./types.ts";
import { TABLE_NAMES } from "./types.ts";

type Raw = Record<string, unknown>;

function emptySnapshot(): IndexerSnapshot {
  return {
    lastProcessedBlock: 0,
    world: new Map(),
    player: new Map(),
    planet: new Map(),
    planet_revealed_coords: new Map(),
    planet_events: new Map(),
    planet_artifacts: new Map(),
    arrival: new Map(),
    artifact: new Map(),
    artifact_location: new Map(),
  };
}

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
  /**
   * Keep lastProcessedBlock this many blocks behind the node tip and re-read
   * that window on every sync so late public logs can overwrite rows.
   * Default 2. Set 0 to mark the tip processed immediately.
   */
  confirmationDepth?: number;
  /** Called after each block range is applied. */
  onBlockProcessed?: (fromBlock: number, toBlock: number) => void;
}

export const DEFAULT_CONFIRMATION_DEPTH = 2;

export class IndexerService {
  private readonly bootstrapSource: IBlockEventSource | undefined;
  private readonly source: IBlockEventSource;
  private readonly startBlock: number;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxBlocksPerRequest: number;
  private readonly confirmationDepth: number;
  private onBlockProcessed?: (fromBlock: number, toBlock: number) => void;

  private snapshot: IndexerSnapshot = emptySnapshot();
  private latestKnownBlock: number = 0;
  private isSyncing: boolean = false;
  private syncPromise: Promise<void> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lifecycle: IndexerLifecycle = "idle";

  /** Secondary index: artifact owner -> set of artifact ids. */
  private ownerArtifactIndex = new Map<string, Set<string>>();
  /** Secondary index: artifact controller -> set of artifact ids. */
  private controllerArtifactIndex = new Map<string, Set<string>>();

  /** Subscribers notified when state changes (after applying updates). */
  private listeners = new Set<(payload: IndexerChangePayload) => void>();

  constructor(options: IndexerServiceOptions) {
    this.bootstrapSource = options.bootstrapSource;
    this.source = options.source;
    this.startBlock = Math.max(0, options.startBlock ?? 0);
    this.debounceMs = options.debounceMs ?? 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxBlocksPerRequest = Math.max(1, options.maxBlocksPerRequest ?? 100);
    this.confirmationDepth = Math.max(
      0,
      options.confirmationDepth ?? DEFAULT_CONFIRMATION_DEPTH,
    );
    this.onBlockProcessed = options.onBlockProcessed;

    // Background (poll/push) syncs are fire-and-forget: log failures here so
    // rethrown sync errors never become unhandled rejections. The next poll
    // cycle retries from lastProcessedBlock + 1.
    const debouncedProcess = debounce(
      () => {
        this.processNewBlocks().catch((err) => {
          console.warn(
            "[IndexerService] background sync failed (will retry on next poll):",
            err,
          );
        });
      },
      this.debounceMs,
      true,
      true,
    );

    /** Called when we learn of a new latest block (poll or push). */
    this.onLatestBlock = (latest: number) => {
      this.latestKnownBlock = Math.max(this.latestKnownBlock, latest);
      debouncedProcess();
    };
  }

  private onLatestBlock: (latest: number) => void;

  /** Override the onBlockProcessed callback after construction. */
  setOnBlockProcessed(cb: (fromBlock: number, toBlock: number) => void): void {
    this.onBlockProcessed = cb;
  }

  /**
   * First block the service will ever request (inclusive).
   * startBlock 0 means process from block 1; otherwise process from startBlock.
   */
  private firstProcessableBlock(): number {
    return this.startBlock > 0 ? this.startBlock : 1;
  }

  /** Cursor floor: lastProcessedBlock starts here before any events are applied. */
  private cursorFloor(): number {
    return this.firstProcessableBlock() - 1;
  }

  /** Highest block that is safe to mark processed: tip minus confirmation depth. */
  private safeTip(latest = this.latestKnownBlock): number {
    return Math.max(this.cursorFloor(), latest - this.confirmationDepth);
  }

  /**
   * Inclusive start of the next fetch. Rewinds confirmationDepth blocks so
   * late public logs overwrite rows already written for that window.
   */
  private replayFrom(lastProcessed: number): number {
    const first = this.firstProcessableBlock();
    if (lastProcessed < first) return first;
    return Math.max(first, lastProcessed - this.confirmationDepth + 1);
  }

  /**
   * Process blocks from the confirmation rewind window up to the safe tip
   * in chunks of at most maxBlocksPerRequest.
   */
  private async processNewBlocks(): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    const syncPromise = this.processPendingBlocks();
    this.syncPromise = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (this.syncPromise === syncPromise) {
        this.syncPromise = undefined;
      }
    }
  }

  private async processPendingBlocks(): Promise<void> {
    const toBlock = this.safeTip();
    const fromBlock = this.replayFrom(this.snapshot.lastProcessedBlock);
    if (fromBlock > toBlock) return;

    this.isSyncing = true;
    try {
      await this.applyBlockRange(fromBlock, toBlock, { advanceCursor: true });
    } finally {
      // Errors propagate to the caller: start() rejects during initial sync,
      // background syncs log via the debounce catch boundary. Fully committed
      // chunks are kept; the next sync resumes from lastProcessedBlock + 1.
      this.isSyncing = false;
    }
  }

  /**
   * Fetch and apply [fromBlock, toBlock]. When advanceCursor is true, move
   * lastProcessedBlock with each committed chunk (never past the safe tip).
   */
  private async applyBlockRange(
    fromBlock: number,
    toBlock: number,
    options: { advanceCursor: boolean },
  ): Promise<void> {
    let from = fromBlock;
    while (from <= toBlock) {
      const chunkEnd = Math.min(from + this.maxBlocksPerRequest - 1, toBlock);
      const updates = await this.source.getBlockUpdates(from, chunkEnd);
      this.applyUpdates(updates);
      if (options.advanceCursor) {
        this.snapshot.lastProcessedBlock = Math.min(chunkEnd, this.safeTip());
      }
      this.onBlockProcessed?.(from, chunkEnd);
      const tables = [
        ...new Set(updates.updates.map((u) => u.table)),
      ] as TableName[];
      const updatedIdsByTable = this.buildUpdatedIdsByTable(updates);
      this.notifyListeners({
        tables,
        fromBlock: from,
        toBlock: chunkEnd,
        updatedIdsByTable,
      });
      from = chunkEnd + 1;
    }
  }

  /**
   * Immediately fetches the node's latest L2 tip and processes any missing blocks.
   * Concurrent callers share the in-flight processing work.
   */
  private async syncToLatest(): Promise<void> {
    const latest = await this.source.getLatestBlockNumber();
    this.latestKnownBlock = Math.max(this.latestKnownBlock, latest);
    await this.processNewBlocks();
    if (this.snapshot.lastProcessedBlock < this.safeTip()) {
      await this.processNewBlocks();
    }
  }

  /** Build per-table list of row ids that were updated in this batch. */
  private buildUpdatedIdsByTable(
    updates: BlockUpdates,
  ): Partial<Record<TableName, TableId[]>> {
    const byTable = new Map<TableName, Set<TableId>>();
    for (const u of updates.updates) {
      const id = rawIdToTableId(u.table, (u as { id?: unknown }).id);
      let set = byTable.get(u.table);
      if (!set) {
        set = new Set();
        byTable.set(u.table, set);
      }
      set.add(id);
    }
    const out: Partial<Record<TableName, TableId[]>> = {};
    byTable.forEach((ids, table) => {
      out[table] = [...ids];
    });
    return out;
  }

  /**
   * Apply a single BlockUpdates to current snapshot atomically: convert every
   * row first (phase 1, no mutation), then commit all rows (phase 2). A bad
   * row therefore cannot leave the snapshot partially updated across tables
   * (e.g. planet_events written while its arrival row is missing).
   */
  private applyUpdates(updates: BlockUpdates): void {
    const pending: Array<{ table: TableName; id: TableId; state: unknown }> =
      [];
    for (const u of updates.updates) {
      const id = rawIdToTableId(u.table, (u as { id?: unknown }).id);
      const rawState = (u as TableUpdate<Raw>).state as Raw;
      pending.push({
        table: u.table,
        id,
        state: rawToState(u.table, rawState),
      });
    }

    for (const p of pending) {
      const tableMap = this.snapshot[p.table] as Map<TableId, unknown>;

      if (p.table === "artifact") {
        const oldState = tableMap.get(p.id) as ArtifactState | undefined;
        this.updateArtifactIndexes(p.id, oldState, p.state as ArtifactState);
      }

      tableMap.set(p.id, p.state);
    }
  }

  /**
   * Maintain ownerArtifactIndex and controllerArtifactIndex when an artifact
   * row is inserted or updated. Handles removal from old owner/controller sets
   * and insertion into new ones.
   */
  private updateArtifactIndexes(
    artifactId: string,
    oldState: ArtifactState | undefined,
    newState: ArtifactState,
  ): void {
    if (oldState?.owner !== newState.owner) {
      if (oldState) {
        this.ownerArtifactIndex.get(oldState.owner)?.delete(artifactId);
      }
      if (newState.owner) {
        let set = this.ownerArtifactIndex.get(newState.owner);
        if (!set) {
          set = new Set();
          this.ownerArtifactIndex.set(newState.owner, set);
        }
        set.add(artifactId);
      }
    }

    if (oldState?.controller !== newState.controller) {
      if (oldState) {
        this.controllerArtifactIndex
          .get(oldState.controller)
          ?.delete(artifactId);
      }
      if (newState.controller) {
        let set = this.controllerArtifactIndex.get(newState.controller);
        if (!set) {
          set = new Set();
          this.controllerArtifactIndex.set(newState.controller, set);
        }
        set.add(artifactId);
      }
    }
  }

  /** Rebuild both artifact secondary indexes from the current snapshot. */
  private rebuildArtifactIndexes(): void {
    this.ownerArtifactIndex.clear();
    this.controllerArtifactIndex.clear();
    const artifactMap = this.snapshot.artifact as Map<string, ArtifactState>;
    for (const [id, state] of artifactMap) {
      if (state.owner) {
        let set = this.ownerArtifactIndex.get(state.owner);
        if (!set) {
          set = new Set();
          this.ownerArtifactIndex.set(state.owner, set);
        }
        set.add(id);
      }
      if (state.controller) {
        let set = this.controllerArtifactIndex.get(state.controller);
        if (!set) {
          set = new Set();
          this.controllerArtifactIndex.set(state.controller, set);
        }
        set.add(id);
      }
    }
  }

  /** Load full snapshot (e.g. from off-chain indexer) and set lastProcessedBlock. */
  applySnapshot(snapshot: IndexerSnapshot): void {
    this.snapshot = snapshot;
    this.rebuildArtifactIndexes();
    const block = snapshot.lastProcessedBlock;
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
    this.listeners.forEach((cb) => cb(payload));
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
          this.snapshot = snap;
          this.rebuildArtifactIndexes();
          this.latestKnownBlock = snap.lastProcessedBlock;
          snapshotLoaded = true;
        }
      } catch (err) {
        console.warn("[IndexerService] bootstrap getSnapshot failed:", err);
      }
    }
    if (!snapshotLoaded && this.startBlock > 0) {
      this.snapshot.lastProcessedBlock = this.startBlock - 1;
    }

    this.lifecycle = "syncing";
    const latest = await this.source.getLatestBlockNumber();
    this.latestKnownBlock = latest;
    await this.processNewBlocks();

    const expected = this.safeTip(this.latestKnownBlock);
    if (this.snapshot.lastProcessedBlock < expected) {
      throw new Error(
        `[IndexerService] initial sync incomplete: processed up to block ` +
          `${this.snapshot.lastProcessedBlock}, expected ${expected}` +
          ` (tip ${this.latestKnownBlock}, confirmationDepth ${this.confirmationDepth})`,
      );
    }

    const syncedToBlock = this.snapshot.lastProcessedBlock;

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

    this.pollTimer = setInterval(async () => {
      if (this.lifecycle === "destroyed") return;
      try {
        const next = await this.source.getLatestBlockNumber();
        this.onLatestBlock(next);
      } catch (err) {
        console.warn("[IndexerService] poll getLatestBlockNumber failed:", err);
      }
    }, this.pollIntervalMs);
  }

  /** Stop polling and clear timer. */
  destroy(): void {
    this.lifecycle = "destroyed";
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.listeners.clear();
  }

  /**
   * Subscribe to state changes (e.g. for React re-render).
   * Callback receives which tables were updated so you can update only relevant state.
   * Only fires in the "live" lifecycle phase.
   */
  subscribe(listener: (payload: IndexerChangePayload) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
      lastProcessedBlock: this.snapshot.lastProcessedBlock,
      latestKnownBlock: this.latestKnownBlock,
      isSyncing: this.isSyncing,
      lifecycle: this.lifecycle,
    };
  }

  /** Last block whose events have been applied. Use for tx inputs (e.g. next_change_block). */
  getProcessedBlockNumber(): number {
    return this.snapshot.lastProcessedBlock;
  }

  getLatestKnownBlock(): number {
    return this.latestKnownBlock;
  }

  getWorld(): WorldState | undefined {
    return this.snapshot.world.get("0") as WorldState | undefined;
  }

  getPlayer(id: TableId): PlayerState | undefined {
    return this.snapshot.player.get(id) as PlayerState | undefined;
  }

  getPlanet(id: TableId): PlanetState | undefined {
    return this.snapshot.planet.get(id) as PlanetState | undefined;
  }

  getPlanetRevealedCoords(id: TableId): PlanetRevealedCoordsState | undefined {
    return this.snapshot.planet_revealed_coords.get(id) as
      | PlanetRevealedCoordsState
      | undefined;
  }

  getPlanetEvents(id: TableId): PlanetEventsState | undefined {
    return this.snapshot.planet_events.get(id) as PlanetEventsState | undefined;
  }

  getPlanetArtifacts(id: TableId): PlanetArtifactsState | undefined {
    return this.snapshot.planet_artifacts.get(id) as
      | PlanetArtifactsState
      | undefined;
  }

  getArrival(id: TableId): ArrivalState | undefined {
    return this.snapshot.arrival.get(id) as ArrivalState | undefined;
  }

  getArtifact(id: TableId): ArtifactState | undefined {
    return this.snapshot.artifact.get(id) as ArtifactState | undefined;
  }

  getArtifactLocation(id: TableId): ArtifactLocationState | undefined {
    return this.snapshot.artifact_location.get(id) as
      | ArtifactLocationState
      | undefined;
  }

  /** Generic: get table row(s). Typed by table name for function inputs. */
  getTable<K extends TableName>(
    table: K,
    id?: TableId,
  ): TableRowType[K] | Record<string, TableRowType[K]> | undefined {
    const map = this.snapshot[table] as Map<TableId, unknown>;
    if (id !== undefined) return map.get(id) as TableRowType[K] | undefined;
    return Object.fromEntries(map) as Record<string, TableRowType[K]>;
  }

  /**
   * Full snapshot as JSON string (same shape as server GET /snapshot).
   * Use for debugging or exporting the current synced state.
   */
  getSnapshotAsJsonString(): string {
    const obj: Record<string, unknown> = {
      lastProcessedBlock: this.snapshot.lastProcessedBlock,
    };
    for (const table of TABLE_NAMES) {
      const map = this.snapshot[table] as Map<TableId, unknown>;
      obj[table] = Object.fromEntries(map);
    }
    return JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  }

  /** All planet ids currently in state. */
  getPlanetIds(): string[] {
    return Array.from(this.snapshot.planet.keys());
  }

  /** All player ids (addresses). */
  getPlayerIds(): string[] {
    return Array.from(this.snapshot.player.keys());
  }

  /** All arrival ids. */
  getArrivalIds(): string[] {
    return Array.from(this.snapshot.arrival.keys());
  }

  /** All artifact ids. */
  getArtifactIds(): string[] {
    return Array.from(this.snapshot.artifact.keys());
  }

  /** Total number of artifacts in state. */
  getArtifactCount(): number {
    return this.snapshot.artifact.size;
  }

  /** Artifact ids owned by the given address (via owner field). */
  getArtifactIdsByOwner(ownerId: string): string[] {
    const set = this.ownerArtifactIndex.get(ownerId);
    return set ? Array.from(set) : [];
  }

  /** Artifact ids controlled by the given address (via controller field). */
  getArtifactIdsByController(controllerId: string): string[] {
    const set = this.controllerArtifactIndex.get(controllerId);
    return set ? Array.from(set) : [];
  }

  /** Full player map (id → PlayerState). */
  getPlayerMap(): Map<string, PlayerState> {
    return new Map(this.snapshot.player as Map<string, PlayerState>);
  }

  /** Full planet map (id → PlanetState). */
  getPlanetMap(): Map<string, PlanetState> {
    return new Map(this.snapshot.planet as Map<string, PlanetState>);
  }

  /** Full arrival map (id → ArrivalState). */
  getArrivalMap(): Map<string, ArrivalState> {
    return new Map(this.snapshot.arrival as Map<string, ArrivalState>);
  }

  /** Full revealed coords map (id → PlanetRevealedCoordsState). */
  getRevealedCoordsMap(): Map<string, PlanetRevealedCoordsState> {
    return new Map(
      this.snapshot.planet_revealed_coords as Map<
        string,
        PlanetRevealedCoordsState
      >,
    );
  }

  getConfirmationDepth(): number {
    return this.confirmationDepth;
  }

  /**
   * Returns a promise that resolves when the indexer has processed
   * at least up to the given block number. Blocks still inside the
   * confirmation window are applied into memory without advancing
   * lastProcessedBlock past the safe tip.
   */
  async waitForBlock(blockNumber: number, timeoutMs = 30_000): Promise<void> {
    console.log(
      `[DEBUG waitForBlock] target=${blockNumber}, current=${this.snapshot.lastProcessedBlock}`,
    );

    const tryReach = async (): Promise<boolean> => {
      try {
        await this.syncToLatest();
      } catch (err) {
        console.warn("[IndexerService] immediate sync failed:", err);
      }
      if (this.snapshot.lastProcessedBlock >= blockNumber) {
        return true;
      }
      if (this.latestKnownBlock >= blockNumber) {
        const from = Math.max(
          this.firstProcessableBlock(),
          this.snapshot.lastProcessedBlock + 1,
        );
        if (from <= blockNumber) {
          await this.applyBlockRange(from, blockNumber, {
            advanceCursor: false,
          });
        }
        return true;
      }
      return false;
    };

    if (await tryReach()) {
      console.log(`[DEBUG waitForBlock] reached ${blockNumber}`);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        fn();
      };
      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              `waitForBlock(${blockNumber}) timed out after ${timeoutMs}ms`,
            ),
          ),
        );
      }, timeoutMs);

      const unsub = this.subscribe(() => {
        void tryReach()
          .then((reached) => {
            if (!reached) return;
            console.log(
              `[DEBUG waitForBlock] synced to block ${this.snapshot.lastProcessedBlock}, resolving`,
            );
            finish(() => resolve());
          })
          .catch((err: unknown) => {
            finish(() => reject(err));
          });
      });
    });
  }
}
