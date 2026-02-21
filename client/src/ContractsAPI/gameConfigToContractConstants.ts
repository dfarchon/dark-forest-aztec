/**
 * Transforms raw GameConfig (from ConfigCache / Aztec contract simulate calls)
 * into ContractConstants shape expected by GameManager and the rest of the client.
 *
 * The raw objects returned by contract.methods.get_*().simulate() are Noir structs
 * serialized as plain JS objects with snake_case keys. The exact field names match
 * the Noir contract definitions. This function best-effort maps them; if a field
 * is missing from a particular deployment the value defaults to 0/false.
 */

import type { AztecAddr } from "@dfpunk/types";
import type { Upgrade, UpgradeBranches } from "@dfpunk/types";

import type { GameConfig, RawUpgrade } from "../Session/TxExecutor/ConfigCache";
import type {
  ContractConstants,
  PlanetTypeWeights,
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsBySpaceType,
} from "./ContractsAPITypes";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  if (v === undefined || v === null) return 0;
  return Number(v);
}

function bool(v: unknown): boolean {
  return !!v;
}

function tenNumbers(
  arr: unknown
): [
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
] {
  if (!Array.isArray(arr)) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return [
    num(arr[0]),
    num(arr[1]),
    num(arr[2]),
    num(arr[3]),
    num(arr[4]),
    num(arr[5]),
    num(arr[6]),
    num(arr[7]),
    num(arr[8]),
    num(arr[9]),
  ];
}

// ---------------------------------------------------------------------------
// Upgrades conversion
// ---------------------------------------------------------------------------

const BRANCH_COUNT = 3;
const LEVELS_PER_BRANCH = 4;

/** Default upgrade: all multipliers 100 (no change). Matches Noir Upgrade::zero(). */
const DEFAULT_UPGRADE: Upgrade = {
  energyCapMultiplier: 100,
  energyGroMultiplier: 100,
  rangeMultiplier: 100,
  speedMultiplier: 100,
  defMultiplier: 100,
};

function rawUpgradeToUpgrade(raw: RawUpgrade | undefined): Upgrade {
  if (!raw) return DEFAULT_UPGRADE;
  const n = (v: unknown) => (v === undefined || v === null ? 100 : Number(v));
  return {
    energyCapMultiplier: n(raw.pop_cap_multiplier),
    energyGroMultiplier: n(raw.pop_gro_multiplier),
    rangeMultiplier: n(raw.range_multiplier),
    speedMultiplier: n(raw.speed_multiplier),
    defMultiplier: n(raw.def_multiplier),
  };
}

function buildUpgrades(raw: RawUpgrade[][] | undefined): UpgradeBranches {
  const defaultBranch: Upgrade[] = Array(LEVELS_PER_BRANCH).fill(
    DEFAULT_UPGRADE
  ) as Upgrade[];

  if (!raw || !Array.isArray(raw) || raw.length < BRANCH_COUNT) {
    return [defaultBranch, defaultBranch, defaultBranch] as UpgradeBranches;
  }

  return raw.slice(0, BRANCH_COUNT).map((branch) => {
    if (!Array.isArray(branch) || branch.length < LEVELS_PER_BRANCH) {
      return defaultBranch;
    }
    return branch
      .slice(0, LEVELS_PER_BRANCH)
      .map((r) => rawUpgradeToUpgrade(r)) as Upgrade[];
  }) as UpgradeBranches;
}

// ---------------------------------------------------------------------------
// Planet type weights conversion
// ---------------------------------------------------------------------------

type RawPlanetTypeWeightsTier = {
  weights?: (bigint | number)[][];
};

const EMPTY_WEIGHTS_ROW: PlanetTypeWeights = [0, 0, 0, 0, 0];
const EMPTY_TIER: PlanetTypeWeightsByLevel = Array(10).fill(
  EMPTY_WEIGHTS_ROW
) as PlanetTypeWeightsByLevel;

function rawToPlanetTypeWeights(
  row: (bigint | number)[] | undefined
): PlanetTypeWeights {
  return [
    num(row?.[0]),
    num(row?.[1]),
    num(row?.[2]),
    num(row?.[3]),
    num(row?.[4]),
  ];
}

function rawTierToPlanetTypeWeightsByLevel(
  raw: unknown
): PlanetTypeWeightsByLevel {
  const r = raw as RawPlanetTypeWeightsTier | undefined;
  const rows = r?.weights;
  if (!Array.isArray(rows) || rows.length < 10) return EMPTY_TIER;
  return rows
    .slice(0, 10)
    .map((row) => rawToPlanetTypeWeights(row)) as PlanetTypeWeightsByLevel;
}

