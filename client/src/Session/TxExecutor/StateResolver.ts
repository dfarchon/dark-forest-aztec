/**
 * StateResolver: reads IndexerConnection state + ConfigCache + ChainClock
 * and assembles the full contract argument arrays for each transaction method.
 *
 * The TxIntent.args contains snark proof outputs (computed by upper layer).
 * StateResolver appends config, timestamp, and on-chain state to produce
 * the complete argument array matching the Noir contract function signature.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { CONTRACT_PRECISION } from "@dfpunk/constants";
import {
  ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";
import { ArrivalStorageContract } from "@dfpunk/contracts/artifacts/ArrivalStorage";
import { ArtifactLocationStorageContract } from "@dfpunk/contracts/artifacts/ArtifactLocationStorage";
import { ArtifactStorageContract } from "@dfpunk/contracts/artifacts/ArtifactStorage";
import { PlanetArtifactsStorageContract } from "@dfpunk/contracts/artifacts/PlanetArtifactsStorage";
import { PlanetEventsStorageContract } from "@dfpunk/contracts/artifacts/PlanetEventsStorage";
import { PlanetStorageContract } from "@dfpunk/contracts/artifacts/PlanetStorage";
import { PlayerStorageContract } from "@dfpunk/contracts/artifacts/PlayerStorage";
import { WorldStorageContract } from "@dfpunk/contracts/artifacts/WorldStorage";
import { locationIdToDecStr } from "@dfpunk/serde";
import type { TxIntent, UnconfirmedInit, UnconfirmedMove } from "@dfpunk/types";

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { ConfigCache } from "./ConfigCache";
import {
  clampMoveForSubmit,
  getRefreshedPopulationAndSilver,
  validateMoveForSubmit,
} from "./MoveSimulation";
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
  computeArrivalHash,
  computeArtifactHash,
  computeArtifactLocationHash,
  computePlanetArtifactsHash,
  computePlanetEventsHash,
  computePlanetHash,
  computePlayerHash,
  computeWorldHash,
} from "./stateHash";
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

export interface StateResolverOptions {
  /** When true, every resolve*() call computes local Poseidon2 hashes and
   *  compares them against on-chain state roots before submitting.
   *  Useful for debugging indexer staleness. Defaults to false. */
  enableHashPreflight?: boolean;
}

export class StateResolver {
  private readonly indexer: IndexerConnection;
  private readonly configCache: ConfigCache;
  private readonly chainClock: ChainClock;
  private readonly getPlayerAddress: () => string;
  private readonly enableHashPreflight: boolean;

  private readonly planetStorage: PlanetStorageContract;
  private readonly planetEventsStorage: PlanetEventsStorageContract;
  private readonly planetArtifactsStorage: PlanetArtifactsStorageContract;
  private readonly arrivalStorage: ArrivalStorageContract;
  private readonly artifactStorage: ArtifactStorageContract;
  private readonly artifactLocationStorage: ArtifactLocationStorageContract;
  private readonly playerStorage: PlayerStorageContract;
  private readonly worldStorage: WorldStorageContract;

  /** Last chain block we know a tx was confirmed in; resolve() waits for indexer to sync to this before reading state. */
  private lastConfirmedBlock = 0;

