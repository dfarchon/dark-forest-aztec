/**
 * StateResolver: reads IndexerConnection state + ConfigCache + TimestampProvider
 * and assembles the full contract argument arrays for each transaction method.
 *
 * The TxIntent.args contains snark proof outputs (computed by upper layer).
 * StateResolver appends config, timestamp, and on-chain state to produce
 * the complete argument array matching the Noir contract function signature.
 */

import { CONTRACT_PRECISION } from "@dfpunk/constants";
import { locationIdToDecStr } from "@dfpunk/serde";
import type { TxIntent, UnconfirmedInit, UnconfirmedMove } from "@dfpunk/types";

import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { ConfigCache } from "./ConfigCache";
import {
  arrivalToContract,
  artifactLocationToContract,
  artifactToContract,
  planetArtifactsToContract,
  planetEventsToContract,
  planetToContract,
  playerToContract,
  worldToContract,
} from "./stateConvert";
import {
  arrivalZero,
  artifactLocationZero,
  artifactZero,
  planetArtifactsZero,
  planetEventsZero,
  planetZero,
  playerZero,
  worldInitial,
} from "./stateZeros";
import type { TimestampProvider } from "./TimestampProvider";

// BN254 scalar field modulus (Fr order).
// Negative coordinates are mapped to field elements: -n → p - n.
const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function signedCoordToField(v: number | bigint): bigint {
  const n = typeof v === "bigint" ? v : BigInt(v);
  return n < 0n ? BN254_FR_MODULUS + n : n;
}

/** Convert a hex LocationId string (no 0x prefix) to bigint for Fr encoding. */
function hexIdToField(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  const s = String(v);
  return BigInt(s.startsWith("0x") ? s : `0x${s}`);
}

// ---------------------------------------------------------------------------
// StateResolver
// ---------------------------------------------------------------------------

export class StateResolver {
  private readonly indexer: IndexerConnection;
  private readonly configCache: ConfigCache;
  private readonly timestampProvider: TimestampProvider;
  private readonly getPlayerAddress: () => string;

  /** Last chain block we know a tx was confirmed in; resolve() waits for indexer to sync to this before reading state. */
  private lastConfirmedBlock = 0;

  constructor(
    indexer: IndexerConnection,
    configCache: ConfigCache,
    timestampProvider: TimestampProvider,
    getPlayerAddress: () => string
  ) {
    this.indexer = indexer;
    this.configCache = configCache;
    this.timestampProvider = timestampProvider;
    this.getPlayerAddress = getPlayerAddress;
  }

  /** Called by TxExecutor after a tx confirms so the next resolve() waits for indexer to sync to that block. */
  setLastConfirmedBlock(block: number): void {
    this.lastConfirmedBlock = Math.max(this.lastConfirmedBlock, block);
  }

  /**
   * Resolve a TxIntent into the full contract argument array.
   * Waits for indexer to sync to lastConfirmedBlock (if set), then reads indexer state, loads config, gets timestamp, and assembles args.
   */
  async resolve(intent: TxIntent): Promise<unknown[]> {
    if (this.lastConfirmedBlock > 0) {
      await this.indexer.waitForBlock(this.lastConfirmedBlock);
    }
    switch (intent.methodName) {
      case "initializePlayer":
        return this.resolveInitializePlayer(intent as UnconfirmedInit);
      case "move":
        return this.resolveMove(intent as UnconfirmedMove);
      default:
        throw new Error(
          `StateResolver: method "${intent.methodName}" not implemented`
        );
    }
  }

  // -------------------------------------------------------------------------
  // initializePlayer — 22 args
  // [x, y, radius, locationId, perlin, level, timestamp,
  //  snarkConfig, planetDefaultStats, worldConfig, gameConfigCore,
  //  planetLevelThresholds, spaceJunkConfig, tier0, tier1, tier2, tier3,
  //  planetState, playerState, world]
  // -------------------------------------------------------------------------

  private async resolveInitializePlayer(
    intent: UnconfirmedInit
  ): Promise<unknown[]> {
    const intentArgs = await intent.args;
    // intentArgs = [x, y, radius, locationId, perlin, level]
    const [rawX, rawY, radius, rawLocationId, perlin, level] = intentArgs;
    const x = signedCoordToField(rawX as number | bigint);
    const y = signedCoordToField(rawY as number | bigint);
    const locationId = hexIdToField(rawLocationId);

    const [config, timestamp] = await Promise.all([
      this.configCache.getConfig(),
      this.timestampProvider.getTimestamp(),
    ]);

    // Read current state from indexer (or zeros if not yet on-chain)
    // Indexer stores by decimal string key; rawLocationId is hex LocationId
    const locationIdDec = locationIdToDecStr(
      String(rawLocationId) as import("@dfpunk/types").LocationId
    );
    const playerAddr = this.getPlayerAddress();

    const planetRaw = this.indexer.getPlanet(locationIdDec);
    const planetState = planetRaw ? planetToContract(planetRaw) : planetZero();

    const playerRaw = this.indexer.getPlayer(playerAddr);
    const playerState = playerRaw ? playerToContract(playerRaw) : playerZero();

    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    const [tier0, tier1, tier2, tier3] = config.planetTypeWeightsTiers;
    const levelIndex = Math.min(9, Math.max(0, Number(level)));
    const planetDefaultStats = config.planetDefaultStats[levelIndex];

    return [
      x,
      y,
      radius,
      locationId,
      perlin,
      level,
      timestamp,
      config.snarkConfig,
      planetDefaultStats,
      config.worldConfig,
      config.gameConfigCore,
      config.planetLevelThresholds,
      config.spaceJunkConfig,
      tier0,
      tier1,
      tier2,
      tier3,
      planetState,
      playerState,
      world,
    ];
  }

