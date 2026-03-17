/**
 * ContractsAPI: Aztec-native facade matching the v0.6 ContractsAPI public interface.
 *
 * Composes four subsystems:
 *   - IndexerConnection  — in-memory snapshot reads + domain event subscription
 *   - TxExecutor          — transaction queue & execution
 *   - WalletManager       — wallet identity (replaces EthConnection.getAddress)
 *   - ConfigCache         — immutable game constants
 *
 * All read methods are async with onProgress callbacks (matching v0.6 signatures)
 * but resolve immediately from the in-memory snapshot.
 */

import { EMPTY_LOCATION_ID } from "@dfpunk/constants";
import { CORE_CONTRACT_ADDRESS } from "@dfpunk/contracts";
import { isSpaceShip } from "@dfpunk/gamelogic";
import {
  artifactIdToDecStr,
  decodeArrival,
  decodeArtifact,
  decodePlanet,
  decodePlanetRevealedCoords,
  decodePlayer,
  locationIdFromDecStr,
  locationIdToDecStr,
} from "@dfpunk/serde";
import type {
  Artifact,
  ArtifactId,
  EthAddress,
  LocationId,
  Planet,
  Player,
  QueuedArrival,
  RevealedCoords,
  Transaction,
  TxIntent,
  VoyageId,
} from "@dfpunk/types";
import { EventEmitter } from "events";

import type { IndexerConnection } from "../Session/Indexer/IndexerConnection";
import type {
  ConfigCache,
  GameConfig,
} from "../Session/TxExecutor/ConfigCache";
import type { TxExecutor } from "../Session/TxExecutor/TxExecutor";
import type { DiagnosticUpdater } from "../Session/TxExecutor/types";
import type { WalletManager } from "../Session/WalletManager/WalletManager";
import type {
  ContractConstants,
  ContractsApiConfig,
} from "./ContractsAPITypes";
import { ContractsAPIEvent } from "./ContractsAPITypes";
import { gameConfigToContractConstants } from "./gameConfigToContractConstants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Async chunked iteration helpers — yield to the event loop every CHUNK items
// so React can repaint progress bars between batches.
// ---------------------------------------------------------------------------

const CHUNK = 64;
const yieldTick = () => new Promise<void>((r) => setTimeout(r, 0));

async function mapWithProgress<T, R>(
  items: T[],
  fn: (item: T, index: number) => R,
  onProgress?: (fraction: number) => void
): Promise<R[]> {
  const total = items.length;
  if (total === 0) {
    onProgress?.(1);
    return [];
  }
  const results: R[] = new Array(total);
  for (let i = 0; i < total; i++) {
    results[i] = fn(items[i], i);
    if ((i + 1) % CHUNK === 0 || i === total - 1) {
      onProgress?.((i + 1) / total);
      await yieldTick();
    }
  }
  return results;
}

async function forEachWithProgress<T>(
  items: T[],
  fn: (item: T, index: number) => void,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const total = items.length;
  if (total === 0) {
    onProgress?.(1);
    return;
  }
  for (let i = 0; i < total; i++) {
    fn(items[i], i);
    if ((i + 1) % CHUNK === 0 || i === total - 1) {
      onProgress?.((i + 1) / total);
      await yieldTick();
    }
  }
}

// ---------------------------------------------------------------------------
// ContractsAPI
// ---------------------------------------------------------------------------

export class ContractsAPI extends EventEmitter {
  public readonly txExecutor: TxExecutor;
  public readonly indexerConnection: IndexerConnection;

  private readonly walletManager: WalletManager;
  private readonly configCache: ConfigCache;
  private unsubscribeIndexer: (() => void) | undefined;

