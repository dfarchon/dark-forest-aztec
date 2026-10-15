/**
 * FeeJuice uses 18 decimals (ERC20-like). Helpers for human-readable FJ strings vs wei.
 */

const FJ_DECIMALS = 18n;

/** Default minimum SponsoredFPC balance when env is unset (2 FJ). */
export const DEFAULT_SPONSORED_FPC_MIN_FJ = "2";

/** Default SponsoredFPC balance at which the client starts warning players. */
export const DEFAULT_SPONSORED_FPC_WARNING_FJ = "20";

/**
 * Default minimum active-account FeeJuice balance before entering the game when sponsor mode is off.
 * Override with `VITE_ACCOUNT_MIN_BALANCE_FJ`.
 */
export const DEFAULT_ACCOUNT_MIN_BALANCE_FJ = "5";

/**
 * Parse a decimal string like "0.01" into FeeJuice wei (smallest units).
 * Returns undefined if invalid.
 */
export function parseFjDecimalToWei(input: string): bigint | undefined {
  const s = input.trim();
  if (!s.length) return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const [wholePart, fracPart = ""] = s.split(".");
  const frac = fracPart
    .slice(0, Number(FJ_DECIMALS))
    .padEnd(Number(FJ_DECIMALS), "0");
  const whole = BigInt(wholePart || "0");
  const fracWei = frac.length > 0 ? BigInt(frac || "0") : 0n;
  return whole * 10n ** FJ_DECIMALS + fracWei;
}

/**
 * Format FeeJuice wei as human-readable FJ with up to 18 fractional digits (trim trailing zeros).
 */
export function formatFeeJuiceWei(amount: bigint): string {
  const BASE = 10n ** FJ_DECIMALS;
  const whole = amount / BASE;
  const frac = amount % BASE;
  if (frac === 0n) return `${whole.toString()} FJ`;
  const fracStr = frac.toString().padStart(Number(FJ_DECIMALS), "0");
  const trimmed = fracStr.replace(/0+$/, "");
  return `${whole.toString()}.${trimmed} FJ`;
}
