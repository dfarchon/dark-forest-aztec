/**
 * ConfigCache: lazy-loads and caches game config from the Config contract.
 * Config objects are immutable during a game session (set by admin during configure).
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractBase } from "@aztec/aztec.js/contracts";

import { unwrapSimulateResult } from "../../utils/unwrapSimulateResult";

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
  /** Cumulative rarities for levels 0-9, from get_cumulative_rarity */
  planetCumulativeRarities: number[];
}

export class ConfigCache {
  private readonly configContract: ContractBase;
  private readonly senderAddress: AztecAddress;
  private cached: GameConfig | undefined;
  private loading: Promise<GameConfig> | undefined;

  constructor(configContract: ContractBase, senderAddress: AztecAddress) {
    this.configContract = configContract;
    this.senderAddress = senderAddress;
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

    // Serialize PXE simulate() calls — the embedded PXE does not support
    // concurrent execution and floods the console with warnings otherwise.
    const admin = unwrapSimulateResult(
      await c.methods.get_admin_unconstrained().simulate({ from })
    );
    const snarkConfig = unwrapSimulateResult(
      await c.methods.get_snark_config_unconstrained().simulate({ from })
    );
    const worldConfig = unwrapSimulateResult(
      await c.methods.get_world_config_unconstrained().simulate({ from })
    );
    const gameConfigCore = unwrapSimulateResult(
      await c.methods.get_game_config_core_unconstrained().simulate({ from })
    );
    const upgradeConfig = unwrapSimulateResult(
      await c.methods.get_upgrade_config_unconstrained().simulate({ from })
    );
    const planetLevelThresholds = unwrapSimulateResult(
      await c.methods
        .get_planet_level_thresholds_unconstrained()
        .simulate({ from })
    );
    const spaceJunkConfig = unwrapSimulateResult(
      await c.methods.get_space_junk_config_unconstrained().simulate({ from })
    );
    const tier0 = unwrapSimulateResult(
      await c.methods
        .get_planet_type_weights_tier_unconstrained(0)
        .simulate({ from })
    );
    const tier1 = unwrapSimulateResult(
      await c.methods
        .get_planet_type_weights_tier_unconstrained(1)
        .simulate({ from })
    );
    const tier2 = unwrapSimulateResult(
      await c.methods
        .get_planet_type_weights_tier_unconstrained(2)
        .simulate({ from })
    );
    const tier3 = unwrapSimulateResult(
      await c.methods
        .get_planet_type_weights_tier_unconstrained(3)
        .simulate({ from })
    );
    const planetDefaultStatsArr = unwrapSimulateResult(
      await c.methods.get_default_stats_unconstrained().simulate({ from })
    );
    const upgradesArr = unwrapSimulateResult(
      await c.methods.get_upgrades_unconstrained().simulate({ from })
    );
    const artifactsConfig = unwrapSimulateResult(
      await c.methods.get_artifacts_config_unconstrained().simulate({ from })
    );
    const spaceshipsConfig = unwrapSimulateResult(
      await c.methods.get_spaceships_config_unconstrained().simulate({ from })
    );

    const cumulativeRaritiesRaw: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      cumulativeRaritiesRaw.push(
        unwrapSimulateResult(
          await c.methods
            .get_cumulative_rarity_unconstrained(i)
            .simulate({ from })
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
      planetCumulativeRarities,
    };
  }
}
