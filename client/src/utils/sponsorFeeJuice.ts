import type { Gas } from "@aztec/stdlib/gas";
import type { GasFees } from "@aztec/stdlib/gas";

/**
 * Approximate FeeJuice cost from padded gas dimensions and current min fee schedule.
 */
export function feeJuiceWeiFromGasPair(
  main: Gas,
  teardown: Gas,
  fees: GasFees
): bigint {
  return feeJuiceWeiFromGas(main, fees) + feeJuiceWeiFromGas(teardown, fees);
}

function feeJuiceWeiFromGas(g: Gas, fees: GasFees): bigint {
  return (
    BigInt(g.daGas) * fees.feePerDaGas + BigInt(g.l2Gas) * fees.feePerL2Gas
  );
}
