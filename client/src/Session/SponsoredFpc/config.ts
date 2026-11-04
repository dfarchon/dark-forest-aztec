import type { GasProfile } from "@dfarchon/sponsored-fpc";

/**
 * Initial Aztec 6 sponsorship envelope. Re-measure against representative
 * gameplay transactions before lowering either limit in production.
 */
export const DARK_FOREST_SPONSORED_GAS_PROFILE: GasProfile = {
  daGasLimit: 50_000,
  l2GasLimit: 6_000_000,
  teardownDaGasLimit: 5_000,
  teardownL2GasLimit: 500_000,
  feeHeadroomMultiplier: 2,
};
