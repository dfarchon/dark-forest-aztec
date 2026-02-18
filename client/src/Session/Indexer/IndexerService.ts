/**
 * IndexerService: maintains latest chain table state by syncing block-by-block
 * with debounce. Supports init from off-chain indexer and query API for tx inputs.
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
} from "../TableTypes/chain";
import { rawIdToTableId, rawToState } from "./convert";
import { debounce } from "./debounce";
import type {
  BlockUpdates,
  IBlockEventSource,
  IndexerChangePayload,
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
  private destroyRequested: boolean = false;

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

  private notifyListeners(payload: IndexerChangePayload): void {
    this.listeners.forEach((cb) => cb(payload));
  }

  /**
   * Start the indexer: optionally load snapshot from bootstrapSource (init to block X);
   * otherwise start from startBlock. Then use only source for getLatestBlockNumber and
   * getBlockUpdates so blocks after X are maintained by the frontend from the chain.
   */
  async start(): Promise<void> {
    this.destroyRequested = false;
    let snapshotLoaded = false;
    if (this.bootstrapSource?.getSnapshot) {
      try {
        const snap = await this.bootstrapSource.getSnapshot();
        if (snap) {
          this.snapshot = snap;
          this.latestKnownBlock = snap.lastProcessedBlock;
          snapshotLoaded = true;
          const block = snap.lastProcessedBlock;
          this.notifyListeners({
            tables: [...TABLE_NAMES],
            fromBlock: block,
            toBlock: block,
          });
        }
      } catch (err) {
        console.warn("[IndexerService] bootstrap getSnapshot failed:", err);
      }
    }
    if (!snapshotLoaded && this.startBlock > 0) {
      this.snapshot.lastProcessedBlock = this.startBlock - 1;
    }
    const latest = await this.source.getLatestBlockNumber();
    this.latestKnownBlock = latest;
    await this.processNewBlocks();

    this.pollTimer = setInterval(async () => {
      if (this.destroyRequested) return;
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
    this.destroyRequested = true;
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.listeners.clear();
  }

  /**
   * Subscribe to state changes (e.g. for React re-render).
   * Callback receives which tables were updated so you can update only relevant state.
   */
  subscribe(listener: (payload: IndexerChangePayload) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------- Query API ----------

  getStatus(): IndexerStatus {
    return {
      lastProcessedBlock: this.snapshot.lastProcessedBlock,
      latestKnownBlock: this.latestKnownBlock,
      isSyncing: this.isSyncing,
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
}
