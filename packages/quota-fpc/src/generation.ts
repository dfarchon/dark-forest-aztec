/**
 * Generations: the paymaster's unit of "one day of allowance".
 *
 * A generation is simply the UTC day index (`floor(seconds / 86400)`), and the
 * contract validates it against the anchor block's timestamp. That makes the
 * daily reset a property of chain time — no cron, no operator action, nothing
 * to forget to run.
 *
 * Everything here derives from CHAIN time, never the local clock: a device with
 * a skewed clock would otherwise compute a generation the chain rejects.
 */

export const SECONDS_PER_DAY = 86_400n;

/** Must match ROLLOVER_GRACE_SECONDS in the contract. */
export const ROLLOVER_GRACE_SECONDS = 600n;

/** The generation a given chain timestamp (seconds) belongs to. */
export function generationAt(chainTimestampSeconds: bigint): number {
  if (chainTimestampSeconds < 0n) {
    throw new RangeError(
      `Chain timestamp cannot be negative: ${chainTimestampSeconds}`,
    );
  }
  return Number(chainTimestampSeconds / SECONDS_PER_DAY);
}

/** When a generation ends (start of the next day), in seconds. */
export function generationEndsAt(generation: number): bigint {
  return (BigInt(generation) + 1n) * SECONDS_PER_DAY;
}

/** Milliseconds until the allowance resets, for display. Never negative. */
export function millisUntilReset(chainTimestampSeconds: bigint): number {
  const generation = generationAt(chainTimestampSeconds);
  const remaining = generationEndsAt(generation) - chainTimestampSeconds;
  return Number(remaining > 0n ? remaining : 0n) * 1000;
}

/** "00:00 UTC" style label for when the allowance resets. Always 00:00 UTC. */
export function resetLabel(): string {
  return "00:00 UTC";
}

/**
 * The generations the contract will currently accept, most-preferred first.
 * Mirrors the contract exactly: today always, plus tomorrow inside the closing
 * grace window (so a transaction proven just before midnight can still land).
 */
export function sponsorableGenerations(
  chainTimestampSeconds: bigint,
): number[] {
  const today = generationAt(chainTimestampSeconds);
  const secondsIntoDay = chainTimestampSeconds % SECONDS_PER_DAY;
  const inGraceWindow =
    secondsIntoDay >= SECONDS_PER_DAY - ROLLOVER_GRACE_SECONDS;
  return inGraceWindow ? [today, today + 1] : [today];
}

/**
 * True when a generation the client already chose is about to stop being
 * accepted, so the caller should re-read chain time before proving. Guards the
 * midnight edge, where a stale in-memory generation silently starts failing.
 */
export function isGenerationStale(
  generation: number,
  chainTimestampSeconds: bigint,
): boolean {
  return !sponsorableGenerations(chainTimestampSeconds).includes(generation);
}
