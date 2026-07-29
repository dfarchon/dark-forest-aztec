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
  | "not-sponsored";

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

/** User-facing copy. Plain language, no jargon, and never a dead end. */
export function describeQuotaUnavailable(
  reason: QuotaUnavailableReason,
): string {
  switch (reason) {
    case "sync-pending":
      return "Checking your free transactions…";
    case "exhausted":
      return "You've used all your free transactions for today. They come back at 00:00 UTC.";
    case "no-seats":
      return "Today's free transactions have all been claimed. More open up at 00:00 UTC.";
    case "fee-spike":
      return "Network fees are unusually high right now, so free transactions are paused.";
    case "paymaster-empty":
      return "Free transactions are unavailable right now.";
    case "rollover":
      return "Your free transactions just reset — reloading your allowance.";
    case "not-sponsored":
      return "This action isn't covered by free transactions.";
  }
}

/** Maps a contract revert message to a reason, or undefined if unrecognised. */
export function reasonFromRevert(
  message: string,
): QuotaUnavailableReason | undefined {
  if (/No sponsored transactions remaining/i.test(message)) return "exhausted";
  if (/No sponsorship seats available/i.test(message)) return "no-seats";
  if (/Gas settings exceed the sponsorship allowance/i.test(message))
    return "fee-spike";
  if (/Generation is not currently sponsorable/i.test(message))
    return "rollover";
  if (/non-allowlisted contract/i.test(message)) return "not-sponsored";
  return undefined;
}
