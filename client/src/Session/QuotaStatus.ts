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
import {
  generationAt,
  millisUntilReset,
  resetLabel,
  resetsIn,
} from "@alejoamiras/quota-paymaster";
import type { AztecAddress } from "@aztec/aztec.js/addresses";

import { externalLinks } from "../config/externalLinks";
import {
  describeQuotaUnavailable,
  describeSponsored,
  flattenQuotaMessage,
} from "./quotaMessages";

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

/** Short label for the top bar. Space is tight, so this is the headline only. */
export function formatQuotaBadge(status: QuotaStatus): string | undefined {
  switch (status.kind) {
    case "off":
      return undefined;
    case "unknown":
      return "checking sponsorship…";
    case "available":
      return `${status.remaining} sponsored`;
    case "unused":
      return "sponsored";
    case "spent":
      // Leads with when it comes back rather than with the bad news.
      return `sponsoring ${resetsIn(status.millisUntilReset)}`;
  }
}

/** Hover detail for the badge, including what to do about it. */
export function formatQuotaTooltip(status: QuotaStatus): string {
  const context = {
    millisUntilReset: status.millisUntilReset,
    bridgeUrl: externalLinks.aztecMainnet.feeJuiceBridge,
  };

  switch (status.kind) {
    case "off":
      return "Sponsored transactions aren't enabled.";
    case "unknown":
      return flattenQuotaMessage(
        describeQuotaUnavailable("sync-pending", context)
      );
    case "available":
      return flattenQuotaMessage(describeSponsored(status.remaining, context));
    case "unused":
      return flattenQuotaMessage(describeSponsored(0, context));
    case "spent":
      return flattenQuotaMessage(
        describeQuotaUnavailable("exhausted", context)
      );
  }
}

/** Where to send a player who wants to stop waiting. Undefined when pointless. */
export function quotaActionLink(status: QuotaStatus): string | undefined {
  if (status.kind !== "spent") return undefined;
  return describeQuotaUnavailable("exhausted", {
    millisUntilReset: status.millisUntilReset,
    bridgeUrl: externalLinks.aztecMainnet.feeJuiceBridge,
  }).action?.href;
}

/**
 * A tiny store so the top bar can show the allowance without threading a
 * reference through four layers of game plumbing. The transaction path writes
 * to it whenever it reads allowance state; the badge reads from it.
 *
 * Advisory only, like everything else here — the contract decides.
 */
let currentStatus: QuotaStatus = QUOTA_STATUS_OFF;
const listeners = new Set<(status: QuotaStatus) => void>();

export function publishQuotaStatus(status: QuotaStatus): void {
  currentStatus = status;
  for (const listener of listeners) listener(status);
}

export function getQuotaStatus(): QuotaStatus {
  return currentStatus;
}

export function subscribeToQuotaStatus(
  listener: (status: QuotaStatus) => void
): () => void {
  listeners.add(listener);
  listener(currentStatus);
  return () => listeners.delete(listener);
}

/** Turns an allowance reading into what the player sees. */
export function quotaStatusFromAllowance(
  allowance: { subscribed: boolean; remaining: number; syncing: boolean },
  chainTimestampSeconds: bigint
): QuotaStatus {
  const shared = {
    resetsAt: resetLabel(),
    millisUntilReset: millisUntilReset(chainTimestampSeconds),
  };
  if (allowance.syncing) {
    return { kind: "unknown", remaining: 0, ...shared };
  }
  if (allowance.remaining > 0) {
    return { kind: "available", remaining: allowance.remaining, ...shared };
  }
  // Claimed today with nothing left is genuinely spent; never claimed is ready.
  return allowance.subscribed
    ? { kind: "spent", remaining: 0, ...shared }
    : { kind: "unused", remaining: 0, ...shared };
}
