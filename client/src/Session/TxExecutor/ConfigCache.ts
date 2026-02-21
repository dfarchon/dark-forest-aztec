/**
 * ConfigCache: lazy-loads and caches game config from the Config contract.
 * Config objects are immutable during a game session (set by admin during configure).
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractBase } from "@aztec/aztec.js/contracts";

export interface GameConfig {
  snarkConfig: unknown;
  planetDefaultStats: unknown[];
  worldConfig: unknown;
  gameConfigCore: unknown;
  planetLevelThresholds: unknown;
  spaceJunkConfig: unknown;
  planetTypeWeightsTiers: [unknown, unknown, unknown, unknown];
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
      snarkConfig,
      worldConfig,
      gameConfigCore,
      planetLevelThresholds,
      spaceJunkConfig,
      tier0,
      tier1,
      tier2,
      tier3,
    ] = await Promise.all([
      c.methods.get_snark_config().simulate({ from }),
      c.methods.get_world_config().simulate({ from }),
      c.methods.get_game_config_core().simulate({ from }),
      c.methods.get_planet_level_thresholds().simulate({ from }),
      c.methods.get_space_junk_config().simulate({ from }),
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

    // Debug: log shape of get_planet_default_stats return (snake_case vs camelCase, undefined?)
    const level0 = planetDefaultStats[0] as Record<string, unknown> | undefined;
    console.log("[ConfigCache] get_planet_default_stats(0) raw:", level0);
    if (level0) {
      console.log(
        "[ConfigCache] keys:",
        Object.keys(level0),
        "| population_cap:",
        level0.population_cap,
        "| populationCap:",
        level0.populationCap
      );
    }

    return {
      snarkConfig,
      planetDefaultStats,
      worldConfig,
      gameConfigCore,
      planetLevelThresholds,
      spaceJunkConfig,
      planetTypeWeightsTiers: [tier0, tier1, tier2, tier3],
    };
  }
}
