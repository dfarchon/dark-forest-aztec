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
  PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";
import { ArrivalStorageContract } from "@dfpunk/contracts/artifacts/ArrivalStorage";
import { ArtifactLocationStorageContract } from "@dfpunk/contracts/artifacts/ArtifactLocationStorage";
import { ArtifactStorageContract } from "@dfpunk/contracts/artifacts/ArtifactStorage";
import { PlanetArtifactsStorageContract } from "@dfpunk/contracts/artifacts/PlanetArtifactsStorage";
import { PlanetEventsStorageContract } from "@dfpunk/contracts/artifacts/PlanetEventsStorage";
import { PlanetRevealedCoordsStorageContract } from "@dfpunk/contracts/artifacts/PlanetRevealedCoordsStorage";
import { PlanetStorageContract } from "@dfpunk/contracts/artifacts/PlanetStorage";
import { PlayerStorageContract } from "@dfpunk/contracts/artifacts/PlayerStorage";
import { WorldStorageContract } from "@dfpunk/contracts/artifacts/WorldStorage";
import { locationIdToDecStr } from "@dfpunk/serde";
import type {
  TxIntent,
  UnconfirmedActivateArtifact,
  UnconfirmedAdminSetWorldRadius,
  UnconfirmedCreatePlanet,
  UnconfirmedDeactivateArtifact,
  UnconfirmedDepositArtifact,
  UnconfirmedFindArtifact,
  UnconfirmedGetShips,
  UnconfirmedInit,
  UnconfirmedMove,
  UnconfirmedPauseGame,
  UnconfirmedProspectPlanet,
  UnconfirmedReveal,
  UnconfirmedSafeSetOwner,
  UnconfirmedSetWorldConfig,
  UnconfirmedUnpauseGame,
  UnconfirmedUpgrade,
  UnconfirmedWithdrawArtifact,
  UnconfirmedWithdrawSilver,
} from "@dfpunk/types";
import {
  buildLocationProofInputs,
  buildMoveProofInputs,
  computeLocationProofOutputs,
  computeMoveProofOutputs,
  unwrapSimulateResult,
  validateLocationProofOutputs,
  validateMoveProofOutputs,
} from "@dfpunk/utils";

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { ConfigCache } from "./ConfigCache";
import { resolveActivateArtifact } from "./resolveActivateArtifact";
import { resolveAdminGiveArtifact } from "./resolveAdminGiveArtifact";
import { resolveAdminGiveSpaceship } from "./resolveAdminGiveSpaceship";
import { resolveDeactivateArtifact } from "./resolveDeactivateArtifact";
import { resolveDepositArtifact } from "./resolveDepositArtifact";
import { resolveFindArtifact } from "./resolveFindArtifact";
import { resolveGiveSpaceships } from "./resolveGiveSpaceships";
import { resolveProspectPlanet } from "./resolveProspectPlanet";
import type { ResolverDeps } from "./resolverHelpers";
import { resolveWithdrawArtifact } from "./resolveWithdrawArtifact";
import {
  arrivalToContract,
  artifactLocationToContract,
  artifactToContract,
  planetArtifactsToContract,
  planetEventsToContract,
  planetRevealedCoordsToContract,
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
  computePlanetRevealedCoordsHash,
  computePlayerHash,
  computeWorldHash,
} from "./stateHash";
import {
  arrivalZero,
  artifactLocationZero,
  artifactZero,
  planetArtifactsZero,
  planetEventsZero,
  planetRevealedCoordsZero,
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

/**
 * Compute planet level from a locationId (bigint) and perlin value, matching
 * the Noir contract's `get_planet_level_type_and_space_type` algorithm.
 *
 * Steps:
 *   1. Extract bytes 4-6 (big-endian) from the 32-byte location hash.
 *   2. Walk thresholds[9] down to thresholds[0]; first threshold that the
 *      extracted uint is less than determines the level.
 *   3. Cap level by space type (Nebula ≤ 4, Space ≤ 5).
 *   4. Cap level by max_natural_planet_level.
 */
function computePlanetLevelFromLocationId(
  locationId: bigint,
  perlin: number,
  gameConfigCore: Record<string, unknown>,
  planetLevelThresholds: Record<string, unknown>
): number {
  const thresholds = (planetLevelThresholds as { thresholds?: unknown[] })
    .thresholds as (bigint | number)[];

  const perlinT1 = Number(gameConfigCore.perlin_threshold_1 ?? 14);
  const perlinT2 = Number(gameConfigCore.perlin_threshold_2 ?? 15);
  const maxNatural = Number(gameConfigCore.max_natural_planet_level ?? 9);

  let spaceType: number;
  if (perlin < perlinT1)
    spaceType = 0; // Nebula
  else if (perlin < perlinT2)
    spaceType = 1; // Space
  else spaceType = 2; // DeepSpace or DeadSpace (no cap)

  // Bytes 4-6 inclusive from 32-byte big-endian = shift right 200 bits, mask 3 bytes
  const levelUint = (locationId >> 200n) & 0xffffffn;

  let level = 0;
  for (let i = 9; i >= 0; i--) {
    if (levelUint < BigInt(thresholds[i])) {
      level = i;
      break;
    }
  }

  if (spaceType === 0 && level > 4) level = 4;
  if (spaceType === 1 && level > 5) level = 5;
  if (level > maxNatural) level = maxNatural;

  return level;
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
  private readonly planetRevealedCoordsStorage: PlanetRevealedCoordsStorageContract;
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
    this.planetRevealedCoordsStorage = PlanetRevealedCoordsStorageContract.at(
      AztecAddress.fromString(PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS),
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

  /** Bundle shared deps for external resolve functions. */
  private getDeps(): ResolverDeps {
    return {
      indexer: this.indexer,
      configCache: this.configCache,
      chainClock: this.chainClock,
      getPlayerAddress: this.getPlayerAddress,
    };
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
      case "revealLocation":
        return this.resolveRevealLocation(intent as UnconfirmedReveal);
      case "move":
        return this.resolveMove(intent as UnconfirmedMove);
      case "upgradePlanet":
        return this.resolveUpgradePlanet(intent as UnconfirmedUpgrade);
      case "withdrawSilver":
        return this.resolveWithdrawSilver(intent as UnconfirmedWithdrawSilver);
      case "setWorldConfig":
        return this.resolveSetWorldConfig(intent as UnconfirmedSetWorldConfig);
      case "pauseGame":
        return this.resolvePauseGame(intent as UnconfirmedPauseGame);
      case "unpauseGame":
        return this.resolveUnpauseGame(intent as UnconfirmedUnpauseGame);
      case "adminSetWorldRadius":
        return this.resolveAdminSetWorldRadius(
          intent as UnconfirmedAdminSetWorldRadius
        );
      case "createPlanet":
        return this.resolveCreatePlanet(intent as UnconfirmedCreatePlanet);
      case "safeSetOwner":
        return this.resolveSafeSetOwner(intent as UnconfirmedSafeSetOwner);

      // Artifact operations — delegated to separate files
      case "prospectPlanet":
        return resolveProspectPlanet(
          intent as UnconfirmedProspectPlanet,
          this.getDeps()
        );
      case "findArtifact":
        return resolveFindArtifact(
          intent as UnconfirmedFindArtifact,
          this.getDeps()
        );
      case "activateArtifact":
        return resolveActivateArtifact(
          intent as UnconfirmedActivateArtifact,
          this.getDeps()
        );
      case "deactivateArtifact":
        return resolveDeactivateArtifact(
          intent as UnconfirmedDeactivateArtifact,
          this.getDeps()
        );
      case "depositArtifact":
        return resolveDepositArtifact(
          intent as UnconfirmedDepositArtifact,
          this.getDeps()
        );
      case "withdrawArtifact":
        return resolveWithdrawArtifact(
          intent as UnconfirmedWithdrawArtifact,
          this.getDeps()
        );
      case "giveSpaceShips":
        return resolveGiveSpaceships(
          intent as UnconfirmedGetShips,
          this.getDeps()
        );
      case "adminGiveArtifact":
        return resolveAdminGiveArtifact(intent, this.getDeps());
      case "adminGiveSpaceship":
        return resolveAdminGiveSpaceship(intent, this.getDeps());

      default:
        throw new Error(
          `StateResolver: method "${intent.methodName}" not implemented`
        );
    }
  }

  // -------------------------------------------------------------------------
  // initializePlayer — 25 args
  // [x, y, radius, locationId, perlin, level, timestamp,
  //  snarkConfig, planetDefaultStats, worldConfig, gameConfigCore,
  //  planetLevelThresholds, spaceJunkConfig, tier0, tier1, tier2, tier3,
  //  planetState, planetEventsState, planetArtifactsState,
  //  arrivals[20], arrivalArtifacts[20], arrivalArtifactLocations[20],
  //  playerState, world]
  // -------------------------------------------------------------------------

  private async resolveInitializePlayer(
    intent: UnconfirmedInit
  ): Promise<unknown[]> {
    const intentArgs = await intent.args;
    // intentArgs = [x, y, radius, locationId, perlin, level]
    const [rawX, rawY, radius, rawLocationId, rawPerlin, rawLevel] = intentArgs;
    const x = signedCoordToField(rawX as number | bigint);
    const y = signedCoordToField(rawY as number | bigint);
    let locationId = hexIdToField(rawLocationId);
    let perlin = Number(rawPerlin);
    let level = Number(rawLevel);

    const config = await this.configCache.getConfig();

    // Init proof: when ZK checks enabled, recompute location hash, perlin,
    // and level with Poseidon2 so they match what init_proof computes:
    //   planet_hash = poseidon2_hash([planet_hash_key, x, y])
    //   perlin = multi_scale_perlin(...)
    //   level = derived from bytes 4-6 of planet_hash
    const snark = config.snarkConfig as Record<string, unknown> | undefined;
    if (snark && !snark.disable_zk_checks) {
      const coord = (v: unknown) =>
        typeof v === "number" ? v : Number(BigInt(String(v ?? 0)));
      const inputs = buildLocationProofInputs(
        {
          planethash_key: BigInt(String(snark.planethash_key ?? 0)),
          spacetype_key: BigInt(String(snark.spacetype_key ?? 0)),
          perlin_length_scale: BigInt(String(snark.perlin_length_scale ?? 0)),
          perlin_mirror_x: Boolean(snark.perlin_mirror_x),
          perlin_mirror_y: Boolean(snark.perlin_mirror_y),
        },
        coord(rawX),
        coord(rawY)
      );
      const outputs = await computeLocationProofOutputs(inputs);
      locationId = outputs.locationHash;
      perlin = Math.floor(outputs.perlin);
      level = computePlanetLevelFromLocationId(
        locationId,
        perlin,
        config.gameConfigCore as Record<string, unknown>,
        config.planetLevelThresholds as Record<string, unknown>
      );
      console.debug("[Init proof] computed (Poseidon2):", {
        x: inputs.x,
        y: inputs.y,
        locationHash: outputs.locationHash.toString(),
        perlin,
        level,
        perlinRaw: outputs.perlin,
      });
    }

    // Read current state from indexer (or zeros if not yet on-chain)
    // Indexer stores by decimal string key; rawLocationId is hex LocationId
    const locationIdDec = locationIdToDecStr(
      String(rawLocationId) as import("@dfpunk/types").LocationId
    );
    const playerAddr = this.getPlayerAddress();

    const planetRaw = this.indexer.getPlanet(locationIdDec);
    const planetState = planetRaw ? planetToContract(planetRaw) : planetZero();

    const planetEventsRaw = this.indexer.getPlanetEvents(locationIdDec);
    const planetEventsState = planetEventsRaw
      ? planetEventsToContract(planetEventsRaw)
      : planetEventsZero();

    const planetArtifactsRaw = this.indexer.getPlanetArtifacts(locationIdDec);
    const planetArtifactsState = planetArtifactsRaw
      ? planetArtifactsToContract(planetArtifactsRaw)
      : planetArtifactsZero();

    const arrivalData = this.loadArrivalsForPlanetEvents(planetEventsRaw);

    const playerRaw = this.indexer.getPlayer(playerAddr);
    const playerState = playerRaw ? playerToContract(playerRaw) : playerZero();

    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    let timestamp = BigInt(
      Math.floor(intent.uiTimestamp ?? this.chainClock.nowSec())
    );
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
    const levelIndex = Math.min(9, Math.max(0, level));
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
      planetEventsState,
      planetArtifactsState,
      arrivalData.arrivals,
      arrivalData.artifacts,
      arrivalData.artifactLocations,
      playerState,
      world,
    ];
  }

  // -------------------------------------------------------------------------
  // revealLocation — 21 args
  // [location, perlin, level, x, y, timestamp, is_admin,
  //  snarkConfig, planetDefaultStats, worldConfig, gameConfigCore,
  //  planetLevelThresholds, spaceJunkConfig, tier0, tier1, tier2, tier3,
  //  planetState, planetRevealedCoords, playerState, world]
  // -------------------------------------------------------------------------

  private async resolveRevealLocation(
    intent: UnconfirmedReveal
  ): Promise<unknown[]> {
    const intentArgs = await intent.args;
    // intentArgs = [planetId, x, y]
    const [rawLocationId, rawX, rawY] = intentArgs;
    let locationId = hexIdToField(rawLocationId);
    const x = signedCoordToField(rawX as number | bigint);
    const y = signedCoordToField(rawY as number | bigint);

    const config = await this.configCache.getConfig();

    // Reveal proof: when ZK checks enabled, recompute location hash & perlin
    // with Poseidon2 so they match what reveal_proof computes in the circuit:
    //   planet_hash = poseidon2_hash([planet_hash_key, x, y])
    //   perlin = multi_scale_perlin(...)
    let perlin = 0;
    const snark = config.snarkConfig as Record<string, unknown> | undefined;
    if (snark && !snark.disable_zk_checks) {
      const coord = (v: unknown) =>
        typeof v === "number" ? v : Number(BigInt(String(v ?? 0)));
      const inputs = buildLocationProofInputs(
        {
          planethash_key: BigInt(String(snark.planethash_key ?? 0)),
          spacetype_key: BigInt(String(snark.spacetype_key ?? 0)),
          perlin_length_scale: BigInt(String(snark.perlin_length_scale ?? 0)),
          perlin_mirror_x: Boolean(snark.perlin_mirror_x),
          perlin_mirror_y: Boolean(snark.perlin_mirror_y),
        },
        coord(rawX),
        coord(rawY)
      );
      const outputs = await computeLocationProofOutputs(inputs);
      // Override locationId and perlin with Poseidon2-computed values so
      // they match reveal_proof(x, y, key, ...) in the circuit exactly.
      locationId = outputs.locationHash;
      perlin = Math.floor(outputs.perlin);
      console.debug("[Reveal proof] computed (Poseidon2):", {
        x: inputs.x,
        y: inputs.y,
        locationHash: outputs.locationHash.toString(),
        perlin,
        perlinRaw: outputs.perlin,
      });
    }

    // Read state from indexer
    const locationIdDec = locationIdToDecStr(
      String(rawLocationId) as import("@dfpunk/types").LocationId
    );
    const playerAddr = this.getPlayerAddress();

    const planetRaw = this.indexer.getPlanet(locationIdDec);
    const planetState = planetRaw ? planetToContract(planetRaw) : planetZero();

    const revealedCoordsRaw = this.indexer.getRevealedCoordsById(locationIdDec);
    const planetRevealedCoords = revealedCoordsRaw
      ? planetRevealedCoordsToContract(revealedCoordsRaw)
      : planetRevealedCoordsZero();

    const playerRaw = this.indexer.getPlayer(playerAddr);
    const playerState = playerRaw ? playerToContract(playerRaw) : playerZero();

    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    // When ZK checks are enabled, the Poseidon2 locationId has different bytes
    // than the hash stored in the indexer, so the contract will derive a
    // different level.  Recompute it client-side to match.
    let level: number;
    if (snark && !snark.disable_zk_checks && !planetRaw?.is_initialized) {
      level = computePlanetLevelFromLocationId(
        locationId,
        perlin,
        config.gameConfigCore as Record<string, unknown>,
        config.planetLevelThresholds as Record<string, unknown>
      );
      console.debug("[Reveal proof] computed level:", level);
    } else {
      level = planetRaw ? planetRaw.planet_level : 0;
      perlin = planetRaw ? planetRaw.perlin : 0;
    }

    let timestamp = BigInt(
      Math.floor(intent.uiTimestamp ?? this.chainClock.nowSec())
    );
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

    const isAdmin =
      !!config.admin && playerAddr.toLowerCase() === config.admin.toLowerCase();

    if (this.enableHashPreflight) {
      await this.verifyRevealStateHashes(
        locationId,
        planetState,
        planetRevealedCoords,
        playerState,
        world
      );
    }

    return [
      locationId,
      perlin,
      level,
      x,
      y,
      timestamp,
      isAdmin,
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
      planetRevealedCoords,
      playerState,
      world,
    ];
  }

  // -------------------------------------------------------------------------
  // move — 37 args
  // [sourceLoc, targetLoc, targetPerlin, targetLevel, maxDist,
  //  x1, y1, x2, y2, popMoved, silverMoved,
  //  movedArtifactId, sourceActivatedArtifactId, targetActivatedArtifactId,
  //  isAbandoning, timestamp,
  //  snarkConfig, planetDefaultStats, worldConfig, gameConfigCore,
  //  planetLevelThresholds, spaceJunkConfig, tier0, tier1, tier2, tier3,
  //  artifactsConfig,
  //  sourcePlanet, sourcePlanetArtifacts, sourcePlanetEvents,
  //  sourceArrivals[20], sourceArtifacts[20], sourceArtifactLocations[20],
  //  targetPlanet, targetPlanetArtifacts, targetPlanetEvents,
  //  targetArrivals[20], targetArtifacts[20], targetArtifactLocations[20],
  //  world, movedArtifact, sourceActivatedArtifact, targetActivatedArtifact]
  // -------------------------------------------------------------------------

  private async resolveMove(intent: UnconfirmedMove): Promise<unknown[]> {
    const intentArgs = await intent.args;
    // intentArgs = [sourceLoc, targetLoc, targetPerlin, targetLevel,
    //               maxDist, x1, y1, x2, y2]
    const [
      rawSourceLoc,
      rawTargetLoc,
      targetPerlinFromIntent,
      targetLevel,
      maxDist,
      rawX1,
      rawY1,
      rawX2,
      rawY2,
    ] = intentArgs;
    let targetPerlin = Number(targetPerlinFromIntent);
    let targetLevelResolved = Number(targetLevel);
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
    const movedArtifactId = intent.artifact
      ? BigInt(`0x${intent.artifact}`)
      : 0n;
    const isAbandoning = intent.abandoning;

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

    // Resolve activated artifact IDs from planet_artifacts
    const sourceActivatedArtifactId = this.findActivatedArtifactId(
      sourcePlanetArtifactsRaw
    );
    const targetActivatedArtifactId = this.findActivatedArtifactId(
      targetPlanetArtifactsRaw
    );

    // World state
    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    // Moved/activated artifact state
    const movedArtifact =
      movedArtifactId !== 0n
        ? this.loadArtifactOrZero(String(movedArtifactId))
        : artifactZero();
    const sourceActivatedArtifact =
      sourceActivatedArtifactId !== 0n
        ? this.loadArtifactOrZero(String(sourceActivatedArtifactId))
        : artifactZero();
    const targetActivatedArtifact =
      targetActivatedArtifactId !== 0n
        ? this.loadArtifactOrZero(String(targetActivatedArtifactId))
        : artifactZero();

    const [tier0, tier1, tier2, tier3] = config.planetTypeWeightsTiers;

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
        sourceActivatedArtifactId,
        sourceActivatedArtifact,
        targetActivatedArtifactId,
        targetActivatedArtifact
      );
    }

    // Move proof validation: when ZK checks are enabled, verify (x1,y1),(x2,y2) produce sourceLoc, targetLoc, targetPerlin
    const snark = config.snarkConfig as Record<string, unknown> | undefined;
    if (snark && !snark.disable_zk_checks) {
      const r = BigInt(String(world.radius ?? 0));
      const distMax = BigInt(String(maxDist));
      const coord = (v: unknown) =>
        typeof v === "number" ? v : Number(BigInt(String(v ?? 0)));
      const inputs = buildMoveProofInputs(
        {
          planethash_key: BigInt(String(snark.planethash_key ?? 0)),
          spacetype_key: BigInt(String(snark.spacetype_key ?? 0)),
          perlin_length_scale: BigInt(String(snark.perlin_length_scale ?? 0)),
          perlin_mirror_x: Boolean(snark.perlin_mirror_x),
          perlin_mirror_y: Boolean(snark.perlin_mirror_y),
        },
        r,
        distMax,
        coord(rawX1),
        coord(rawY1),
        coord(rawX2),
        coord(rawY2)
      );
      const outputs = await computeMoveProofOutputs(inputs);
      // Use Poseidon2-computed perlin so contract and validation agree (intent may have stale perlin).
      targetPerlin = Math.floor(outputs.perlin);

      // Recompute target level from Poseidon2 hash bytes (used by initialize_planet_with_defaults)
      targetLevelResolved = computePlanetLevelFromLocationId(
        outputs.targetHash,
        targetPerlin,
        config.gameConfigCore as Record<string, unknown>,
        config.planetLevelThresholds as Record<string, unknown>
      );
      console.log("[Move proof] simulation.perlin (client):", {
        perlinRaw: outputs.perlin,
        targetPerlinSent: targetPerlin,
        targetLevel: targetLevelResolved,
        coordsForPerlin: { x2: inputs.x2, y2: inputs.y2 },
        scale: inputs.scale.toString(),
        spaceTypeKey: inputs.spaceTypeKey.toString(),
        xMirror: inputs.xMirror,
        yMirror: inputs.yMirror,
      });
      const validation = validateMoveProofOutputs(
        sourceLoc,
        targetLoc,
        targetPerlin,
        outputs
      );
      if (!validation.valid) {
        console.debug("[Move proof] inputs:", {
          x1: inputs.x1,
          y1: inputs.y1,
          x2: inputs.x2,
          y2: inputs.y2,
          scale: inputs.scale.toString(),
          spaceTypeKey: inputs.spaceTypeKey.toString(),
          xMirror: inputs.xMirror,
          yMirror: inputs.yMirror,
        });
        console.debug("[Move proof] outputs (client):", {
          sourceHash: outputs.sourceHash.toString(),
          targetHash: outputs.targetHash.toString(),
          perlin: outputs.perlin,
          perlinFloored: Math.floor(outputs.perlin),
        });
        console.debug("[Move proof] expected (for contract):", {
          sourceLoc: sourceLoc.toString(),
          targetLoc: targetLoc.toString(),
          targetPerlin,
        });
        console.debug(
          "[Move proof] validation mismatches:",
          validation.mismatches
        );
        throw new Error(
          `Move proof validation failed: ${validation.mismatches.join("; ")}`
        );
      }
      console.debug("[Move proof] OK", {
        x2: inputs.x2,
        y2: inputs.y2,
        targetPerlin,
        perlinRaw: outputs.perlin,
      });
    }

    // For already-initialized planets (e.g. admin-created via create_planet),
    // use the stored level rather than the one derived from locationId bytes.
    if (targetPlanetRaw?.is_initialized) {
      targetLevelResolved = Number(targetPlanetRaw.planet_level);
    }

    const levelIndex = Math.min(9, Math.max(0, targetLevelResolved));
    const planetDefaultStats = config.planetDefaultStats[levelIndex];

    let timestamp = BigInt(
      Math.floor(intent.uiTimestamp ?? this.chainClock.nowSec())
    );
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

    // Log full move contract args so failures (e.g. perlin mismatch) can be debugged
    const snarkCfg = config.snarkConfig as Record<string, unknown> | undefined;
    const rawX1N =
      typeof rawX1 === "bigint"
        ? Number(rawX1)
        : Number(BigInt(String(rawX1 ?? 0)));
    const rawY1N =
      typeof rawY1 === "bigint"
        ? Number(rawY1)
        : Number(BigInt(String(rawY1 ?? 0)));
    const rawX2N =
      typeof rawX2 === "bigint"
        ? Number(rawX2)
        : Number(BigInt(String(rawX2 ?? 0)));
    const rawY2N =
      typeof rawY2 === "bigint"
        ? Number(rawY2)
        : Number(BigInt(String(rawY2 ?? 0)));
    console.log("[Move contract] args (full):", {
      sourceLoc: sourceLoc.toString(),
      targetLoc: targetLoc.toString(),
      targetPerlin,
      simulationPerlinNote:
        "targetPerlin above = client Poseidon2 perlin at (x2,y2); contract compares to circuit expected_perlin",
      rawCoords: { x1: rawX1N, y1: rawY1N, x2: rawX2N, y2: rawY2N },
      coordsAsField: {
        x1: x1.toString(),
        y1: y1.toString(),
        x2: x2.toString(),
        y2: y2.toString(),
      },
      targetLevel: targetLevelResolved,
      maxDist,
      popMoved: popMoved.toString(),
      silverMoved: silverMoved.toString(),
      movedArtifactId: movedArtifactId.toString(),
      sourceActivatedArtifactId: sourceActivatedArtifactId.toString(),
      targetActivatedArtifactId: targetActivatedArtifactId.toString(),
      isAbandoning,
      timestamp: timestamp.toString(),
      snarkConfig: snarkCfg
        ? {
            planethash_key: String(snarkCfg.planethash_key ?? ""),
            spacetype_key: String(snarkCfg.spacetype_key ?? ""),
            perlin_length_scale: String(snarkCfg.perlin_length_scale ?? ""),
            perlin_mirror_x: Boolean(snarkCfg.perlin_mirror_x),
            perlin_mirror_y: Boolean(snarkCfg.perlin_mirror_y),
            disable_zk_checks: Boolean(snarkCfg.disable_zk_checks),
          }
        : null,
    });

    return [
      sourceLoc,
      targetLoc,
      targetPerlin,
      targetLevelResolved,
      maxDist,
      x1,
      y1,
      x2,
      y2,
      popMoved,
      silverMoved,
      movedArtifactId,
      sourceActivatedArtifactId,
      targetActivatedArtifactId,
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
      config.artifactsConfig,
      sourcePlanet,
      sourcePlanetArtifacts,
      sourcePlanetEvents,
      sourceArrivalData.arrivals,
      sourceArrivalData.artifacts,
      sourceArrivalData.artifactLocations,
      targetPlanet,
      targetPlanetArtifacts,
      targetPlanetEvents,
      targetArrivalData.arrivals,
      targetArrivalData.artifacts,
      targetArrivalData.artifactLocations,
      world,
      movedArtifact,
      sourceActivatedArtifact,
      targetActivatedArtifact,
    ];
  }

  private async resolveUpgradePlanet(
    intent: UnconfirmedUpgrade
  ): Promise<unknown[]> {
    const intentArgs = await intent.args;
    const [locationIdDec, branchStr] = intentArgs;

    const location = BigInt(String(locationIdDec));
    const branch = Number(branchStr);
    if (!Number.isInteger(branch) || branch < 0 || branch >= 3) {
      throw new Error(
        `StateResolver.upgradePlanet: invalid branch "${String(branchStr)}"`
      );
    }

    const config = await this.configCache.getConfig();

    const planetRaw = this.indexer.getPlanet(String(locationIdDec));
    const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

    const planetEventsRaw = this.indexer.getPlanetEvents(String(locationIdDec));
    const planetEvents = planetEventsRaw
      ? planetEventsToContract(planetEventsRaw)
      : planetEventsZero();

    const planetArtifactsRaw = this.indexer.getPlanetArtifacts(
      String(locationIdDec)
    );
    const planetArtifacts = planetArtifactsRaw
      ? planetArtifactsToContract(planetArtifactsRaw)
      : planetArtifactsZero();

    const arrivalData = this.loadArrivalsForPlanetEvents(planetEventsRaw);

    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    let currentLevel = 0;
    if (branch === 0) currentLevel = planetRaw?.upgrade_state_0 ?? 0;
    else if (branch === 1) currentLevel = planetRaw?.upgrade_state_1 ?? 0;
    else currentLevel = planetRaw?.upgrade_state_2 ?? 0;
    const upgrade = config.upgrades[branch]?.[currentLevel];
    if (!upgrade) {
      throw new Error(
        `StateResolver.upgradePlanet: missing upgrade for branch=${branch} level=${currentLevel}`
      );
    }

    let timestamp = BigInt(
      Math.floor(intent.uiTimestamp ?? this.chainClock.nowSec())
    );
    {
      const entityTimes: bigint[] = [];
      if (planetRaw) entityTimes.push(planetRaw.last_updated);
      if (planetEventsRaw) entityTimes.push(planetEventsRaw.last_updated);
      if (planetArtifactsRaw) entityTimes.push(planetArtifactsRaw.last_updated);
      for (const arr of arrivalData.arrivals) {
        const dt = (arr as Record<string, unknown>).departure_time;
        if (dt != null && dt !== 0) entityTimes.push(BigInt(String(dt)));
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

    return [
      location,
      branch,
      timestamp,
      config.upgradeConfig,
      upgrade,
      planet,
      planetArtifacts,
      planetEvents,
      arrivalData.arrivals,
      arrivalData.artifacts,
      arrivalData.artifactLocations,
      world,
    ];
  }

  private async resolveWithdrawSilver(
    intent: UnconfirmedWithdrawSilver
  ): Promise<unknown[]> {
    const intentArgs = await intent.args;
    const [locationIdDec, amount] = intentArgs;

    const location = BigInt(String(locationIdDec));
    const silverToWithdraw = BigInt(String(amount));

    const config = await this.configCache.getConfig();

    const planetRaw = this.indexer.getPlanet(String(locationIdDec));
    const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

    const planetEventsRaw = this.indexer.getPlanetEvents(String(locationIdDec));
    const planetEvents = planetEventsRaw
      ? planetEventsToContract(planetEventsRaw)
      : planetEventsZero();

    const planetArtifactsRaw = this.indexer.getPlanetArtifacts(
      String(locationIdDec)
    );
    const planetArtifacts = planetArtifactsRaw
      ? planetArtifactsToContract(planetArtifactsRaw)
      : planetArtifactsZero();

    const arrivalData = this.loadArrivalsForPlanetEvents(planetEventsRaw);

    const playerAddr = this.getPlayerAddress();
    const playerRaw = this.indexer.getPlayer(playerAddr);
    const playerState = playerRaw ? playerToContract(playerRaw) : playerZero();

    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    let timestamp = BigInt(
      Math.floor(intent.uiTimestamp ?? this.chainClock.nowSec())
    );
    {
      const entityTimes: bigint[] = [];
      if (planetRaw) entityTimes.push(planetRaw.last_updated);
      if (planetEventsRaw) entityTimes.push(planetEventsRaw.last_updated);
      if (planetArtifactsRaw) entityTimes.push(planetArtifactsRaw.last_updated);
      if (playerRaw) entityTimes.push(playerRaw.last_updated);
      for (const arr of arrivalData.arrivals) {
        const dt = (arr as Record<string, unknown>).departure_time;
        if (dt != null && dt !== 0) entityTimes.push(BigInt(String(dt)));
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

    return [
      location,
      silverToWithdraw,
      timestamp,
      config.worldConfig,
      planet,
      planetEvents,
      arrivalData.arrivals,
      arrivalData.artifacts,
      arrivalData.artifactLocations,
      planetArtifacts,
      playerState,
      world,
    ];
  }

  private async resolveSetWorldConfig(
    intent: UnconfirmedSetWorldConfig
  ): Promise<unknown[]> {
    return intent.args instanceof Promise ? await intent.args : intent.args;
  }

  private async resolvePauseGame(
    _intent: UnconfirmedPauseGame
  ): Promise<unknown[]> {
    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();
    return [world];
  }

  private async resolveUnpauseGame(
    _intent: UnconfirmedUnpauseGame
  ): Promise<unknown[]> {
    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();
    return [world];
  }

  private async resolveAdminSetWorldRadius(
    intent: UnconfirmedAdminSetWorldRadius
  ): Promise<unknown[]> {
    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();
    return [BigInt(intent.newRadius), world];
  }

  // -------------------------------------------------------------------------
  // createPlanet — AdminCreatePlanetArgs: location, perlin, level, planet_type, require_valid_location_id
  // -------------------------------------------------------------------------
  private async resolveCreatePlanet(
    intent: UnconfirmedCreatePlanet
  ): Promise<unknown[]> {
    const args = await (intent.args instanceof Promise
      ? intent.args
      : Promise.resolve(intent.args));
    const [locationId, perlin, level, planetType, requireValidLocationId] =
      args as [bigint, number, number, number, boolean];
    return [
      {
        location: locationId,
        perlin: Number(perlin) & 0xff,
        level: Number(level) & 0xff,
        planet_type: Number(planetType) & 0xff,
        require_valid_location_id: Boolean(requireValidLocationId),
      },
    ];
  }

  // -------------------------------------------------------------------------
  // safeSetOwner — 19 args
  // [x, y, locationId, perlin, level, newOwner, timestamp,
  //  snarkConfig, planetDefaultStats, worldConfig, gameConfigCore,
  //  planetLevelThresholds, spaceJunkConfig, tier0, tier1, tier2, tier3,
  //  world, planetState]
  // -------------------------------------------------------------------------

  private async resolveSafeSetOwner(
    intent: UnconfirmedSafeSetOwner
  ): Promise<unknown[]> {
    const intentArgs = await intent.args;
    // intentArgs = [x, y, locationIdHex, perlin, level, newOwner]
    const [rawX, rawY, rawLocationId, rawPerlin, rawLevel, rawNewOwner] =
      intentArgs;
    const x = signedCoordToField(rawX as number | bigint);
    const y = signedCoordToField(rawY as number | bigint);
    let locationId = hexIdToField(rawLocationId);
    let perlin = Number(rawPerlin);
    let level = Number(rawLevel);
    const newOwner = AztecAddress.fromString(String(rawNewOwner));

    const config = await this.configCache.getConfig();

    const snark = config.snarkConfig as Record<string, unknown> | undefined;
    if (snark && !snark.disable_zk_checks) {
      const coord = (v: unknown) =>
        typeof v === "number" ? v : Number(BigInt(String(v ?? 0)));
      const inputs = buildLocationProofInputs(
        {
          planethash_key: BigInt(String(snark.planethash_key ?? 0)),
          spacetype_key: BigInt(String(snark.spacetype_key ?? 0)),
          perlin_length_scale: BigInt(String(snark.perlin_length_scale ?? 0)),
          perlin_mirror_x: Boolean(snark.perlin_mirror_x),
          perlin_mirror_y: Boolean(snark.perlin_mirror_y),
        },
        coord(rawX),
        coord(rawY)
      );
      const outputs = await computeLocationProofOutputs(inputs);
      locationId = outputs.locationHash;
      perlin = Math.floor(outputs.perlin);
      level = computePlanetLevelFromLocationId(
        locationId,
        perlin,
        config.gameConfigCore as Record<string, unknown>,
        config.planetLevelThresholds as Record<string, unknown>
      );
      console.debug("[SafeSetOwner proof] computed (Poseidon2):", {
        x: inputs.x,
        y: inputs.y,
        locationHash: outputs.locationHash.toString(),
        perlin,
        level,
      });
    }

    const locationIdDec = locationIdToDecStr(
      String(rawLocationId) as import("@dfpunk/types").LocationId
    );

    const planetRaw = this.indexer.getPlanet(locationIdDec);
    const planetState = planetRaw ? planetToContract(planetRaw) : planetZero();

    const worldRaw = this.indexer.getWorld();
    const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

    let timestamp = BigInt(
      Math.floor(intent.uiTimestamp ?? this.chainClock.nowSec())
    );
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
    const levelIndex = Math.min(9, Math.max(0, level));
    const planetDefaultStats = config.planetDefaultStats[levelIndex];

    return [
      x,
      y,
      locationId,
      perlin,
      level,
      newOwner,
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
      world,
      planetState,
    ];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Load arrivals, artifacts, and artifact locations for a planet's events.
   * Returns arrays of length 20, padded with zeros for unused slots.
   * Matches contracts/scripts/test/test-move.ts loadArrivalsForPlanetEvents().
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

  /**
   * Find the activated artifact on a planet by scanning planet_artifacts ids.
   * Returns its bigint id, or 0n if none is activated.
   * Mirrors contract logic: is_activated = last_activated > last_deactivated.
   */
  private findActivatedArtifactId(
    planetArtifacts:
      | import("../Indexer/TableTypes/chain").PlanetArtifactsState
      | undefined
  ): bigint {
    if (!planetArtifacts) return 0n;
    const count = planetArtifacts.count;
    for (let i = 0; i < count; i++) {
      const id = planetArtifacts.ids[i];
      if (!id || id === "0") continue;
      const art = this.indexer.getArtifact(id);
      if (art && art.last_activated > art.last_deactivated) {
        return BigInt(id);
      }
    }
    return 0n;
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
    sourceActivatedArtifactId: bigint,
    sourceActivatedArtifact: Record<string, unknown>,
    targetActivatedArtifactId: bigint,
    targetActivatedArtifact: Record<string, unknown>
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
      loadOnChainHash: () => Promise<unknown>
    ) => {
      const localHash = await localHashPromise;
      const rawOnChain = await loadOnChainHash();
      const onChainHash = unwrapSimulateResult(rawOnChain);
      const localBigInt = localHash.toBigInt();
      const onChainBigInt = BigInt(String(onChainHash));
      if (localBigInt !== onChainBigInt) {
        mismatches.push(
          `${label}: local=${localBigInt} onchain=${onChainBigInt}`
        );
      }
    };

    // Source entity hashes
    await check("source planet", computePlanetHash(sourcePlanet), () =>
      ps.methods.get_state_root_unconstrained(sourceLoc).simulate({ from })
    );
    await check(
      "source planet_events",
      computePlanetEventsHash(sourcePlanetEvents),
      () =>
        pes.methods.get_state_root_unconstrained(sourceLoc).simulate({ from })
    );
    await check(
      "source planet_artifacts",
      computePlanetArtifactsHash(sourcePlanetArtifacts),
      () =>
        pas.methods.get_state_root_unconstrained(sourceLoc).simulate({ from })
    );

    // Source arrivals batch
    for (let i = 0; i < 20; i++) {
      const arrival = sourceArrivalData.arrivals[i];
      const arrId = BigInt(Number(arrival["id"] ?? 0));
      if (arrId === 0n) continue;
      await check(`source arrival[${i}]`, computeArrivalHash(arrival), () =>
        arrs.methods.get_state_root_unconstrained(arrId).simulate({ from })
      );
      const art = sourceArrivalData.artifacts[i];
      const artCarried = BigInt(String(arrival["carried_artifact_id"] ?? 0));
      if (artCarried !== 0n) {
        await check(`source artifact[${i}]`, computeArtifactHash(art), () =>
          arts.methods
            .get_state_root_unconstrained(artCarried)
            .simulate({ from })
        );
        await check(
          `source artifact_location[${i}]`,
          computeArtifactLocationHash(sourceArrivalData.artifactLocations[i]),
          () =>
            als.methods
              .get_state_root_unconstrained(artCarried)
              .simulate({ from })
        );
      }
    }

    // Target entity hashes
    await check("target planet", computePlanetHash(targetPlanet), () =>
      ps.methods.get_state_root_unconstrained(targetLoc).simulate({ from })
    );
    await check(
      "target planet_events",
      computePlanetEventsHash(targetPlanetEvents),
      () =>
        pes.methods.get_state_root_unconstrained(targetLoc).simulate({ from })
    );
    await check(
      "target planet_artifacts",
      computePlanetArtifactsHash(targetPlanetArtifacts),
      () =>
        pas.methods.get_state_root_unconstrained(targetLoc).simulate({ from })
    );

    // Target arrivals batch
    for (let i = 0; i < 20; i++) {
      const arrival = targetArrivalData.arrivals[i];
      const arrId = BigInt(Number(arrival["id"] ?? 0));
      if (arrId === 0n) continue;
      await check(`target arrival[${i}]`, computeArrivalHash(arrival), () =>
        arrs.methods.get_state_root_unconstrained(arrId).simulate({ from })
      );
      const art = targetArrivalData.artifacts[i];
      const artCarried = BigInt(String(arrival["carried_artifact_id"] ?? 0));
      if (artCarried !== 0n) {
        await check(`target artifact[${i}]`, computeArtifactHash(art), () =>
          arts.methods
            .get_state_root_unconstrained(artCarried)
            .simulate({ from })
        );
        await check(
          `target artifact_location[${i}]`,
          computeArtifactLocationHash(targetArrivalData.artifactLocations[i]),
          () =>
            als.methods
              .get_state_root_unconstrained(artCarried)
              .simulate({ from })
        );
      }
    }

    // World hash
    await check("world", computeWorldHash(world), () =>
      ws.methods.get_state_root_unconstrained(0).simulate({ from })
    );

    // Moved artifact
    if (movedArtifactId !== 0n) {
      await check("moved artifact", computeArtifactHash(movedArtifact), () =>
        arts.methods
          .get_state_root_unconstrained(movedArtifactId)
          .simulate({ from })
      );
    }

    // Source activated artifact
    if (sourceActivatedArtifactId !== 0n) {
      await check(
        "source activated artifact",
        computeArtifactHash(sourceActivatedArtifact),
        () =>
          arts.methods
            .get_state_root_unconstrained(sourceActivatedArtifactId)
            .simulate({ from })
      );
    }

    // Target activated artifact
    if (targetActivatedArtifactId !== 0n) {
      await check(
        "target activated artifact",
        computeArtifactHash(targetActivatedArtifact),
        () =>
          arts.methods
            .get_state_root_unconstrained(targetActivatedArtifactId)
            .simulate({ from })
      );
    }

    if (mismatches.length > 0) {
      const msg = `[StateResolver] Hash preflight failed — indexer state is stale:\n${mismatches.join("\n")}`;
      console.error(msg);
      throw new Error(msg);
    }
  }

  /**
   * Hash preflight for revealLocation: planet, planetRevealedCoords, player, and world.
   */
  private async verifyRevealStateHashes(
    locationId: bigint,
    planetState: Record<string, unknown>,
    planetRevealedCoords: Record<string, unknown>,
    playerState: Record<string, unknown>,
    world: Record<string, unknown>
  ): Promise<void> {
    const from = AztecAddress.fromString(this.getPlayerAddress());
    const mismatches: string[] = [];

    const check = async (
      label: string,
      localHashPromise: Promise<import("@aztec/aztec.js/fields").Fr>,
      loadOnChainHash: () => Promise<unknown>
    ) => {
      const localHash = await localHashPromise;
      const rawOnChain = await loadOnChainHash();
      const onChainHash = unwrapSimulateResult(rawOnChain);
      const localBigInt = localHash.toBigInt();
      const onChainBigInt = BigInt(String(onChainHash));
      if (localBigInt !== onChainBigInt) {
        mismatches.push(
          `${label}: local=${localBigInt} onchain=${onChainBigInt}`
        );
      }
    };

    await check("planet", computePlanetHash(planetState), () =>
      this.planetStorage.methods
        .get_state_root_unconstrained(locationId)
        .simulate({ from })
    );
    await check(
      "planetRevealedCoords",
      computePlanetRevealedCoordsHash(planetRevealedCoords),
      () =>
        this.planetRevealedCoordsStorage.methods
          .get_state_root_unconstrained(locationId)
          .simulate({ from })
    );
    await check("player", computePlayerHash(playerState), () =>
      this.playerStorage.methods
        .get_state_root_unconstrained(from)
        .simulate({ from })
    );
    await check("world", computeWorldHash(world), () =>
      this.worldStorage.methods
        .get_state_root_unconstrained(0)
        .simulate({ from })
    );

    if (mismatches.length > 0) {
      const msg = `[StateResolver] Reveal hash preflight failed — indexer state is stale:\n${mismatches.join("\n")}`;
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
      loadOnChainHash: () => Promise<unknown>
    ) => {
      const localHash = await localHashPromise;
      const rawOnChain = await loadOnChainHash();
      const onChainHash = unwrapSimulateResult(rawOnChain);
      const localBigInt = localHash.toBigInt();
      const onChainBigInt = BigInt(String(onChainHash));
      if (localBigInt !== onChainBigInt) {
        mismatches.push(
          `${label}: local=${localBigInt} onchain=${onChainBigInt}`
        );
      }
    };

    await check("planet", computePlanetHash(planetState), () =>
      this.planetStorage.methods
        .get_state_root_unconstrained(locationId)
        .simulate({ from })
    );
    await check("player", computePlayerHash(playerState), () =>
      this.playerStorage.methods
        .get_state_root_unconstrained(from)
        .simulate({ from })
    );
    await check("world", computeWorldHash(world), () =>
      this.worldStorage.methods
        .get_state_root_unconstrained(0)
        .simulate({ from })
    );

    if (mismatches.length > 0) {
      const msg = `[StateResolver] Init hash preflight failed — indexer state is stale:\n${mismatches.join("\n")}`;
      console.error(msg);
      throw new Error(msg);
    }
  }
}
