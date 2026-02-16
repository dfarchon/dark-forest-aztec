import type { Upgrade } from "@dfpunk/types";

export type RawUpgrade = {
  pop_cap_multiplier: bigint | number;
  pop_gro_multiplier: bigint | number;
  range_multiplier: bigint | number;
  speed_multiplier: bigint | number;
  def_multiplier: bigint | number;
};

/**
 * Converts raw data received from an Aztec contract call returning an
 * `Upgrade` struct into an `Upgrade` object (see @dfpunk/types).
 *
 * @param rawUpgrade raw data received from the Config contract's
 * `get_upgrade_unconstrained` or `get_upgrade` call
 */
export function decodeUpgrade(rawUpgrade: RawUpgrade): Upgrade {
  return {
    energyCapMultiplier: Number(rawUpgrade.pop_cap_multiplier),
    energyGroMultiplier: Number(rawUpgrade.pop_gro_multiplier),
    rangeMultiplier: Number(rawUpgrade.range_multiplier),
    speedMultiplier: Number(rawUpgrade.speed_multiplier),
    defMultiplier: Number(rawUpgrade.def_multiplier),
  };
}