  // -------------------------------------------------------------------------
  // move — 36+ args
  // [sourceLoc, targetLoc, targetPerlin, targetLevel, targetRadius, maxDist,
  //  x1, y1, x2, y2, popMoved, silverMoved,
  //  movedArtifactId, activatedArtifactId, isAbandoning, timestamp,
  //  snarkConfig, planetDefaultStats, worldConfig, gameConfigCore,
  //  planetLevelThresholds, spaceJunkConfig, tier0, tier1, tier2, tier3,
  //  sourcePlanet, sourcePlanetEvents,
  //  sourceArrivals[20], sourceArtifacts[20], sourceArtifactLocations[20],
  //  sourcePlanetArtifacts,
  //  targetPlanet, targetPlanetEvents,
  //  targetArrivals[20], targetArtifacts[20], targetArtifactLocations[20],
  //  targetPlanetArtifacts,
  //  world, movedArtifact, movedArtifactLocation, activatedArtifact]
  // -------------------------------------------------------------------------

  private async resolveMove(intent: UnconfirmedMove): Promise<unknown[]> {
    const intentArgs = await intent.args;
    // intentArgs = [sourceLoc, targetLoc, targetPerlin, targetLevel,
    //               targetRadius, maxDist, x1, y1, x2, y2]
    const [
      rawSourceLoc,
      rawTargetLoc,
      targetPerlin,
      targetLevel,
      targetRadius,
      maxDist,
      rawX1,
      rawY1,
      rawX2,
      rawY2,
    ] = intentArgs;
    const sourceLoc = hexIdToField(rawSourceLoc);
    const targetLoc = hexIdToField(rawTargetLoc);
    const x1 = signedCoordToField(rawX1 as number | bigint);
    const y1 = signedCoordToField(rawY1 as number | bigint);
    const x2 = signedCoordToField(rawX2 as number | bigint);
    const y2 = signedCoordToField(rawY2 as number | bigint);

    // Frontend energy/silver values are divided by CONTRACT_PRECISION (1000).
    // Contract expects raw u128 values, so multiply back.
    const popMoved = BigInt(Math.round(intent.forces * CONTRACT_PRECISION));
    const silverMoved = BigInt(Math.round(intent.silver * CONTRACT_PRECISION));
    const movedArtifactId = intent.artifact ? BigInt(intent.artifact) : 0n;
    const activatedArtifactId = 0n; // TODO: support activated artifact
    const isAbandoning = intent.abandoning;

    const [config, timestamp] = await Promise.all([
      this.configCache.getConfig(),
      this.timestampProvider.getTimestamp(),
    ]);

    // Indexer stores by decimal string key; rawSourceLoc/rawTargetLoc are hex LocationIds
    const sourceLocDec = locationIdToDecStr(
      String(rawSourceLoc) as import("@dfpunk/types").LocationId
    );
    const targetLocDec = locationIdToDecStr(
      String(rawTargetLoc) as import("@dfpunk/types").LocationId
    );

    // Source planet state
    const sourcePlanetRaw = this.indexer.getPlanet(sourceLocDec);
    const sourcePlanet = sourcePlanetRaw
      ? planetToContract(sourcePlanetRaw)
      : planetZero();

    const sourcePlanetEventsRaw = this.indexer.getPlanetEvents(sourceLocDec);
    const sourcePlanetEvents = sourcePlanetEventsRaw
      ? planetEventsToContract(sourcePlanetEventsRaw)
      : planetEventsZero();

    const sourcePlanetArtifactsRaw =
      this.indexer.getPlanetArtifacts(sourceLocDec);
    const sourcePlanetArtifacts = sourcePlanetArtifactsRaw
      ? planetArtifactsToContract(sourcePlanetArtifactsRaw)
      : planetArtifactsZero();

    // Load source arrivals, artifacts, artifact locations from planet events
    const sourceArrivalData = this.loadArrivalsForPlanetEvents(
      sourcePlanetEventsRaw
    );

    // Target planet state
    const targetPlanetRaw = this.indexer.getPlanet(targetLocDec);
    const targetPlanet = targetPlanetRaw
      ? planetToContract(targetPlanetRaw)
      : planetZero();

    const targetPlanetEventsRaw = this.indexer.getPlanetEvents(targetLocDec);
    const targetPlanetEvents = targetPlanetEventsRaw
      ? planetEventsToContract(targetPlanetEventsRaw)
      : planetEventsZero();

    const targetPlanetArtifactsRaw =
      this.indexer.getPlanetArtifacts(targetLocDec);
    const targetPlanetArtifacts = targetPlanetArtifactsRaw
      ? planetArtifactsToContract(targetPlanetArtifactsRaw)
      : planetArtifactsZero();

    const targetArrivalData = this.loadArrivalsForPlanetEvents(
      targetPlanetEventsRaw
    );

    // World state
    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    // Moved/activated artifact state
    const movedArtifact =
      movedArtifactId !== 0n
        ? this.loadArtifactOrZero(String(movedArtifactId))
        : artifactZero();
    const movedArtifactLocation =
      movedArtifactId !== 0n
        ? this.loadArtifactLocationOrZero(String(movedArtifactId))
        : artifactLocationZero();
    const activatedArtifact =
      activatedArtifactId !== 0n
        ? this.loadArtifactOrZero(String(activatedArtifactId))
        : artifactZero();

    const [tier0, tier1, tier2, tier3] = config.planetTypeWeightsTiers;
    const levelIndex = Math.min(9, Math.max(0, Number(targetLevel)));
    const planetDefaultStats = config.planetDefaultStats[levelIndex];

    return [
      sourceLoc,
      targetLoc,
      targetPerlin,
      targetLevel,
      targetRadius,
      maxDist,
      x1,
      y1,
      x2,
      y2,
      popMoved,
      silverMoved,
      movedArtifactId,
      activatedArtifactId,
      isAbandoning,
      timestamp,
      config.snarkConfig,
      planetDefaultStats,
      config.worldConfig,
      config.gameConfigCore,
      config.planetLevelThresholds,
      config.spaceJunkConfig,
      tier0,
      tier1,
      tier2,
      tier3,
      sourcePlanet,
      sourcePlanetEvents,
      sourceArrivalData.arrivals,
      sourceArrivalData.artifacts,
      sourceArrivalData.artifactLocations,
      sourcePlanetArtifacts,
      targetPlanet,
      targetPlanetEvents,
      targetArrivalData.arrivals,
      targetArrivalData.artifacts,
      targetArrivalData.artifactLocations,
      targetPlanetArtifacts,
      world,
      movedArtifact,
      movedArtifactLocation,
      activatedArtifact,
    ];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Load arrivals, artifacts, and artifact locations for a planet's events.
   * Returns arrays of length 20, padded with zeros for unused slots.
   * Matches contracts/scripts/test-move.ts loadArrivalsForPlanetEvents().
   */
  private loadArrivalsForPlanetEvents(
    planetEvents:
      | import("../Indexer/TableTypes/chain").PlanetEventsState
      | undefined
  ): {
    arrivals: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
    artifactLocations: Record<string, unknown>[];
  } {
    const count = planetEvents?.count ?? 0;
    const events = planetEvents?.events ?? [];

    const arrivals: Record<string, unknown>[] = [];
    const artifacts: Record<string, unknown>[] = [];
    const artifactLocations: Record<string, unknown>[] = [];

    for (let i = 0; i < 20; i++) {
      if (i < count && events[i]?.id != null && String(events[i].id) !== "0") {
        const arrivalId = String(events[i].id);
        const arrival = this.indexer.getArrival(arrivalId);
        if (arrival) {
          arrivals.push(arrivalToContract(arrival));
          // If arrival carries an artifact, load it
          if (
            arrival.carried_artifact_id &&
            String(arrival.carried_artifact_id) !== "0"
          ) {
            const artId = String(arrival.carried_artifact_id);
            artifacts.push(this.loadArtifactOrZero(artId));
            artifactLocations.push(this.loadArtifactLocationOrZero(artId));
          } else {
            artifacts.push(artifactZero());
            artifactLocations.push(artifactLocationZero());
          }
        } else {
          arrivals.push(arrivalZero());
          artifacts.push(artifactZero());
          artifactLocations.push(artifactLocationZero());
        }
      } else {
        arrivals.push(arrivalZero());
        artifacts.push(artifactZero());
        artifactLocations.push(artifactLocationZero());
      }
    }

    return { arrivals, artifacts, artifactLocations };
  }

  private loadArtifactOrZero(id: string): Record<string, unknown> {
    const raw = this.indexer.getArtifact(id);
    return raw ? artifactToContract(raw) : artifactZero();
  }

  private loadArtifactLocationOrZero(id: string): Record<string, unknown> {
    const raw = this.indexer.getArtifactLocation(id);
    return raw ? artifactLocationToContract(raw) : artifactLocationZero();
  }
}
