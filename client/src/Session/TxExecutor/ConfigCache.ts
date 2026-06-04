/**
 * ConfigCache: lazy-loads and caches game config from the Config contract.
 * Config objects are immutable during a game session (set by admin during configure).
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractBase } from "@aztec/aztec.js/contracts";
import { unwrapSimulateResult } from "@dfpunk/utils";

/** Raw Upgrade from contract (snake_case). */
export type RawUpgrade = {
  pop_cap_multiplier?: number | bigint;
  pop_gro_multiplier?: number | bigint;
  range_multiplier?: number | bigint;
  speed_multiplier?: number | bigint;
  def_multiplier?: number | bigint;
};

export interface GameConfig {
  admin: string;
  snarkConfig: unknown;
  planetDefaultStats: unknown[];
  worldConfig: unknown;
  gameConfigCore: unknown;
  upgradeConfig: unknown;
  planetLevelThresholds: unknown;
  spaceJunkConfig: unknown;
  planetTypeWeightsTiers: [unknown, unknown, unknown, unknown];
  /** [branch][level] — 3 branches × 4 levels, from get_upgrade_by_branch_level */
  upgrades: RawUpgrade[][];
  artifactsConfig: unknown;
  spaceshipsConfig: unknown;
  captureZonesConfig: unknown;
  /** Cumulative rarities for levels 0-9, from get_cumulative_rarity */
  planetCumulativeRarities: number[];
}

/** Raw FullConfig struct returned by get_full_config_unconstrained (snake_case). */
type RawFullConfig = {
  admin?: unknown;
  snark_config: unknown;
  world_config: unknown;
  game_config_core: unknown;
  upgrade_config: unknown;
  planet_level_thresholds: unknown;
  space_junk_config: unknown;
  planet_type_weights_tier_0: unknown;
  planet_type_weights_tier_1: unknown;
  planet_type_weights_tier_2: unknown;
  planet_type_weights_tier_3: unknown;
  artifacts_config: unknown;
  spaceships_config: unknown;
  capture_zones_config: unknown;
  default_stats: unknown[];
  upgrades: RawUpgrade[][];
  cumulative_rarities: Array<number | bigint>;
};

const FULL_CONFIG_FIELDS = [
  "admin",
  "snark_config",
  "world_config",
  "game_config_core",
  "upgrade_config",
  "planet_level_thresholds",
  "space_junk_config",
  "planet_type_weights_tier_0",
  "planet_type_weights_tier_1",
  "planet_type_weights_tier_2",
  "planet_type_weights_tier_3",
  "artifacts_config",
  "spaceships_config",
  "capture_zones_config",
  "default_stats",
  "upgrades",
  "cumulative_rarities",
] as const;

const SNARK_CONFIG_FIELDS = [
  "disable_zk_checks",
  "planethash_key",
  "spacetype_key",
  "biomebase_key",
  "perlin_mirror_x",
  "perlin_mirror_y",
  "perlin_length_scale",
] as const;

const WORLD_CONFIG_FIELDS = [
  "start_paused",
  "time_factor_hundredths",
  "spawn_rim_area",
  "world_radius_locked",
  "world_radius_min",
  "location_reveal_cooldown",
  "silver_score_value",
  "planet_transfer_enabled",
  "admin_can_add_planets",
] as const;

const GAME_CONFIG_CORE_FIELDS = [
  "max_natural_planet_level",
  "perlin_threshold_1",
  "perlin_threshold_2",
  "perlin_threshold_3",
  "init_perlin_min",
  "init_perlin_max",
  "biome_threshold_1",
  "biome_threshold_2",
  "planet_rarity",
  "max_location_id",
] as const;

const UPGRADE_CONFIG_FIELDS = [
  "silver_cost_percent",
  "max_total_level_nebula",
  "max_total_level_space",
  "max_total_level_deep_space",
  "max_total_level_dead_space",
  "max_branch_level",
] as const;

const SPACE_JUNK_CONFIG_FIELDS = [
  "space_junk_enabled",
  "space_junk_limit",
  "planet_level_junk",
  "abandon_speed_change_percent",
  "abandon_range_change_percent",
] as const;

const ARTIFACTS_CONFIG_FIELDS = [
  "token_mint_end_timestamp",
  "artifact_point_values",
  "photoid_activation_delay",
] as const;

