/**
 * ContractsAPITypes: Aztec-adapted types for ContractsAPI.
 *
 * Mirrors darkforest-v0.6/client/src/_types/darkforest/api/ContractsAPITypes.ts
 * with Ethereum-specific fields replaced by Aztec equivalents.
 */

import type {
  ArtifactPointValues,
  AztecAddr,
  UpgradeBranches,
} from "@dfpunk/types";

import type { IndexerConnection } from "../Session/Indexer/IndexerConnection";
import type { ConfigCache } from "../Session/TxExecutor/ConfigCache";
import type { TxExecutor } from "../Session/TxExecutor/TxExecutor";
import type { WalletManager } from "../Session/WalletManager/WalletManager";

// ---------------------------------------------------------------------------
// ContractsApiConfig
// ---------------------------------------------------------------------------

export interface ContractsApiConfig {
  indexerConnection: IndexerConnection;
  txExecutor: TxExecutor;
  walletManager: WalletManager;
  configCache: ConfigCache;
}

// ---------------------------------------------------------------------------
// ContractsAPIEvent — same values as v0.6
// ---------------------------------------------------------------------------

export const enum ContractsAPIEvent {
  PlayerUpdate = "PlayerUpdate",
  PlanetUpdate = "PlanetUpdate",
  PauseStateChanged = "PauseStateChanged",
  ArrivalQueued = "ArrivalQueued",
  ArtifactUpdate = "ArtifactUpdate",
  RadiusUpdated = "RadiusUpdated",
  LocationRevealed = "LocationRevealed",
  TxQueued = "TxQueued",
  TxProcessing = "TxProcessing",
  TxPrioritized = "TxPrioritized",
  TxSubmitted = "TxSubmitted",
  TxConfirmed = "TxConfirmed",
  TxErrored = "TxErrored",
  TxCancelled = "TxCancelled",
  PlanetTransferred = "PlanetTransferred",
  PlanetClaimed = "PlanetClaimed",
  LobbyCreated = "LobbyCreated",
}

// ---------------------------------------------------------------------------
// PlanetTypeWeights (same as v0.6)
// ---------------------------------------------------------------------------

export type PlanetTypeWeights = [number, number, number, number, number];

export type PlanetTypeWeightsByLevel = [
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
];

export type PlanetTypeWeightsBySpaceType = [
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsByLevel,
];

// ---------------------------------------------------------------------------
// Ten-element tuple (reused for level-indexed arrays)
// ---------------------------------------------------------------------------

type TenNumbers = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// ---------------------------------------------------------------------------
// ContractConstants — adapted from v0.6, EthAddress → AztecAddr
// ---------------------------------------------------------------------------

export interface ContractConstants {
  ADMIN_CAN_ADD_PLANETS: boolean;
  WORLD_RADIUS_LOCKED: boolean;
  WORLD_RADIUS_MIN: number;

  DISABLE_ZK_CHECKS: boolean;

  PLANETHASH_KEY: number;
  SPACETYPE_KEY: number;
  BIOMEBASE_KEY: number;
  PERLIN_LENGTH_SCALE: number;
  PERLIN_MIRROR_X: boolean;
  PERLIN_MIRROR_Y: boolean;

  TOKEN_MINT_END_SECONDS: number;

  MAX_NATURAL_PLANET_LEVEL: number;
  TIME_FACTOR_HUNDREDTHS: number;
  PERLIN_THRESHOLD_1: number;
  PERLIN_THRESHOLD_2: number;
  PERLIN_THRESHOLD_3: number;
  INIT_PERLIN_MIN: number;
  INIT_PERLIN_MAX: number;
  SPAWN_RIM_AREA: number;
  BIOME_THRESHOLD_1: number;
  BIOME_THRESHOLD_2: number;
  PLANET_RARITY: number;
  PLANET_LEVEL_THRESHOLDS: TenNumbers;
  PLANET_TRANSFER_ENABLED: boolean;
  PLANET_TYPE_WEIGHTS: PlanetTypeWeightsBySpaceType;
  ARTIFACT_POINT_VALUES: ArtifactPointValues;
  SILVER_SCORE_VALUE: number;

  SPACE_JUNK_ENABLED: boolean;
  SPACE_JUNK_LIMIT: number;
  PLANET_LEVEL_JUNK: TenNumbers;
  ABANDON_SPEED_CHANGE_PERCENT: number;
  ABANDON_RANGE_CHANGE_PERCENT: number;

  PHOTOID_ACTIVATION_DELAY: number;
  LOCATION_REVEAL_COOLDOWN: number;

  defaultPopulationCap: number[];
  defaultPopulationGrowth: number[];
  defaultSilverCap: number[];
  defaultSilverGrowth: number[];
  defaultRange: number[];
  defaultSpeed: number[];
  defaultDefense: number[];
  defaultBarbarianPercentage: number[];

  planetCumulativeRarities: number[];

  upgrades: UpgradeBranches;

  adminAddress: AztecAddr;

  GAME_START_BLOCK: number;
  CAPTURE_ZONES_ENABLED: boolean;
  CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL: number;
  CAPTURE_ZONE_RADIUS: number;
  CAPTURE_ZONE_PLANET_LEVEL_SCORE: TenNumbers;
  CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED: number;
  CAPTURE_ZONES_PER_5000_WORLD_RADIUS: number;
  SPACESHIPS: {
    GEAR: boolean;
    MOTHERSHIP: boolean;
    TITAN: boolean;
    CRESCENT: boolean;
    WHALE: boolean;
  };
}

// ---------------------------------------------------------------------------
// PlanetEventType (same as v0.6)
// ---------------------------------------------------------------------------

export const enum PlanetEventType {
  ARRIVAL,
}