function buildPlanetTypeWeights(
  tiers: readonly [unknown, unknown, unknown, unknown]
): PlanetTypeWeightsBySpaceType {
  return [
    rawTierToPlanetTypeWeightsByLevel(tiers[0]),
    rawTierToPlanetTypeWeightsByLevel(tiers[1]),
    rawTierToPlanetTypeWeightsByLevel(tiers[2]),
    rawTierToPlanetTypeWeightsByLevel(tiers[3]),
  ];
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

export function gameConfigToContractConstants(
  config: GameConfig
): ContractConstants {
  const snark = (config.snarkConfig as Record<string, unknown>) ?? {};
  const core = (config.gameConfigCore as Record<string, unknown>) ?? {};
  const world = (config.worldConfig as Record<string, unknown>) ?? {};
  const junk = (config.spaceJunkConfig as Record<string, unknown>) ?? {};
  const thresholds = config.planetLevelThresholds;
  const tiers = config.planetTypeWeightsTiers;

  const planetDefaults = config.planetDefaultStats.map(
    (s) => (s ?? {}) as Record<string, unknown>
  );

  const extract = (arr: Record<string, unknown>[], key: string): number[] =>
    arr.map((s) => num(s[key]));

  return {
    ADMIN_CAN_ADD_PLANETS: bool(core.admin_can_add_planets),
    WORLD_RADIUS_LOCKED: bool(world.world_radius_locked),
    WORLD_RADIUS_MIN: num(world.world_radius_min),

    DISABLE_ZK_CHECKS: bool(snark.disable_zk_checks),

    PLANETHASH_KEY: num(snark.planethash_key),
    SPACETYPE_KEY: num(snark.spacetype_key),
    BIOMEBASE_KEY: num(snark.biomebase_key),
    PERLIN_LENGTH_SCALE: num(snark.perlin_length_scale),
    PERLIN_MIRROR_X: bool(snark.perlin_mirror_x),
    PERLIN_MIRROR_Y: bool(snark.perlin_mirror_y),

    TOKEN_MINT_END_SECONDS: num(core.token_mint_end_seconds),

    MAX_NATURAL_PLANET_LEVEL: num(core.max_natural_planet_level),
    TIME_FACTOR_HUNDREDTHS: num(core.time_factor_hundredths),
    PERLIN_THRESHOLD_1: num(core.perlin_threshold_1),
    PERLIN_THRESHOLD_2: num(core.perlin_threshold_2),
    PERLIN_THRESHOLD_3: num(core.perlin_threshold_3),
    INIT_PERLIN_MIN: num(core.init_perlin_min),
    INIT_PERLIN_MAX: num(core.init_perlin_max),
    SPAWN_RIM_AREA: num(core.spawn_rim_area),
    BIOME_THRESHOLD_1: num(core.biome_threshold_1),
    BIOME_THRESHOLD_2: num(core.biome_threshold_2),
    PLANET_RARITY: num(core.planet_rarity),
    PLANET_LEVEL_THRESHOLDS: tenNumbers(thresholds),
    PLANET_TRANSFER_ENABLED: bool(core.planet_transfer_enabled),
    PLANET_TYPE_WEIGHTS: buildPlanetTypeWeights(tiers),
    ARTIFACT_POINT_VALUES: (core.artifact_point_values ?? {}) as any,
    SILVER_SCORE_VALUE: num(core.silver_score_value),

    SPACE_JUNK_ENABLED: bool(junk.space_junk_enabled),
    SPACE_JUNK_LIMIT: num(junk.space_junk_limit),
    PLANET_LEVEL_JUNK: tenNumbers(junk.planet_level_junk),
    ABANDON_SPEED_CHANGE_PERCENT: num(junk.abandon_speed_change_percent),
    ABANDON_RANGE_CHANGE_PERCENT: num(junk.abandon_range_change_percent),

    PHOTOID_ACTIVATION_DELAY: num(core.photoid_activation_delay),
    LOCATION_REVEAL_COOLDOWN: num(core.location_reveal_cooldown),

    defaultPopulationCap: extract(planetDefaults, "population_cap"),
    defaultPopulationGrowth: extract(planetDefaults, "population_growth"),
    defaultSilverCap: extract(planetDefaults, "silver_cap"),
    defaultSilverGrowth: extract(planetDefaults, "silver_growth"),
    defaultRange: extract(planetDefaults, "range"),
    defaultSpeed: extract(planetDefaults, "speed"),
    defaultDefense: extract(planetDefaults, "defense"),
    defaultBarbarianPercentage: extract(planetDefaults, "barbarian_percentage"),

    planetCumulativeRarities: config.planetCumulativeRarities ?? [],
    upgrades: buildUpgrades(config.upgrades),

    adminAddress: (config.admin ?? "") as AztecAddr,

    GAME_START_BLOCK: num(core.game_start_block),
    CAPTURE_ZONES_ENABLED: bool(core.capture_zones_enabled),
    CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL: num(
      core.capture_zone_change_block_interval
    ),
    CAPTURE_ZONE_RADIUS: num(core.capture_zone_radius),
    CAPTURE_ZONE_PLANET_LEVEL_SCORE: tenNumbers(
      core.capture_zone_planet_level_score
    ),
    CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED: num(
      core.capture_zone_hold_blocks_required
    ),
    CAPTURE_ZONES_PER_5000_WORLD_RADIUS: num(
      core.capture_zones_per_5000_world_radius
    ),
    SPACESHIPS: {
      GEAR: bool((core.spaceships as any)?.gear),
      MOTHERSHIP: bool((core.spaceships as any)?.mothership),
      TITAN: bool((core.spaceships as any)?.titan),
      CRESCENT: bool((core.spaceships as any)?.crescent),
      WHALE: bool((core.spaceships as any)?.whale),
    },
  };
}