const SPACESHIPS_CONFIG_FIELDS = [
  "gear",
  "mothership",
  "titan",
  "crescent",
  "whale",
] as const;

const CAPTURE_ZONES_CONFIG_FIELDS = [
  "capture_zones_enabled",
  "capture_zone_change_block_interval",
  "capture_zone_radius",
  "capture_zone_planet_level_score",
  "capture_zone_hold_blocks_required",
  "capture_zones_per_5000_world_radius",
] as const;

const PLANET_DEFAULT_STATS_FIELDS = [
  "population_cap",
  "population_growth",
  "range",
  "speed",
  "defense",
  "silver_growth",
  "silver_cap",
  "barbarian_percentage",
] as const;

const UPGRADE_FIELDS = [
  "pop_cap_multiplier",
  "pop_gro_multiplier",
  "range_multiplier",
  "speed_multiplier",
  "def_multiplier",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numericRecordToArray(
  value: Record<string, unknown>
): unknown[] | null {
  const numericKeys = Object.keys(value)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);
  if (numericKeys.length === 0) return null;
  return numericKeys.map((key) => value[String(key)]);
}

function objectFromTuple<T extends readonly string[]>(
  value: unknown,
  fields: T
): Record<T[number], unknown> {
  if (isRecord(value)) {
    if (fields.some((field) => field in value)) {
      return value as Record<T[number], unknown>;
    }
    const tuple = numericRecordToArray(value);
    if (tuple) {
      return Object.fromEntries(
        fields.map((field, index) => [field, tuple[index]])
      ) as Record<T[number], unknown>;
    }
    return value as Record<T[number], unknown>;
  }
  if (!Array.isArray(value)) return {} as Record<T[number], unknown>;

  return Object.fromEntries(
    fields.map((field, index) => [field, value[index]])
  ) as Record<T[number], unknown>;
}

function singleArrayField<T extends string>(
  value: unknown,
  field: T
): Record<T, unknown> {
  if (isRecord(value)) {
    if (field in value) return value as Record<T, unknown>;
    const tuple = numericRecordToArray(value);
    if (tuple) {
      return { [field]: tuple.length === 1 ? tuple[0] : tuple } as Record<
        T,
        unknown
      >;
    }
    return value as Record<T, unknown>;
  }
  if (!Array.isArray(value)) return { [field]: value } as Record<T, unknown>;
  if (value.length === 1 && Array.isArray(value[0])) {
    return { [field]: value[0] } as Record<T, unknown>;
  }
  return { [field]: value } as Record<T, unknown>;
}

function normalizeFullConfig(raw: unknown): RawFullConfig {
  const full = objectFromTuple(raw, FULL_CONFIG_FIELDS);
  const defaultStats = Array.isArray(full.default_stats)
    ? full.default_stats.map((stats) =>
        objectFromTuple(stats, PLANET_DEFAULT_STATS_FIELDS)
      )
    : [];
  const upgrades = Array.isArray(full.upgrades)
    ? full.upgrades.map((branch) =>
        Array.isArray(branch)
          ? branch.map((upgrade) => objectFromTuple(upgrade, UPGRADE_FIELDS))
          : []
      )
    : [];

  return {
    ...full,
    snark_config: objectFromTuple(full.snark_config, SNARK_CONFIG_FIELDS),
    world_config: objectFromTuple(full.world_config, WORLD_CONFIG_FIELDS),
    game_config_core: objectFromTuple(
      full.game_config_core,
      GAME_CONFIG_CORE_FIELDS
    ),
    upgrade_config: objectFromTuple(full.upgrade_config, UPGRADE_CONFIG_FIELDS),
    planet_level_thresholds: singleArrayField(
      full.planet_level_thresholds,
      "thresholds"
    ),
    space_junk_config: objectFromTuple(
      full.space_junk_config,
      SPACE_JUNK_CONFIG_FIELDS
    ),
    planet_type_weights_tier_0: singleArrayField(
      full.planet_type_weights_tier_0,
      "weights"
    ),
    planet_type_weights_tier_1: singleArrayField(
      full.planet_type_weights_tier_1,
      "weights"
    ),
    planet_type_weights_tier_2: singleArrayField(
      full.planet_type_weights_tier_2,
      "weights"
    ),
    planet_type_weights_tier_3: singleArrayField(
      full.planet_type_weights_tier_3,
      "weights"
    ),
    artifacts_config: objectFromTuple(
      full.artifacts_config,
      ARTIFACTS_CONFIG_FIELDS
    ),
    spaceships_config: objectFromTuple(
      full.spaceships_config,
      SPACESHIPS_CONFIG_FIELDS
    ),
    capture_zones_config: objectFromTuple(
      full.capture_zones_config,
      CAPTURE_ZONES_CONFIG_FIELDS
    ),
    default_stats: defaultStats,
    upgrades,
    cumulative_rarities: Array.isArray(full.cumulative_rarities)
      ? full.cumulative_rarities
      : [],
  } as RawFullConfig;
}

