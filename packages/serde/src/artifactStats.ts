import type { Numberish } from "./chain_state";

// Matches Planet.with_artifact_multiplier in the contract.
const offsets = {
  population_cap: 0n,
  population_growth: 10n,
  range: 20n,
  speed: 30n,
  defense: 40n,
};

export function effectivePlanetStat(
  base: Numberish,
  multipliers: Numberish | undefined,
  stat: keyof typeof offsets,
): bigint {
  const packed = BigInt(multipliers ?? 0);
  if (packed === 0n) return BigInt(base);
  const percent = (packed >> offsets[stat]) & 1023n;
  return (BigInt(base) * percent) / 100n;
}
