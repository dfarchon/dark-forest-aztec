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
import {
  decodeArrival,
  decodeArtifact,
  decodePlanet,
  decodePlanetRevealedCoords,
  decodePlayer,
} from "@dfpunk/serde";
import type {
  Artifact,
  ArtifactId,
  AztecAddr,
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
import type { ConfigCache } from "../Session/TxExecutor/ConfigCache";
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
        this.emit(ContractsAPIEvent.PlayerUpdate, playerId as AztecAddr);
      },
      PlanetUpdate: (planetId: string) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, planetId as LocationId);
      },
      ArrivalUpdate: (
        arrivalId: string,
        fromPlanet: string,
        toPlanet: string
      ) => {
        this.emit(
          ContractsAPIEvent.ArrivalQueued,
          arrivalId as VoyageId,
          fromPlanet as LocationId,
          toPlanet as LocationId
        );
        this.emit(ContractsAPIEvent.RadiusUpdated);
      },
      ArtifactUpdate: (artifactId: string) => {
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
      },
      PlanetRevealedCoordsUpdate: (locationId: string, revealer: string) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationId as LocationId);
        this.emit(
          ContractsAPIEvent.LocationRevealed,
          locationId as LocationId,
          revealer as AztecAddr
        );
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

  public getAddress(): AztecAddr | undefined {
    return this.walletManager.getActiveAddress()?.toString() as
      | AztecAddr
      | undefined;
  }

  public getContractAddress(): string {
    //NOTE: actually we have lots of contracts
    return CORE_CONTRACT_ADDRESS;
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
  // Read API — game constants  (mirrors v0.6 getConstants)
  // =========================================================================

  public async getConstants(): Promise<ContractConstants> {
    const config = await this.configCache.getConfig();
    return gameConfigToContractConstants(config);
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
    const total = entries.length;
    entries.forEach(([key, state], i) => {
      result.set(key, decodePlayer(key, state as any));
      onProgress?.((i + 1) / total);
    });
    if (total === 0) onProgress?.(1);
    return result;
  }

  public async getPlayerById(playerId: AztecAddr): Promise<Player | undefined> {
    const state = this.indexerConnection.getPlayer(playerId);
    if (!state) return undefined;
    return decodePlayer(playerId, state as any);
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
    const ids = this.indexerConnection.getPlanetIds();
    const total = ids.length;
    ids.forEach((_, i) => onProgress?.((i + 1) / total));
    if (total === 0) onProgress?.(1);
    return ids as LocationId[];
  }

  public async bulkGetPlanets(
    toLoadPlanets: LocationId[],
    onProgressPlanet?: (fractionCompleted: number) => void
  ): Promise<Map<LocationId, Planet>> {
    const planets = new Map<LocationId, Planet>();
    const total = toLoadPlanets.length;
    toLoadPlanets.forEach((locId, i) => {
      const raw = this.indexerConnection.getPlanet(locId);
      if (raw) {
        const planet = decodePlanet(locId, raw as any);
        planets.set(planet.locationId, planet);
      }
      onProgressPlanet?.((i + 1) / total);
    });
    if (total === 0) onProgressPlanet?.(1);
    return planets;
  }

  public async getPlanetById(
    planetId: LocationId
  ): Promise<Planet | undefined> {
    const raw = this.indexerConnection.getPlanet(planetId);
    if (!raw) return undefined;
    return decodePlanet(planetId, raw as any);
  }

  // =========================================================================
  // Read API — arrivals  (mirrors v0.6 getArrival / getArrivalsForPlanet / getAllArrivals)
  // =========================================================================

  public async getArrival(
    arrivalId: number
  ): Promise<QueuedArrival | undefined> {
    const raw = this.indexerConnection.getArrival(String(arrivalId));
    if (!raw) return undefined;
    return decodeArrival(String(arrivalId), raw as any);
  }

  public async getArrivalsForPlanet(
    planetId: LocationId
  ): Promise<QueuedArrival[]> {
    const arrivals = this.indexerConnection.getArrivalsForPlanets([planetId]);
    return arrivals.map((a) => decodeArrival(a.id ?? "", a as any));
  }

  public async getAllArrivals(
    planetsToLoad: LocationId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<QueuedArrival[]> {
    const arrivals =
      this.indexerConnection.getArrivalsForPlanets(planetsToLoad);
    const total = arrivals.length;
    const result = arrivals.map((a, i) => {
      const decoded = decodeArrival(a.id ?? "", a as any);
      onProgress?.((i + 1) / total);
      return decoded;
    });
    if (total === 0) onProgress?.(1);
    return result;
  }

  // =========================================================================
  // Read API — revealed coords  (mirrors v0.6 getRevealedCoordsByIdIfExists / getRevealedPlanetsCoords)
  // =========================================================================

  public async getRevealedCoordsByIdIfExists(
    planetId: LocationId
  ): Promise<RevealedCoords | undefined> {
    const raw = this.indexerConnection.getRevealedCoordsById(planetId);
    if (!raw) return undefined;
    const ret = decodePlanetRevealedCoords(planetId, raw as any);
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
    const entries = Array.from(allCoords.entries());
    const total = entries.length;
    const result: RevealedCoords[] = [];
    entries.forEach(([key, state], i) => {
      result.push(decodePlanetRevealedCoords(key, state as any));
      onProgressCoords?.((i + 1) / total);
    });
    if (total === 0) onProgressCoords?.(1);
    return result;
  }

  // =========================================================================
  // Read API — artifacts  (mirrors v0.6 getArtifactById / bulkGetArtifactsOnPlanets / bulkGetArtifacts / getPlayerArtifacts)
  // =========================================================================

  public async getArtifactById(
    artifactId: ArtifactId
  ): Promise<Artifact | undefined> {
    const state = this.indexerConnection.getArtifact(artifactId);
    if (!state) return undefined;
    const location = this.indexerConnection.getArtifactLocation(artifactId);
    return decodeArtifact(
      artifactId,
      state as any,
      undefined,
      location ? (location as any) : undefined
    );
  }

  public async bulkGetArtifactsOnPlanets(
    locationIds: LocationId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Artifact[][]> {
    const result: Artifact[][] = [];
    const total = locationIds.length;
    locationIds.forEach((locId, locIdx) => {
      const artIds = this.indexerConnection.getArtifactsOnPlanet(locId);
      const artifacts: Artifact[] = [];
      for (const artId of artIds) {
        const state = this.indexerConnection.getArtifact(artId);
        if (state) {
          const location = this.indexerConnection.getArtifactLocation(artId);
          artifacts.push(
            decodeArtifact(
              artId,
              state as any,
              undefined,
              location ? (location as any) : undefined
            )
          );
        }
      }
      result.push(artifacts);
      onProgress?.((locIdx + 1) / total);
    });
    if (total === 0) onProgress?.(1);
    return result;
  }

  public async bulkGetArtifacts(
    artifactIds: ArtifactId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Artifact[]> {
    const result: Artifact[] = [];
    const total = artifactIds.length;
    artifactIds.forEach((artId, i) => {
      const state = this.indexerConnection.getArtifact(artId);
      if (state) {
        const location = this.indexerConnection.getArtifactLocation(artId);
        result.push(
          decodeArtifact(
            artId,
            state as any,
            undefined,
            location ? (location as any) : undefined
          )
        );
      }
      onProgress?.((i + 1) / total);
    });
    if (total === 0) onProgress?.(1);
    return result;
  }

  public async getPlayerArtifacts(
    playerId?: AztecAddr,
    onProgress?: (percent: number) => void
  ): Promise<Artifact[]> {
    if (!playerId) return [];
    const artIds = Array.from(this.indexerConnection.getArtifactIds());
    const result: Artifact[] = [];
    const total = artIds.length;
    artIds.forEach((artId, i) => {
      const state = this.indexerConnection.getArtifact(artId);
      if (state && (state as any).controller === playerId) {
        const location = this.indexerConnection.getArtifactLocation(artId);
        result.push(
          decodeArtifact(
            artId,
            state as any,
            undefined,
            location ? (location as any) : undefined
          )
        );
      }
      onProgress?.((i + 1) / total);
    });
    if (total === 0) onProgress?.(1);
    return result;
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
