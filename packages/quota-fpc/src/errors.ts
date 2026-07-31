/**
 * Why a sponsored transaction could not be sent.
 *
 * The distinction that matters most is SyncPending vs Exhausted. They look
 * identical from a naive "is the allowance note there?" check — a wallet that
 * has not yet discovered the note is indistinguishable from one with nothing
 * left — but they call for opposite responses: wait a moment, versus tell the
 * user they are out for today. Guessing wrong sends active players to a funding
 * page they do not need, so exhaustion is only ever declared on positive
 * evidence.
 */
export type QuotaUnavailableReason =
  /** Allowance state not yet observable (wallet still syncing). Retry shortly. */
  | "sync-pending"
  /** Confirmed: this user has used their whole allowance for this generation. */
  | "exhausted"
  /** Every seat for this generation is taken; capacity frees at the reset. */
  | "no-seats"
  /** Network fees currently exceed the paymaster's per-transaction ceiling. */
  | "fee-spike"
  /** The paymaster's own balance is too low to sponsor anything. */
  | "paymaster-empty"
  /** The chosen generation is no longer accepted (clock rolled over). */
  | "rollover"
  /** This call targets a contract the paymaster does not sponsor. */
  | "not-sponsored"
  /** Sponsorship was narrowed and this player's seat fell outside the new cap. */
  | "seat-revoked";

export class QuotaUnavailableError extends Error {
  constructor(
    readonly reason: QuotaUnavailableReason,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "QuotaUnavailableError";
  }
}

/** Maps a contract revert message to a reason, or undefined if unrecognised. */
export function reasonFromRevert(
  message: string,
): QuotaUnavailableReason | undefined {
  if (/No sponsored transactions remaining/i.test(message)) return "exhausted";
  if (/No sponsorship seats available/i.test(message)) return "no-seats";
  // Not the same as "seats are full": the operator lowered the player cap and
  // this player was above it. Telling them the day is full would be untrue.
  if (/seat no longer within capacity/i.test(message)) return "seat-revoked";
  if (/Gas settings exceed the sponsorship allowance/i.test(message))
    return "fee-spike";
  if (/Generation is not currently sponsorable/i.test(message))
    return "rollover";
  if (/non-allowlisted contract/i.test(message)) return "not-sponsored";
  // The player's ACCOUNT class isn't allowlisted (never true for the embedded
  // wallet unless its account version drifted from the paymaster's config).
  // Same player outcome as an unsponsored target: fall back to their own gas.
  if (/account class is not sponsored/i.test(message)) return "not-sponsored";
  return undefined;
}
