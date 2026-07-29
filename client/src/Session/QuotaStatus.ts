/**
 * Reads a player's sponsored-transaction allowance for display.
 *
 * Everything here is advisory: the paymaster contract is the only thing that
 * decides whether a transaction is sponsored. This exists so the interface can
 * show a player where they stand without sending anything.
 *
 * The one rule that matters: an allowance we cannot yet see is reported as
 * unknown, never as empty. A wallet that has not finished syncing looks exactly
 * like one with nothing left, and telling an active player they are out of free
 * transactions sends them to a funding page they do not need.
 */
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { generationAt, millisUntilReset, resetLabel } from "@dfpunk/quota-fpc";

export type QuotaStatusKind =
  /** No paymaster configured for this build. */
  | "off"
  /** Configured, but we could not read the allowance yet. */
  | "unknown"
  /** Player has free transactions left today. */
  | "available"
  /** Player has not used the paymaster yet today. */
  | "unused"
  /** Confirmed: today's allowance is spent. */
  | "spent";

export interface QuotaStatus {
  kind: QuotaStatusKind;
  /** Transactions left today; meaningful when `kind === "available"`. */
  remaining: number;
  /** Where the allowance resets, for display ("00:00 UTC"). */
  resetsAt: string;
  /** Milliseconds until the reset, for a countdown. */
  millisUntilReset: number;
}

export const QUOTA_STATUS_OFF: QuotaStatus = {
  kind: "off",
  remaining: 0,
  resetsAt: resetLabel(),
  millisUntilReset: 0,
};

/** What this module needs from a deployed paymaster. Narrow for testability. */
export interface QuotaReader {
  getQuotaInfo(
    player: AztecAddress,
    generation: number
  ): Promise<{ subscribed: boolean; remaining: number }>;
  /** Chain time in seconds — never the local clock, which can be skewed. */
  chainTimestampSeconds(): Promise<bigint>;
}

/**
 * Current allowance for a player. Any read failure yields `unknown` rather than
 * a guess, so the interface degrades to "checking…" instead of lying.
 */
export async function readQuotaStatus(
  reader: QuotaReader | undefined,
  player: AztecAddress | undefined
): Promise<QuotaStatus> {
  if (!reader || !player) return QUOTA_STATUS_OFF;

  try {
    const now = await reader.chainTimestampSeconds();
    const generation = generationAt(now);
    const info = await reader.getQuotaInfo(player, generation);
    const shared = {
      resetsAt: resetLabel(),
      millisUntilReset: millisUntilReset(now),
    };

    if (info.subscribed) {
      return info.remaining > 0
        ? { kind: "available", remaining: info.remaining, ...shared }
        : { kind: "spent", remaining: 0, ...shared };
    }
    // Not subscribed today: either untouched, or spent and the note is gone.
    // Distinguishing them needs the player nullifier; until the caller checks
    // it, "unused" is the safe reading — it never tells a player they are out.
    return { kind: "unused", remaining: 0, ...shared };
  } catch (err) {
    console.debug("[QuotaStatus] could not read allowance:", err);
    return {
      kind: "unknown",
      remaining: 0,
      resetsAt: resetLabel(),
      millisUntilReset: 0,
    };
  }
}

/** Short label for the top bar. */
export function formatQuotaBadge(status: QuotaStatus): string | undefined {
  switch (status.kind) {
    case "off":
      return undefined;
    case "unknown":
      return "checking free txs…";
    case "available":
      return `${status.remaining} free tx${status.remaining === 1 ? "" : "s"}`;
    case "unused":
      return "free txs ready";
    case "spent":
      return "no free txs left";
  }
}

/** Hover detail for the badge. */
export function formatQuotaTooltip(status: QuotaStatus): string {
  switch (status.kind) {
    case "off":
      return "Sponsored transactions are not enabled.";
    case "unknown":
      return "Checking how many free transactions you have left.";
    case "available":
      return `Dark Forest is paying for ${status.remaining} more transaction${
        status.remaining === 1 ? "" : "s"
      } today. Your allowance refills at ${status.resetsAt}.`;
    case "unused":
      return `Your free transactions for today are ready. They refill at ${status.resetsAt}.`;
    case "spent":
      return `You've used today's free transactions. More arrive at ${status.resetsAt}; until then transactions come out of your own balance.`;
  }
}
