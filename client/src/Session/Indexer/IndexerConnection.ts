/**
 * IndexerConnection: EthConnection-equivalent adapter for the IndexerService.
 *
 * Mirrors the EthConnection interface from darkforest-v0.6:
 *
 *   EthConnection                           IndexerConnection
 *   ─────────────────────────────────────   ─────────────────────────────────────
 *   constructor(provider, blockNumber)   →  constructor(indexer)
 *   createEthConnection(rpcUrl)          →  createIndexerConnection(config)
 *   blockNumber / blockNumber$           →  blockNumber / blockNumber$
 *   getCurrentBlockNumber()              →  getCurrentBlockNumber()
 *   subscribeToContractEvents(...)       →  subscribeToContractEvents(handlers)
 *   onNewBlock(...)                      →  onNewBlock(payload)          [private]
 *   processEvents(...)                   →  processEvents(payload, hdl) [private]
 *   destroy()                            →  destroy()
 *
 * Additionally exposes read methods that replace ContractsAPI getter calls,
 * reading directly from the IndexerService in-memory snapshot.
 */

import type { Monomitter } from "@dfpunk/events";
import { monomitter } from "@dfpunk/events";

import type { StorageContractAddresses } from "./AztecNodeSource";
import { createAztecNodeBlockSource } from "./AztecNodeSource";
import type { IndexerServiceOptions } from "./IndexerService";
import { IndexerService } from "./IndexerService";
import { OffChainBlockSource } from "./OffChainSource";
import type {
  ArrivalState,
  ArtifactState,
  PlanetArtifactsState,
  PlanetRevealedCoordsState,
  PlanetState,
  PlayerState,
  WorldState,
} from "./TableTypes/chain";
import type {
  IndexerChangePayload,
  IndexerLifecycle,
  IndexerStatus,
  TableId,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface IndexerConnectionConfig {
  /** Aztec node URL (e.g. http://localhost:8080). */
  nodeUrl: string;
  /** Optional off-chain indexer URL for bootstrap snapshot. */
  bootstrapUrl?: string;
  /** Override default contract addresses from @dfpunk/contracts. */
  contractAddresses?: StorageContractAddresses;
  /** Start block when no bootstrap is used. */
  startBlock?: number;
  /** Debounce delay in ms for processing new blocks. Default 1000. */
  debounceMs?: number;
  /** Poll interval for latest block. Default 2000. */
  pollIntervalMs?: number;
  /** Max blocks per getBlockUpdates call. Default 100. */
  maxBlocksPerRequest?: number;
}

// ---------------------------------------------------------------------------
// IndexerConnection
// ---------------------------------------------------------------------------

export class IndexerConnection {
  /**
   * Publishes an event whenever the current block number changes.
   * Mirrors EthConnection.blockNumber$.
   */
  public readonly blockNumber$: Monomitter<number>;

  private blockNumber: number;
  private readonly indexer: IndexerService;

  /** Handler map set by subscribeToContractEvents; undefined when not subscribed. */
  private eventHandlers:
    | Partial<Record<string, (...args: any[]) => void>>
    | undefined;

  /** Teardown returned by IndexerService.subscribe(). */
  private unsubscribeIndexer: (() => void) | undefined;

  constructor(indexer: IndexerService) {
    this.indexer = indexer;
    this.blockNumber = indexer.getProcessedBlockNumber();
    this.blockNumber$ = monomitter<number>(true);
  }

  // -------------------------------------------------------------------------
  // Lifecycle (mirrors createEthConnection / destroy)
  // -------------------------------------------------------------------------

  /**
   * Start the IndexerService, wait for initial sync to complete, and return
   * the block number at which the snapshot is atomically consistent.
   *
   * Analogous to the await inside createEthConnection where
   * provider.getBlockNumber() is awaited before constructing EthConnection.
   */
  public async initialize(): Promise<{ syncedToBlock: number }> {
    const result = await this.indexer.start();
    this.blockNumber = result.syncedToBlock;
    return result;
  }

  /**
   * Tear down the connection and underlying IndexerService.
   * Mirrors EthConnection.destroy().
   */
  public destroy(): void {
    this.unsubscribeIndexer?.();
    this.unsubscribeIndexer = undefined;
    this.indexer.destroy();
    this.eventHandlers = undefined;
    this.blockNumber$.clear();
  }

  // -------------------------------------------------------------------------
  // Event subscription (mirrors EthConnection.subscribeToContractEvents)
  // -------------------------------------------------------------------------

  /**
   * Subscribe to domain-level game events derived from indexer table changes.
   *
   * Mirrors EthConnection.subscribeToContractEvents(contract, handlers, filter).
   * The contract and filter parameters are not needed here because the indexer
   * already maintains all table state internally.
   *
   * If the IndexerService is in "ready" state (sync complete but not yet polling),
   * this method automatically starts polling — mirroring the darkforest-v0.6 pattern
   * where GameManager loads state first, then calls contractsAPI.setupEventListeners().
   *
   * Handler keys match Aztec storage contract event names 1:1:
   *   WorldUpdate, PlayerUpdate, PlanetUpdate, PlanetRevealedCoordsUpdate,
   *   PlanetEventsUpdate, PlanetArtifactsUpdate, ArrivalUpdate, ArtifactUpdate,
   *   ArtifactLocationUpdate
   *
   * @returns unsubscribe function.
   */
  public subscribeToContractEvents(
    handlers: Partial<Record<string, (...args: any[]) => void>>
  ): () => void {
    this.eventHandlers = handlers;

    if (this.indexer.getLifecycle() === "ready") {
      this.indexer.startPolling();
    }

    this.unsubscribeIndexer = this.indexer.subscribe((payload) => {
      this.onNewBlock(payload);
    });

    return () => {
      this.unsubscribeIndexer?.();
      this.unsubscribeIndexer = undefined;
      this.eventHandlers = undefined;
    };
  }

  /**
   * Mirrors EthConnection.onNewBlock:
   *  1. Update blockNumber
   *  2. Publish blockNumber$
   *  3. Dispatch domain events via processEvents
   */
  private onNewBlock(payload: IndexerChangePayload): void {
    this.blockNumber = payload.toBlock;
    this.blockNumber$.publish(payload.toBlock);

    if (payload.tables.length > 0 && this.eventHandlers) {
      this.processEvents(payload, this.eventHandlers);
    }
  }

  /**
   * Mirrors EthConnection.processEvents:
   *  - EthConnection: provider.getLogs() → parseLog → handler(args)
   *  - IndexerConnection: IndexerChangePayload → table change mapping → handler(args)
   * Handler names match Aztec storage contract event names 1:1.
   */
  private processEvents(
    payload: IndexerChangePayload,
    handlers: Partial<Record<string, (...args: any[]) => void>>
  ): void {
    const { updatedIdsByTable } = payload;
    if (!updatedIdsByTable) return;

    // world table → WorldUpdate(worldState) — WorldStorage.WorldUpdate
    if (updatedIdsByTable.world) {
      const newWorld = this.indexer.getWorld();
      if (newWorld) {
        handlers["WorldUpdate"]?.(newWorld);
      }
    }

    // player table → PlayerUpdate(playerId) — PlayerStorage.PlayerUpdate
    for (const id of updatedIdsByTable.player ?? []) {
      handlers["PlayerUpdate"]?.(id);
    }

    // planet table → PlanetUpdate(planetId) — PlanetStorage.PlanetUpdate
    for (const id of updatedIdsByTable.planet ?? []) {
      handlers["PlanetUpdate"]?.(id);
    }

    // planet_revealed_coords table → PlanetRevealedCoordsUpdate(locationId, revealer) — PlanetRevealedCoordsStorage.PlanetRevealedCoordsUpdate
    for (const id of updatedIdsByTable.planet_revealed_coords ?? []) {
      const coords = this.indexer.getPlanetRevealedCoords(id);
      if (coords) {
        handlers["PlanetRevealedCoordsUpdate"]?.(
          coords.location_id,
          coords.revealer
        );
      }
    }

    // planet_events table → PlanetEventsUpdate(planetId) — PlanetEventsStorage.PlanetEventsUpdate
    for (const id of updatedIdsByTable.planet_events ?? []) {
      handlers["PlanetEventsUpdate"]?.(id);
    }

    // planet_artifacts table → PlanetArtifactsUpdate(planetId) — PlanetArtifactsStorage.PlanetArtifactsUpdate
    for (const id of updatedIdsByTable.planet_artifacts ?? []) {
      handlers["PlanetArtifactsUpdate"]?.(id);
    }

    // arrival table → ArrivalUpdate(arrivalId, fromPlanet, toPlanet) — ArrivalStorage.ArrivalUpdate
    for (const id of updatedIdsByTable.arrival ?? []) {
      const arrival = this.indexer.getArrival(id);
      if (arrival) {
        handlers["ArrivalUpdate"]?.(id, arrival.from_planet, arrival.to_planet);
      }
    }

    // artifact table → ArtifactUpdate(artifactId) — ArtifactStorage.ArtifactUpdate
    for (const id of updatedIdsByTable.artifact ?? []) {
      handlers["ArtifactUpdate"]?.(id);
    }

    // artifact_location table → ArtifactLocationUpdate(artifactId) — ArtifactLocationStorage.ArtifactLocationUpdate
    for (const id of updatedIdsByTable.artifact_location ?? []) {
      handlers["ArtifactLocationUpdate"]?.(id);
    }
  }

  // -------------------------------------------------------------------------
  // Block info (mirrors EthConnection.getCurrentBlockNumber / blockNumber$)
  // -------------------------------------------------------------------------

  /** Mirrors EthConnection.getCurrentBlockNumber(). */
  public getCurrentBlockNumber(): number {
    return this.blockNumber;
  }

  // -------------------------------------------------------------------------
  // Status & lifecycle
  // -------------------------------------------------------------------------

  public getStatus(): IndexerStatus {
    return this.indexer.getStatus();
  }

  public getLifecycle(): IndexerLifecycle {
    return this.indexer.getLifecycle();
  }

  public isLive(): boolean {
    return this.indexer.isLive();
  }

  /** Last block whose events have been applied. Use for tx inputs. */
  public getProcessedBlockNumber(): number {
    return this.indexer.getProcessedBlockNumber();
  }

  // -------------------------------------------------------------------------
  // Read API (replaces ContractsAPI getter methods)
  // These read from the in-memory snapshot — synchronous, no network calls.
  // -------------------------------------------------------------------------

  public getWorldRadius(): bigint {
    const world = this.indexer.getWorld();
    return world ? world.radius : 0n;
  }

  public getIsPaused(): boolean {
    const world = this.indexer.getWorld();
    return world?.paused ?? false;
  }

  public getWorld(): WorldState | undefined {
    return this.indexer.getWorld();
  }

  /** All players as Map<playerId, PlayerState>. */
  public getPlayers(): Map<string, PlayerState> {
    return this.indexer.getPlayerMap();
  }

  public getPlayer(id: TableId): PlayerState | undefined {
    return this.indexer.getPlayer(id);
  }

  public getPlayerIds(): string[] {
    return this.indexer.getPlayerIds();
  }

  public getPlanetIds(): string[] {
    return this.indexer.getPlanetIds();
  }

  public getPlanet(id: TableId): PlanetState | undefined {
    return this.indexer.getPlanet(id);
  }

  /** Subset of planets by id list. */
  public getPlanets(ids: string[]): Map<string, PlanetState> {
    const result = new Map<string, PlanetState>();
    for (const id of ids) {
      const p = this.indexer.getPlanet(id);
      if (p) result.set(id, p);
    }
    return result;
  }

  /** All revealed coordinates as Map<planetId, PlanetRevealedCoordsState>. */
  public getRevealedCoords(): Map<string, PlanetRevealedCoordsState> {
    return this.indexer.getRevealedCoordsMap();
  }

  public getRevealedCoordsById(
    id: TableId
  ): PlanetRevealedCoordsState | undefined {
    return this.indexer.getPlanetRevealedCoords(id);
  }

  /** All arrivals targeting or originating from the given planet ids. */
  public getArrivalsForPlanets(planetIds: string[]): ArrivalState[] {
    const planetSet = new Set(planetIds);
    const result: ArrivalState[] = [];
    const allArrivals = this.indexer.getArrivalMap();
    allArrivals.forEach((arrival) => {
      if (
        planetSet.has(arrival.from_planet) ||
        planetSet.has(arrival.to_planet)
      ) {
        result.push(arrival);
      }
    });
    return result;
  }

  public getArrival(id: TableId): ArrivalState | undefined {
    return this.indexer.getArrival(id);
  }

  public getArrivalIds(): string[] {
    return this.indexer.getArrivalIds();
  }

  public getArtifact(id: TableId): ArtifactState | undefined {
    return this.indexer.getArtifact(id);
  }

  public getArtifactIds(): string[] {
    return this.indexer.getArtifactIds();
  }

  /** Artifact ids on a planet (from planet_artifacts table). */
  public getArtifactsOnPlanet(planetId: TableId): string[] {
    const pa: PlanetArtifactsState | undefined =
      this.indexer.getPlanetArtifacts(planetId);
    if (!pa) return [];
    return pa.ids.slice(0, pa.count);
  }

  /** All artifacts whose controller matches the given player address. */
  public getPlayerArtifacts(playerId: string): ArtifactState[] {
    const result: ArtifactState[] = [];
    for (const id of this.indexer.getArtifactIds()) {
      const a = this.indexer.getArtifact(id);
      if (a && a.controller === playerId) {
        result.push(a);
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Factory function (mirrors createEthConnection)
// ---------------------------------------------------------------------------

/**
 * Create an IndexerConnection wired to an Aztec node (and optionally an
 * off-chain bootstrap source). Awaits initial sync before returning, so the
 * snapshot is atomically consistent at the returned syncedToBlock.
 *
 * Mirrors createEthConnection(rpcUrl).
 */
export async function createIndexerConnection(
  config: IndexerConnectionConfig
): Promise<{ connection: IndexerConnection; syncedToBlock: number }> {
  const source = createAztecNodeBlockSource(
    config.nodeUrl,
    config.contractAddresses
  );
  const bootstrapSource = config.bootstrapUrl
    ? new OffChainBlockSource({ baseUrl: config.bootstrapUrl })
    : undefined;

  const serviceOpts: IndexerServiceOptions & { source: typeof source } = {
    source,
    bootstrapSource,
    startBlock: config.startBlock,
    debounceMs: config.debounceMs,
    pollIntervalMs: config.pollIntervalMs,
    maxBlocksPerRequest: config.maxBlocksPerRequest,
  };

  const indexer = new IndexerService(serviceOpts);
  const connection = new IndexerConnection(indexer);
  const { syncedToBlock } = await connection.initialize();
  return { connection, syncedToBlock };
}
