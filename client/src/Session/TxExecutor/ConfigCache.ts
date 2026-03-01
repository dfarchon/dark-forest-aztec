/**
 * ConfigCache: lazy-loads and caches game config from the Config contract.
 * Config objects are immutable during a game session (set by admin during configure).
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractBase } from "@aztec/aztec.js/contracts";

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
  spaceshipsConfig: unknown;
  planetTypeWeightsTiers: [unknown, unknown, unknown, unknown];
  /** [branch][level] — 3 branches × 4 levels, from get_upgrade_by_branch_level */
  upgrades: RawUpgrade[][];
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

    // Load all config objects in parallel where possible
    const [
      admin,
      snarkConfig,
      worldConfig,
      gameConfigCore,
      upgradeConfig,
      planetLevelThresholds,
      spaceJunkConfig,
      spaceshipsConfig,
      tier0,
      tier1,
      tier2,
      tier3,
    ] = await Promise.all([
      c.methods.get_admin().simulate({ from }),
      c.methods.get_snark_config().simulate({ from }),
      c.methods.get_world_config().simulate({ from }),
      c.methods.get_game_config_core().simulate({ from }),
      c.methods.get_upgrade_config().simulate({ from }),
      c.methods.get_planet_level_thresholds().simulate({ from }),
      c.methods.get_space_junk_config().simulate({ from }),
      c.methods.get_spaceships_config().simulate({ from }),
      c.methods.get_planet_type_weights_tier(0).simulate({ from }),
      c.methods.get_planet_type_weights_tier(1).simulate({ from }),
      c.methods.get_planet_type_weights_tier(2).simulate({ from }),
      c.methods.get_planet_type_weights_tier(3).simulate({ from }),
    ]);

    // Load planet default stats for levels 0-9
    const planetDefaultStats = await Promise.all(
      Array.from({ length: 10 }, (_, level) =>
        c.methods.get_planet_default_stats(level).simulate({ from })
      )
    );

    // Load upgrades: 3 branches × 4 levels (key = branch * 10 + level)
    const upgradesPromises: Promise<RawUpgrade>[][] = [
      [0, 1, 2, 3].map((level) =>
        c.methods.get_upgrade_by_branch_level(0, level).simulate({ from })
      ) as Promise<RawUpgrade>[],
      [0, 1, 2, 3].map((level) =>
        c.methods.get_upgrade_by_branch_level(1, level).simulate({ from })
      ) as Promise<RawUpgrade>[],
      [0, 1, 2, 3].map((level) =>
        c.methods.get_upgrade_by_branch_level(2, level).simulate({ from })
      ) as Promise<RawUpgrade>[],
    ];
    const upgrades = await Promise.all(
      upgradesPromises.map((branch) => Promise.all(branch))
    );

    // Load cumulative rarities for levels 0-9
    const planetCumulativeRarities = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        c.methods.get_cumulative_rarity(i).simulate({ from })
      )
    ).then((vals) => vals.map((v) => Number(v ?? 0)));

    return {
      admin: admin != null ? String(admin) : "",
      snarkConfig,
      planetDefaultStats,
      worldConfig,
      gameConfigCore,
      upgradeConfig,
      planetLevelThresholds,
      spaceJunkConfig,
      spaceshipsConfig,
      planetTypeWeightsTiers: [tier0, tier1, tier2, tier3],
      upgrades,
      planetCumulativeRarities,
    };
  }
}