/** Progress callback fired before each serial config simulate. */
export type ConfigLoadProgress = (
  detail: string,
  current?: number,
  total?: number
) => void;

export interface ConfigCacheOptions {
  /** Called before each serial simulate() so the UI can show what's loading. */
  onProgress?: ConfigLoadProgress;
  /** Prefix for progress messages. Defaults to "Loading config". */
  progressLabelPrefix?: string;
}

export class ConfigCache {
  private readonly configContract: ContractBase;
  private readonly senderAddress: AztecAddress;
  private cached: GameConfig | undefined;
  private loading: Promise<GameConfig> | undefined;
  private readonly onProgress?: ConfigLoadProgress;
  private readonly progressLabelPrefix: string;

  constructor(
    configContract: ContractBase,
    senderAddress: AztecAddress,
    options?: ConfigCacheOptions
  ) {
    this.configContract = configContract;
    this.senderAddress = senderAddress;
    this.onProgress = options?.onProgress;
    this.progressLabelPrefix = options?.progressLabelPrefix ?? "Loading config";
  }

  /** Invalidate cache (e.g. if admin reconfigures). */
  invalidate(): void {
    this.cached = undefined;
    this.loading = undefined;
  }

  /** Get cached config, loading if needed. */
  async getConfig(): Promise<GameConfig> {
    if (this.cached) return this.cached;
    if (this.loading) return this.loading;
    this.loading = this.load();
    this.cached = await this.loading;
    this.loading = undefined;
    return this.cached;
  }

  private async load(): Promise<GameConfig> {
    const from = this.senderAddress;
    const c = this.configContract;

    // A single bundled `get_full_config_unconstrained` utility call replaces
    // the previous 26 serial simulate() calls. The embedded PXE does not
    // support concurrent execution, so a single call is also the only way to
    // avoid serial-call overhead entirely.
    const TOTAL_STEPS = 1;
    let step = 0;

    const simulateStep = async (
      label: string,
      run: () => Promise<unknown>
    ): Promise<unknown> => {
      step += 1;
      this.onProgress?.(
        `${this.progressLabelPrefix}: ${label} (${step}/${TOTAL_STEPS})`,
        step,
        TOTAL_STEPS
      );
      return unwrapSimulateResult(await run());
    };

    const fullRaw = await simulateStep("full config", () =>
      c.methods.get_full_config_unconstrained().simulate({ from })
    );

    const full = normalizeFullConfig(fullRaw);

    const planetDefaultStats = Array.isArray(full.default_stats)
      ? [...full.default_stats]
      : [];

    const upgrades: RawUpgrade[][] = Array.isArray(full.upgrades)
      ? full.upgrades.map((branch) =>
          Array.isArray(branch) ? [...branch] : [branch]
        )
      : [];

    const planetCumulativeRarities = Array.isArray(full.cumulative_rarities)
      ? full.cumulative_rarities.map((v) => Number(v ?? 0))
      : [];

    return {
      admin: full.admin != null ? String(full.admin) : "",
      snarkConfig: full.snark_config,
      planetDefaultStats,
      worldConfig: full.world_config,
      gameConfigCore: full.game_config_core,
      upgradeConfig: full.upgrade_config,
      planetLevelThresholds: full.planet_level_thresholds,
      spaceJunkConfig: full.space_junk_config,
      planetTypeWeightsTiers: [
        full.planet_type_weights_tier_0,
        full.planet_type_weights_tier_1,
        full.planet_type_weights_tier_2,
        full.planet_type_weights_tier_3,
      ],
      upgrades,
      artifactsConfig: full.artifacts_config,
      spaceshipsConfig: full.spaceships_config,
      captureZonesConfig: full.capture_zones_config,
      planetCumulativeRarities,
    };
  }
}
