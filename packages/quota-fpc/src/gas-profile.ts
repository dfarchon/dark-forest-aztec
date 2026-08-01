/**
 * What a sponsored transaction is allowed to cost.
 *
 * These live here, in one place, because TWO parties must agree on them and a
 * disagreement is invisible until it costs somebody money:
 *
 *   - the client, which builds sponsored transactions with these gas limits, and
 *   - the operator tooling, which must refuse to set a per-transaction ceiling
 *     below what the client will actually try to spend.
 *
 * If the ceiling drops below the client's spend, EVERY sponsored transaction
 * becomes unprovable and players are charged their own gas instead — with no
 * on-chain error to point at, because the transaction never gets that far.
 * They were previously duplicated across `WalletManager.ts` and the update
 * script, which is precisely how that divergence happens.
 */

/** Data-gas ceiling. Far tighter than the L2 cap on Aztec, and easy to exceed. */
export const QUOTA_DA_GAS_LIMIT = 50_000;
/** L2-gas ceiling. */
export const QUOTA_L2_GAS_LIMIT = 6_000_000;
export const QUOTA_TEARDOWN_DA_GAS_LIMIT = 5_000;
export const QUOTA_TEARDOWN_L2_GAS_LIMIT = 500_000;
/** Absorbs fee movement between proving and inclusion. */
export const QUOTA_FEE_HEADROOM_MULTIPLIER = 2;

/**
 * The smallest per-transaction ceiling that still lets the client transact at
 * the given fee rates. Anything below this makes sponsorship fail for everyone.
 *
 * Mirrors the contract's own `assert_fee_within_max`, which bills
 * `gas_limits x max_fees_per_gas` and deliberately does NOT add teardown —
 * teardown is already reserved inside the limits at v5.0.1.
 */
export function sponsoredFeeFloorWei(
  feePerDaGas: bigint,
  feePerL2Gas: bigint,
  headroom: number = QUOTA_FEE_HEADROOM_MULTIPLIER,
): bigint {
  const perTx =
    BigInt(QUOTA_DA_GAS_LIMIT) * feePerDaGas +
    BigInt(QUOTA_L2_GAS_LIMIT) * feePerL2Gas;
  return perTx * BigInt(headroom);
}