  public constructor({
    indexerConnection,
    txExecutor,
    walletManager,
    configCache,
  }: ContractsApiConfig) {
    super();
    this.indexerConnection = indexerConnection;
    this.txExecutor = txExecutor;
    this.walletManager = walletManager;
    this.configCache = configCache;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  public destroy(): void {
    this.removeEventListeners();
  }

  // =========================================================================
  // Event listeners  (mirrors v0.6 setupEventListeners / removeEventListeners)
  // =========================================================================

  public setupEventListeners(): void {
    this.unsubscribeIndexer = this.indexerConnection.subscribeToContractEvents({
      WorldUpdate: (world: any) => {
        this.emit(ContractsAPIEvent.PauseStateChanged, world?.paused ?? false);
        this.emit(ContractsAPIEvent.RadiusUpdated);
      },
      PlayerUpdate: (playerId: string) => {
        this.emit(ContractsAPIEvent.PlayerUpdate, playerId as EthAddress);
      },
      PlanetUpdate: (planetId: string) => {
        this.emit(
          ContractsAPIEvent.PlanetUpdate,
          locationIdFromDecStr(planetId)
        );
      },
      ArrivalUpdate: (
        arrivalId: string,
        fromPlanet: string,
        toPlanet: string
      ) => {
        this.emit(
          ContractsAPIEvent.ArrivalQueued,
          arrivalId as VoyageId,
          locationIdFromDecStr(fromPlanet),
          locationIdFromDecStr(toPlanet)
        );
        this.emit(ContractsAPIEvent.RadiusUpdated);
      },
      ArtifactUpdate: (artifactId: string) => {
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
      },
      PlanetRevealedCoordsUpdate: (locationId: string, revealer: string) => {
        const hexId = locationIdFromDecStr(locationId);
        this.emit(ContractsAPIEvent.PlanetUpdate, hexId);
        this.emit(
          ContractsAPIEvent.LocationRevealed,
          hexId,
          revealer as EthAddress
        );
      },
      PlanetEventsUpdate: (planetId: string) => {
        this.emit(
          ContractsAPIEvent.PlanetUpdate,
          locationIdFromDecStr(planetId)
        );
      },
      PlanetArtifactsUpdate: (planetId: string) => {
        this.emit(
          ContractsAPIEvent.PlanetUpdate,
          locationIdFromDecStr(planetId)
        );
      },
      ArtifactLocationUpdate: (artifactId: string) => {
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
      },
    });
  }

  public removeEventListeners(): void {
    this.unsubscribeIndexer?.();
    this.unsubscribeIndexer = undefined;
  }

  // =========================================================================
  // Identity & address  (mirrors v0.6 getAddress / getContractAddress)
  // =========================================================================

  public getAddress(): EthAddress | undefined {
    return this.walletManager.getActiveAddress()?.toString() as
      | EthAddress
      | undefined;
  }

  public getContractAddress(): EthAddress {
    // todo: fix this
    return CORE_CONTRACT_ADDRESS as EthAddress;
  }

  public getWalletManager(): WalletManager {
    return this.walletManager;
  }

  // =========================================================================
  // Transaction management  (mirrors v0.6 submitTransaction / cancel / prioritize)
  // =========================================================================

  public async submitTransaction<T extends TxIntent>(
    txIntent: T
  ): Promise<Transaction<T>> {
    const queuedTx = await this.txExecutor.queueTransaction(txIntent);

    this.emit(ContractsAPIEvent.TxQueued, queuedTx);
    setTimeout(() => this.emitTransactionEvents(queuedTx), 0);

    return queuedTx;
  }

  public cancelTransaction(tx: Transaction): void {
    this.txExecutor.dequeueTransaction(tx);
    this.emit(ContractsAPIEvent.TxCancelled, tx);
  }

  public prioritizeTransaction(tx: Transaction): void {
    this.txExecutor.prioritizeTransaction(tx);
    this.emit(ContractsAPIEvent.TxPrioritized, tx);
  }

  public emitTransactionEvents(tx: Transaction): void {
    tx.submittedPromise
      .then(() => {
        this.emit(ContractsAPIEvent.TxSubmitted, tx);
      })
      .catch(() => {
        this.emit(ContractsAPIEvent.TxErrored, tx);
      });

    tx.confirmedPromise
      .then(() => {
        this.emit(ContractsAPIEvent.TxConfirmed, tx);
      })
      .catch(() => {
        this.emit(ContractsAPIEvent.TxErrored, tx);
      });
  }

  // =========================================================================
  // Diagnostics  (mirrors v0.6 setDiagnosticUpdater)
  // =========================================================================

  public setDiagnosticUpdater(diagnosticUpdater?: DiagnosticUpdater): void {
    this.txExecutor.setDiagnosticUpdater(diagnosticUpdater);
  }

  // =========================================================================
  // Indexer sync  (wait for indexer to catch up after tx confirmation)
  // =========================================================================

  public waitForBlock(blockNumber: number, timeoutMs?: number): Promise<void> {
    return this.indexerConnection.waitForBlock(blockNumber, timeoutMs);
  }

  // =========================================================================
  // Read API — game constants  (mirrors v0.6 getConstants)
  // =========================================================================

  public async getConstants(): Promise<ContractConstants> {
    const config = await this.configCache.getConfig();
    return gameConfigToContractConstants(config);
  }

  public async getConfig(): Promise<GameConfig> {
    return this.configCache.getConfig();
  }

  // =========================================================================
  // Read API — players  (mirrors v0.6 getPlayers / getPlayerById)
  // =========================================================================

  public async getPlayers(
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Map<string, Player>> {
    const rawMap = this.indexerConnection.getPlayers();
    const result = new Map<string, Player>();
    const entries = Array.from(rawMap.entries());
    await forEachWithProgress(
      entries,
      ([key, state]) => result.set(key, decodePlayer(key, state)),
      onProgress
    );
    return result;
  }

  public async getPlayerById(
    playerId: EthAddress
  ): Promise<Player | undefined> {
    const state = this.indexerConnection.getPlayer(playerId);
    if (!state) return undefined;
    return decodePlayer(playerId, state);
  }

  // =========================================================================
  // Read API — world  (mirrors v0.6 getWorldRadius / getTokenMintEndTimestamp / getIsPaused)
  // =========================================================================

  public async getWorldRadius(): Promise<number> {
    return Number(this.indexerConnection.getWorldRadius());
  }

  public async getTokenMintEndTimestamp(): Promise<number> {
    const constants = await this.getConstants();
    return constants.TOKEN_MINT_END_SECONDS;
  }

  public async getIsPaused(): Promise<boolean> {
    return this.indexerConnection.getIsPaused();
  }

  // =========================================================================
  // Read API — planets  (mirrors v0.6 getTouchedPlanetIds / bulkGetPlanets / getPlanetById)
  // =========================================================================

  public async getTouchedPlanetIds(
    _startingAt: number,
    onProgress?: (fractionCompleted: number) => void
  ): Promise<LocationId[]> {
    const decIds = this.indexerConnection.getPlanetIds();
    return mapWithProgress(
      decIds,
      (decId) => locationIdFromDecStr(decId),
      onProgress
    );
  }

  public async bulkGetPlanets(
    toLoadPlanets: LocationId[],
    onProgressPlanet?: (fractionCompleted: number) => void
  ): Promise<Map<LocationId, Planet>> {
    const planets = new Map<LocationId, Planet>();
    await forEachWithProgress(
      toLoadPlanets,
      (locId) => {
        const decId = locationIdToDecStr(locId);
        const raw = this.indexerConnection.getPlanet(decId);
        if (raw) {
          const planet = decodePlanet(decId, raw);
          planets.set(planet.locationId, planet);
        }
      },
      onProgressPlanet
    );
    return planets;
  }

  public async getPlanetById(
    planetId: LocationId
  ): Promise<Planet | undefined> {
    const decId = locationIdToDecStr(planetId);
    const raw = this.indexerConnection.getPlanet(decId);
    if (!raw) {
      return undefined;
    }
    const planet = decodePlanet(decId, raw);

    return planet;
  }

  // =========================================================================
  // Read API — arrivals  (mirrors v0.6 getArrival / getArrivalsForPlanet / getAllArrivals)
  // =========================================================================

  public async getArrival(
    arrivalId: number
  ): Promise<QueuedArrival | undefined> {
    const raw = this.indexerConnection.getArrival(String(arrivalId));
    if (!raw) return undefined;
    return decodeArrival(String(arrivalId), raw);
  }

  public async getArrivalsForPlanet(
    planetId: LocationId
  ): Promise<QueuedArrival[]> {
    const decId = locationIdToDecStr(planetId);
    const arrivals = this.indexerConnection.getArrivalsForPlanet(decId);
    return arrivals.map((a) => decodeArrival(a.id ?? "", a));
  }

  public async getAllArrivals(
    planetsToLoad: LocationId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<QueuedArrival[]> {
    const result: QueuedArrival[] = [];
    await forEachWithProgress(
      planetsToLoad,
      (locId) => {
        const decId = locationIdToDecStr(locId);
        const arrivals = this.indexerConnection.getArrivalsForPlanet(decId);
        for (const a of arrivals) {
          result.push(decodeArrival(a.id ?? "", a));
        }
      },
      onProgress
    );
    return result;
  }

  // =========================================================================
  // Read API — revealed coords  (mirrors v0.6 getRevealedCoordsByIdIfExists / getRevealedPlanetsCoords)
  // =========================================================================

  public async getRevealedCoordsByIdIfExists(
    planetId: LocationId
  ): Promise<RevealedCoords | undefined> {
    const decId = locationIdToDecStr(planetId);
    const raw = this.indexerConnection.getRevealedCoordsById(decId);
    if (!raw) return undefined;
    const ret = decodePlanetRevealedCoords(planetId, raw);
    if (ret.hash === EMPTY_LOCATION_ID) return undefined;
    return ret;
  }

  public async getRevealedPlanetsCoords(
    _startingAt: number,
    onProgressIds?: (fractionCompleted: number) => void,
    onProgressCoords?: (fractionCompleted: number) => void
  ): Promise<RevealedCoords[]> {
    const allCoords = this.indexerConnection.getRevealedCoords();
    onProgressIds?.(1);
    await yieldTick();
    const entries = Array.from(allCoords.entries());
    return mapWithProgress(
      entries,
      ([key, state]) => decodePlanetRevealedCoords(key, state),
      onProgressCoords
    );
  }

  // =========================================================================
  // Read API — artifacts  (mirrors v0.6 getArtifactById / bulkGetArtifactsOnPlanets / bulkGetArtifacts / getPlayerArtifacts)
  // =========================================================================

  public async getArtifactById(
    artifactId: ArtifactId
  ): Promise<Artifact | undefined> {
    const decId = artifactIdToDecStr(artifactId);
    const state = this.indexerConnection.getArtifact(decId);
    if (!state) return undefined;
    const location = this.indexerConnection.getArtifactLocation(decId);
    return decodeArtifact(decId, state, undefined, location ?? undefined);
  }

  public async bulkGetArtifactsOnPlanets(
    locationIds: LocationId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Artifact[][]> {
    return mapWithProgress(
      locationIds,
      (locId) => {
        const decId = locationIdToDecStr(locId);
        const artIds = this.indexerConnection.getArtifactsOnPlanet(decId);
        const artifacts: Artifact[] = [];
        for (const artId of artIds) {
          const state = this.indexerConnection.getArtifact(artId);
          if (state) {
            const location = this.indexerConnection.getArtifactLocation(artId);
            artifacts.push(
              decodeArtifact(artId, state, undefined, location ?? undefined)
            );
          }
        }
        return artifacts;
      },
      onProgress
    );
  }

  public async bulkGetArtifacts(
    artifactIds: ArtifactId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Artifact[]> {
    const result: Artifact[] = [];
    await forEachWithProgress(
      artifactIds,
      (artId) => {
        const decId = artifactIdToDecStr(artId);
        const state = this.indexerConnection.getArtifact(decId);
        if (state) {
          const location = this.indexerConnection.getArtifactLocation(decId);
          result.push(
            decodeArtifact(decId, state, undefined, location ?? undefined)
          );
        }
      },
      onProgress
    );
    return result;
  }

  /** Artifacts owned by the given player (via owner field, mirrors v0.6 ERC721 ownerOf). */
  public async getPlayerArtifacts(
    playerId?: EthAddress,
    onProgress?: (percent: number) => void
  ): Promise<Artifact[]> {
    if (!playerId) return [];
    const artIds = this.indexerConnection.getPlayerArtifactIds(playerId);
    const result: Artifact[] = [];
    await forEachWithProgress(
      artIds,
      (artId) => {
        const state = this.indexerConnection.getArtifact(artId);
        if (state) {
          const location = this.indexerConnection.getArtifactLocation(artId);
          result.push(
            decodeArtifact(artId, state, undefined, location ?? undefined)
          );
        }
      },
      onProgress
    );
    return result;
  }

  public async getPlayerSpaceships(playerId: EthAddress): Promise<Artifact[]> {
    const ids = this.indexerConnection.getControlledArtifactIds(playerId);
    const result: Artifact[] = [];
    for (const id of ids) {
      const state = this.indexerConnection.getArtifact(id as ArtifactId);
      if (!state) continue;
      const location = this.indexerConnection.getArtifactLocation(
        id as ArtifactId
      );
      const artifact = decodeArtifact(
        id as ArtifactId,
        state,
        undefined,
        location ?? undefined
      );
      if (isSpaceShip(artifact.artifactType)) {
        result.push(artifact);
      }
    }
    return result;
  }

  /** Whether an artifact with the given id exists. Mirrors v0.6 doesArtifactExist. */
  public doesArtifactExist(artifactId: ArtifactId): boolean {
    return this.indexerConnection.doesArtifactExist(
      artifactIdToDecStr(artifactId)
    );
  }

  // =========================================================================
  // Read API — convenience getters
  // =========================================================================

  /** Space junk limit for a player. Mirrors v0.6 getPlayerSpaceJunkLimit. */
  public getPlayerSpaceJunkLimit(playerId: EthAddress): number {
    const state = this.indexerConnection.getPlayer(playerId);
    if (!state) return 0;
    return Number(state.space_junk_limit);
  }

  /** Reveal cooldown in seconds from game config. Mirrors v0.6 getRevealCooldown. */
  public async getRevealCooldown(): Promise<number> {
    const config = await this.configCache.getConfig();
    const core = config.gameConfigCore as Record<string, unknown>;
    return Number(core?.location_reveal_cooldown ?? 0);
  }

  /** Artifact point values by rarity. Mirrors v0.6 getArtifactPointValues. */
  public async getArtifactPointValues(): Promise<number[]> {
    const config = await this.configCache.getConfig();
    const core = config.gameConfigCore as Record<string, unknown>;
    const raw = core?.artifact_point_values;
    if (Array.isArray(raw)) return raw.map((v) => Number(v ?? 0));
    return [0, 0, 0, 0, 0, 0];
  }
}

// ---------------------------------------------------------------------------
// Factory function  (mirrors v0.6 makeContractsAPI)
// ---------------------------------------------------------------------------

export async function makeContractsAPI(
  config: ContractsApiConfig
): Promise<ContractsAPI> {
  return new ContractsAPI(config);
}
