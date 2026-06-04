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

    // Number of serial simulate() calls below: 16 fixed reads + 10 cumulative
    // rarity reads. Kept in sync manually so progress shows accurate totals.
    const CUMULATIVE_RARITY_COUNT = 10;
    const TOTAL_STEPS = 16 + CUMULATIVE_RARITY_COUNT;
    let step = 0;

    // Serialize PXE simulate() calls — the embedded PXE does not support
    // concurrent execution and floods the console with warnings otherwise.
    // `simulateStep` reports progress *before* each call so the UI can show
    // exactly which config read is currently in flight, while keeping every
    // simulate strictly sequential (no Promise.all).
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

    const admin = await simulateStep("admin", () =>
      c.methods.get_admin_unconstrained().simulate({ from })
    );
    const snarkConfig = await simulateStep("snark config", () =>
      c.methods.get_snark_config_unconstrained().simulate({ from })
    );
    const worldConfig = await simulateStep("world config", () =>
      c.methods.get_world_config_unconstrained().simulate({ from })
    );
    const gameConfigCore = await simulateStep("game config core", () =>
      c.methods.get_game_config_core_unconstrained().simulate({ from })
    );
    const upgradeConfig = await simulateStep("upgrade config", () =>
      c.methods.get_upgrade_config_unconstrained().simulate({ from })
    );
    const planetLevelThresholds = await simulateStep(
      "planet level thresholds",
      () =>
        c.methods.get_planet_level_thresholds_unconstrained().simulate({ from })
    );
    const spaceJunkConfig = await simulateStep("space junk config", () =>
      c.methods.get_space_junk_config_unconstrained().simulate({ from })
    );
    const tier0 = await simulateStep("planet type weights tier 0", () =>
      c.methods.get_planet_type_weights_tier_unconstrained(0).simulate({ from })
    );
    const tier1 = await simulateStep("planet type weights tier 1", () =>
      c.methods.get_planet_type_weights_tier_unconstrained(1).simulate({ from })
    );
    const tier2 = await simulateStep("planet type weights tier 2", () =>
      c.methods.get_planet_type_weights_tier_unconstrained(2).simulate({ from })
    );
    const tier3 = await simulateStep("planet type weights tier 3", () =>
      c.methods.get_planet_type_weights_tier_unconstrained(3).simulate({ from })
    );
    const planetDefaultStatsArr = await simulateStep("default stats", () =>
      c.methods.get_default_stats_unconstrained().simulate({ from })
    );
    const upgradesArr = await simulateStep("upgrades", () =>
      c.methods.get_upgrades_unconstrained().simulate({ from })
    );
    const artifactsConfig = await simulateStep("artifacts config", () =>
      c.methods.get_artifacts_config_unconstrained().simulate({ from })
    );
    const spaceshipsConfig = await simulateStep("spaceships config", () =>
      c.methods.get_spaceships_config_unconstrained().simulate({ from })
    );
    const captureZonesConfig = await simulateStep("capture zones config", () =>
      c.methods.get_capture_zones_config_unconstrained().simulate({ from })
    );

    const cumulativeRaritiesRaw: unknown[] = [];
    for (let i = 0; i < CUMULATIVE_RARITY_COUNT; i++) {
      cumulativeRaritiesRaw.push(
        await simulateStep(
          `cumulative rarity ${i + 1}/${CUMULATIVE_RARITY_COUNT}`,
          () =>
            c.methods.get_cumulative_rarity_unconstrained(i).simulate({ from })
        )
      );
    }

    const planetDefaultStats = Array.isArray(planetDefaultStatsArr)
      ? [...planetDefaultStatsArr]
      : [planetDefaultStatsArr];

    const upgrades: RawUpgrade[][] = Array.isArray(upgradesArr)
      ? (upgradesArr as RawUpgrade[][]).map((branch) =>
          Array.isArray(branch) ? [...branch] : [branch]
        )
      : [[upgradesArr as RawUpgrade]];

    const planetCumulativeRarities = cumulativeRaritiesRaw.map((v) =>
      Number(v ?? 0)
    );

    return {
      admin: admin != null ? String(admin) : "",
      snarkConfig,
      planetDefaultStats,
      worldConfig,
      gameConfigCore,
      upgradeConfig,
      planetLevelThresholds,
      spaceJunkConfig,
      planetTypeWeightsTiers: [tier0, tier1, tier2, tier3],
      upgrades,
      artifactsConfig,
      spaceshipsConfig,
      captureZonesConfig,
      planetCumulativeRarities,
    };
  }
}