  constructor(
    indexer: IndexerConnection,
    configCache: ConfigCache,
    chainClock: ChainClock,
    getPlayerAddress: () => string,
    wallet: Wallet,
    options?: StateResolverOptions
  ) {
    this.indexer = indexer;
    this.configCache = configCache;
    this.chainClock = chainClock;
    this.getPlayerAddress = getPlayerAddress;
    this.enableHashPreflight = options?.enableHashPreflight ?? false;

    this.planetStorage = PlanetStorageContract.at(
      AztecAddress.fromString(PLANET_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.planetEventsStorage = PlanetEventsStorageContract.at(
      AztecAddress.fromString(PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.planetArtifactsStorage = PlanetArtifactsStorageContract.at(
      AztecAddress.fromString(PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.arrivalStorage = ArrivalStorageContract.at(
      AztecAddress.fromString(ARRIVAL_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.artifactStorage = ArtifactStorageContract.at(
      AztecAddress.fromString(ARTIFACT_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.artifactLocationStorage = ArtifactLocationStorageContract.at(
      AztecAddress.fromString(ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.playerStorage = PlayerStorageContract.at(
      AztecAddress.fromString(PLAYER_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
    this.worldStorage = WorldStorageContract.at(
      AztecAddress.fromString(WORLD_STORAGE_CONTRACT_ADDRESS),
      wallet
    );
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

    const config = await this.configCache.getConfig();

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

    let timestamp = intent.uiTimestamp
      ? BigInt(Math.floor(intent.uiTimestamp))
      : BigInt(Math.floor(this.chainClock.nowSec()));
    if (planetRaw) {
      const planetLastUpdated = BigInt(planetRaw.last_updated);
      if (planetLastUpdated > timestamp) {
        console.warn(
          `[StateResolver] chainClock ${timestamp} behind planet last_updated=${planetLastUpdated}, advancing timestamp`
        );
        timestamp = planetLastUpdated;
      }
    }

    const [tier0, tier1, tier2, tier3] = config.planetTypeWeightsTiers;
    const levelIndex = Math.min(9, Math.max(0, Number(level)));
    const planetDefaultStats = config.planetDefaultStats[levelIndex];

    if (this.enableHashPreflight) {
      await this.verifyInitStateHashes(
        locationId,
        planetState,
        playerState,
        world
      );
    }

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
    let popMoved = BigInt(Math.round(intent.forces * CONTRACT_PRECISION));
    let silverMoved = BigInt(Math.round(intent.silver * CONTRACT_PRECISION));
    const movedArtifactId = intent.artifact ? BigInt(intent.artifact) : 0n;
    const activatedArtifactId = 0n; // TODO: support activated artifact
    const isAbandoning = intent.abandoning;

    // Resync clock before computing timestamp to minimize drift
    await this.chainClock.resync();
    const config = await this.configCache.getConfig();

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

    if (this.enableHashPreflight) {
      await this.verifyMoveStateHashes(
        sourceLoc,
        targetLoc,
        sourcePlanet,
        sourcePlanetEvents,
        sourcePlanetArtifacts,
        sourceArrivalData,
        targetPlanet,
        targetPlanetEvents,
        targetPlanetArtifacts,
        targetArrivalData,
        world,
        movedArtifactId,
        movedArtifact,
        movedArtifactLocation,
        activatedArtifactId,
        activatedArtifact
      );
    }

    // Use UI-provided timestamp when available so the refreshed population
    // matches the energy the user saw at move time.  Fall back to the
    // chain-clock for backward compatibility.
    let timestamp = intent.uiTimestamp
      ? BigInt(Math.floor(intent.uiTimestamp))
      : BigInt(Math.floor(this.chainClock.nowSec()));
    {
      const entityTimes: bigint[] = [];
      if (sourcePlanetRaw) entityTimes.push(sourcePlanetRaw.last_updated);
      if (sourcePlanetEventsRaw)
        entityTimes.push(sourcePlanetEventsRaw.last_updated);
      if (sourcePlanetArtifactsRaw)
        entityTimes.push(sourcePlanetArtifactsRaw.last_updated);
      if (targetPlanetRaw) entityTimes.push(targetPlanetRaw.last_updated);
      if (targetPlanetEventsRaw)
        entityTimes.push(targetPlanetEventsRaw.last_updated);
      if (targetPlanetArtifactsRaw)
        entityTimes.push(targetPlanetArtifactsRaw.last_updated);
      // Arrival departure_times (contract asserts timestamp >= departure_time)
      for (const arr of sourceArrivalData.arrivals) {
        const dt = (arr as Record<string, unknown>).departure_time;
        if (dt != null && dt !== 0) entityTimes.push(BigInt(dt as number));
      }
      for (const arr of targetArrivalData.arrivals) {
        const dt = (arr as Record<string, unknown>).departure_time;
        if (dt != null && dt !== 0) entityTimes.push(BigInt(dt as number));
      }
      let maxEntityTime = 0n;
      for (const t of entityTimes) {
        if (t > maxEntityTime) maxEntityTime = t;
      }
      if (maxEntityTime > timestamp) {
        console.warn(
          `[StateResolver] chainClock ${timestamp} behind entity state (max last_updated=${maxEntityTime}), advancing timestamp`
        );
        timestamp = maxEntityTime;
      }
    }

    // Client-side simulation: clamp population/silver to contract-safe ranges
    if (sourcePlanetRaw) {
      const timestampSec = Number(timestamp);
      const planetEventsForSim: import("../Indexer/TableTypes/chain").PlanetEventsState =
        sourcePlanetEventsRaw ?? {
          events: Array.from({ length: 20 }, () => ({ id: "0" })),
          count: 0,
          last_updated: 0n,
        };
      const refreshed = getRefreshedPopulationAndSilver(
        timestampSec,
        sourcePlanetRaw,
        planetEventsForSim,
        sourceArrivalData.arrivals,
        sourceArrivalData.artifacts
      );
      console.log("[StateResolver Move]", {
        intentForces: intent.forces,
        intentSilver: intent.silver,
        popMoved,
        silverMoved,
        timestamp: Number(timestamp),
        indexerPopulation: sourcePlanetRaw.population,
        indexerLastUpdated: Number(sourcePlanetRaw.last_updated),
        refreshedPopulation: refreshed.population,
        refreshedSilver: refreshed.silver,
      });

      const movedArtifactType = Number(
        (movedArtifact as Record<string, unknown>)?.artifact_type ?? 0
      );
      const isSpaceshipMove =
        movedArtifactId !== 0n &&
        [3, 10, 11, 12, 13, 14].includes(movedArtifactType);

      // Non-clampable preconditions (owner, destroyed) — still throw
      validateMoveForSubmit({
        isSpaceshipMove,
        sender: this.getPlayerAddress(),
        sourceOwner: refreshed.owner,
        sourceDestroyed: sourcePlanetRaw.destroyed,
      });

      // Clamp popMoved/silverMoved to contract-safe ranges
      const clamped = clampMoveForSubmit({
        refreshedPopulation: refreshed.population,
        refreshedSilver: refreshed.silver,
        popMoved,
        silverMoved,
        isSpaceshipMove,
      });
      popMoved = clamped.popMoved;
      silverMoved = clamped.silverMoved;
    }

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

  // -------------------------------------------------------------------------
  // Hash preflight verification
  // -------------------------------------------------------------------------

  /**
   * Compute local Poseidon2 hashes for every entity involved in a move and
   * compare them against the on-chain state roots via unconstrained reads.
   * Throws if any mismatch is detected (indexer state is stale).
   */
  private async verifyMoveStateHashes(
    sourceLoc: bigint,
    targetLoc: bigint,
    sourcePlanet: Record<string, unknown>,
    sourcePlanetEvents: Record<string, unknown>,
    sourcePlanetArtifacts: Record<string, unknown>,
    sourceArrivalData: {
      arrivals: Record<string, unknown>[];
      artifacts: Record<string, unknown>[];
      artifactLocations: Record<string, unknown>[];
    },
    targetPlanet: Record<string, unknown>,
    targetPlanetEvents: Record<string, unknown>,
    targetPlanetArtifacts: Record<string, unknown>,
    targetArrivalData: {
      arrivals: Record<string, unknown>[];
      artifacts: Record<string, unknown>[];
      artifactLocations: Record<string, unknown>[];
    },
    world: Record<string, unknown>,
    movedArtifactId: bigint,
    movedArtifact: Record<string, unknown>,
    movedArtifactLocation: Record<string, unknown>,
    activatedArtifactId: bigint,
    activatedArtifact: Record<string, unknown>
  ): Promise<void> {
    const ps = this.planetStorage;
    const pes = this.planetEventsStorage;
    const pas = this.planetArtifactsStorage;
    const arrs = this.arrivalStorage;
    const arts = this.artifactStorage;
    const als = this.artifactLocationStorage;
    const ws = this.worldStorage;
    const from = AztecAddress.fromString(this.getPlayerAddress());

    const mismatches: string[] = [];

    const check = async (
      label: string,
      localHashPromise: Promise<import("@aztec/aztec.js/fields").Fr>,
      onChainHashPromise: Promise<unknown>
    ) => {
      const [localHash, onChainHash] = await Promise.all([
        localHashPromise,
        onChainHashPromise,
      ]);
      const localBigInt = localHash.toBigInt();
      const onChainBigInt = BigInt(String(onChainHash));
      if (localBigInt !== onChainBigInt) {
        mismatches.push(
          `${label}: local=${localBigInt} onchain=${onChainBigInt}`
        );
      }
    };

    const checks: Promise<void>[] = [];

    // Source entity hashes
    checks.push(
      check(
        "source planet",
        computePlanetHash(sourcePlanet),
        ps.methods.get_state_root_unconstrained(sourceLoc).simulate({ from })
      )
    );
    checks.push(
      check(
        "source planet_events",
        computePlanetEventsHash(sourcePlanetEvents),
        pes.methods.get_state_root_unconstrained(sourceLoc).simulate({ from })
      )
    );
    checks.push(
      check(
        "source planet_artifacts",
        computePlanetArtifactsHash(sourcePlanetArtifacts),
        pas.methods.get_state_root_unconstrained(sourceLoc).simulate({ from })
      )
    );

    // Source arrivals batch
    for (let i = 0; i < 20; i++) {
      const arrival = sourceArrivalData.arrivals[i];
      const arrId = BigInt(Number(arrival["id"] ?? 0));
      if (arrId === 0n) continue;
      checks.push(
        check(
          `source arrival[${i}]`,
          computeArrivalHash(arrival),
          arrs.methods.get_state_root_unconstrained(arrId).simulate({ from })
        )
      );
      const art = sourceArrivalData.artifacts[i];
      const artCarried = BigInt(String(arrival["carried_artifact_id"] ?? 0));
      if (artCarried !== 0n) {
        checks.push(
          check(
            `source artifact[${i}]`,
            computeArtifactHash(art),
            arts.methods
              .get_state_root_unconstrained(artCarried)
              .simulate({ from })
          )
        );
        checks.push(
          check(
            `source artifact_location[${i}]`,
            computeArtifactLocationHash(sourceArrivalData.artifactLocations[i]),
            als.methods
              .get_state_root_unconstrained(artCarried)
              .simulate({ from })
          )
        );
      }
    }

    // Target entity hashes
    checks.push(
      check(
        "target planet",
        computePlanetHash(targetPlanet),
        ps.methods.get_state_root_unconstrained(targetLoc).simulate({ from })
      )
    );
    checks.push(
      check(
        "target planet_events",
        computePlanetEventsHash(targetPlanetEvents),
        pes.methods.get_state_root_unconstrained(targetLoc).simulate({ from })
      )
    );
    checks.push(
      check(
        "target planet_artifacts",
        computePlanetArtifactsHash(targetPlanetArtifacts),
        pas.methods.get_state_root_unconstrained(targetLoc).simulate({ from })
      )
    );

    // Target arrivals batch
    for (let i = 0; i < 20; i++) {
      const arrival = targetArrivalData.arrivals[i];
      const arrId = BigInt(Number(arrival["id"] ?? 0));
      if (arrId === 0n) continue;
      checks.push(
        check(
          `target arrival[${i}]`,
          computeArrivalHash(arrival),
          arrs.methods.get_state_root_unconstrained(arrId).simulate({ from })
        )
      );
      const art = targetArrivalData.artifacts[i];
      const artCarried = BigInt(String(arrival["carried_artifact_id"] ?? 0));
      if (artCarried !== 0n) {
        checks.push(
          check(
            `target artifact[${i}]`,
            computeArtifactHash(art),
            arts.methods
              .get_state_root_unconstrained(artCarried)
              .simulate({ from })
          )
        );
        checks.push(
          check(
            `target artifact_location[${i}]`,
            computeArtifactLocationHash(targetArrivalData.artifactLocations[i]),
            als.methods
              .get_state_root_unconstrained(artCarried)
              .simulate({ from })
          )
        );
      }
    }

    // World hash
    checks.push(
      check(
        "world",
        computeWorldHash(world),
        ws.methods.get_state_root_unconstrained(0).simulate({ from })
      )
    );

    // Moved artifact
    if (movedArtifactId !== 0n) {
      checks.push(
        check(
          "moved artifact",
          computeArtifactHash(movedArtifact),
          arts.methods
            .get_state_root_unconstrained(movedArtifactId)
            .simulate({ from })
        )
      );
      checks.push(
        check(
          "moved artifact_location",
          computeArtifactLocationHash(movedArtifactLocation),
          als.methods
            .get_state_root_unconstrained(movedArtifactId)
            .simulate({ from })
        )
      );
    }

    // Activated artifact
    if (activatedArtifactId !== 0n) {
      checks.push(
        check(
          "activated artifact",
          computeArtifactHash(activatedArtifact),
          arts.methods
            .get_state_root_unconstrained(activatedArtifactId)
            .simulate({ from })
        )
      );
    }

    await Promise.all(checks);

    if (mismatches.length > 0) {
      const msg = `[StateResolver] Hash preflight failed — indexer state is stale:\n${mismatches.join("\n")}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  /**
   * Hash preflight for initializePlayer: planet, player, and world.
   */
  private async verifyInitStateHashes(
    locationId: bigint,
    planetState: Record<string, unknown>,
    playerState: Record<string, unknown>,
    world: Record<string, unknown>
  ): Promise<void> {
    const from = AztecAddress.fromString(this.getPlayerAddress());
    const mismatches: string[] = [];

    const check = async (
      label: string,
      localHashPromise: Promise<import("@aztec/aztec.js/fields").Fr>,
      onChainHashPromise: Promise<unknown>
    ) => {
      const [localHash, onChainHash] = await Promise.all([
        localHashPromise,
        onChainHashPromise,
      ]);
      const localBigInt = localHash.toBigInt();
      const onChainBigInt = BigInt(String(onChainHash));
      if (localBigInt !== onChainBigInt) {
        mismatches.push(
          `${label}: local=${localBigInt} onchain=${onChainBigInt}`
        );
      }
    };

    await Promise.all([
      check(
        "planet",
        computePlanetHash(planetState),
        this.planetStorage.methods
          .get_state_root_unconstrained(locationId)
          .simulate({ from })
      ),
      check(
        "player",
        computePlayerHash(playerState),
        this.playerStorage.methods
          .get_state_root_unconstrained(from)
          .simulate({ from })
      ),
      check(
        "world",
        computeWorldHash(world),
        this.worldStorage.methods
          .get_state_root_unconstrained(0)
          .simulate({ from })
      ),
    ]);

    if (mismatches.length > 0) {
      const msg = `[StateResolver] Init hash preflight failed — indexer state is stale:\n${mismatches.join("\n")}`;
      console.error(msg);
      throw new Error(msg);
    }
  }
}
