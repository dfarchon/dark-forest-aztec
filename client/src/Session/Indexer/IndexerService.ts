/**
 * IndexerService: maintains latest chain table state by syncing block-by-block
 * with debounce. Supports init from off-chain indexer and query API for tx inputs.
 *
 * Lifecycle: idle → bootstrapping → syncing → live → destroyed.
 * Subscriber notifications are only dispatched in the "live" phase so that
 * callers never receive partial state during initial catch-up.
 */

import { rawIdToTableId, rawToState } from "./convert";
import { debounce } from "./debounce";
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
} from "./TableTypes/chain";
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
} from "./types";
import { TABLE_NAMES } from "./types";

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
  /** Called after each block range is applied. */
  onBlockProcessed?: (fromBlock: number, toBlock: number) => void;
}

export class IndexerService {
  private readonly bootstrapSource: IBlockEventSource | undefined;
  private readonly source: IBlockEventSource;
  private readonly startBlock: number;
  private readonly debounceMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxBlocksPerRequest: number;
  private readonly onBlockProcessed?: (
    fromBlock: number,
    toBlock: number
  ) => void;

  private snapshot: IndexerSnapshot = emptySnapshot();
  private latestKnownBlock: number = 0;
  private isSyncing: boolean = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private lifecycle: IndexerLifecycle = "idle";

  /** Subscribers notified when state changes (after applying updates). */
  private listeners = new Set<(payload: IndexerChangePayload) => void>();

  constructor(options: IndexerServiceOptions) {
    this.bootstrapSource = options.bootstrapSource;
    this.source = options.source;
    this.startBlock = Math.max(0, options.startBlock ?? 0);
    this.debounceMs = options.debounceMs ?? 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.maxBlocksPerRequest = Math.max(1, options.maxBlocksPerRequest ?? 100);
    this.onBlockProcessed = options.onBlockProcessed;

    const debouncedProcess = debounce(
      this.processNewBlocks.bind(this),
      this.debounceMs,
      true,
      true
    );

    /** Called when we learn of a new latest block (poll or push). */
    this.onLatestBlock = (latest: number) => {
      this.latestKnownBlock = latest;
      debouncedProcess();
    };
  }

  private onLatestBlock: (latest: number) => void;

  /**
   * Process blocks from (lastProcessedBlock + 1) up to latestKnownBlock in chunks of
   * at most maxBlocksPerRequest to avoid a single huge getBlockUpdates call.
   */
  private async processNewBlocks(): Promise<void> {
    let fromBlock = this.snapshot.lastProcessedBlock + 1;
    const toBlock = this.latestKnownBlock;
    if (fromBlock > toBlock) return;

    this.isSyncing = true;
    try {
      while (fromBlock <= toBlock) {
        const chunkEnd = Math.min(
          fromBlock + this.maxBlocksPerRequest - 1,
          toBlock
        );
        const updates = await this.source.getBlockUpdates(fromBlock, chunkEnd);
        this.applyUpdates(updates);
        this.snapshot.lastProcessedBlock = chunkEnd;
        this.onBlockProcessed?.(fromBlock, chunkEnd);
        const tables = [
          ...new Set(updates.updates.map((u) => u.table)),
        ] as TableName[];
        const updatedIdsByTable = this.buildUpdatedIdsByTable(updates);
        this.notifyListeners({
          tables,
          fromBlock,
          toBlock: chunkEnd,
          updatedIdsByTable,
        });
        fromBlock = chunkEnd + 1;
      }
    } catch (err) {
      console.warn("[IndexerService] processNewBlocks error:", err);
    } finally {
      this.isSyncing = false;
      this.notifyListeners({
        tables: [],
        fromBlock: toBlock,
        toBlock,
      });
    }
  }

  /** Build per-table list of row ids that were updated in this batch. */
  private buildUpdatedIdsByTable(
    updates: BlockUpdates
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

  /** Apply a single BlockUpdates to current snapshot. */
  private applyUpdates(updates: BlockUpdates): void {
    for (const u of updates.updates) {
      const id = rawIdToTableId(u.table, (u as { id?: unknown }).id);
      const rawState = (u as TableUpdate<Raw>).state as Raw;
      const state = rawToState(u.table, rawState);
      const tableMap = this.snapshot[u.table] as Map<TableId, unknown>;
      tableMap.set(id, state);
    }
  }

  /** Load full snapshot (e.g. from off-chain indexer) and set lastProcessedBlock. */
  applySnapshot(snapshot: IndexerSnapshot): void {
    this.snapshot = snapshot;
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
          `current: "${this.lifecycle}"`
      );
    }
    this.lifecycle = "live";

    this.pollTimer = setInterval(async () => {
      if (this.lifecycle === "destroyed") return;
      try {
        const next = await this.source.getLatestBlockNumber();
        this.onLatestBlock(next);
      } catch {
        // ignore poll errors
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
    id?: TableId
  ): TableRowType[K] | Record<string, TableRowType[K]> | undefined {
    const map = this.snapshot[table] as Map<TableId, unknown>;
    if (id !== undefined) return map.get(id) as TableRowType[K] | undefined;
    return Object.fromEntries(map) as Record<string, TableRowType[K]>;
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
      >
    );
  }

  /**
   * Returns a promise that resolves when the indexer has processed
   * at least up to the given block number.
   */
  waitForBlock(blockNumber: number, timeoutMs = 30_000): Promise<void> {
    console.log(
      `[DEBUG waitForBlock] target=${blockNumber}, current=${this.snapshot.lastProcessedBlock}`
    );
    if (this.snapshot.lastProcessedBlock >= blockNumber) {
      console.log(`[DEBUG waitForBlock] already synced, resolving immediately`);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(
          new Error(
            `waitForBlock(${blockNumber}) timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      const unsub = this.subscribe((payload) => {
        if (payload.toBlock >= blockNumber) {
          console.log(
            `[DEBUG waitForBlock] synced to block ${payload.toBlock}, resolving`
          );
          clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
  }
}
