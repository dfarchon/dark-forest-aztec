/**
 * Player-facing copy for sponsorship.
 *
 * Two rules shaped all of this:
 *
 * 1. **Never leave the player without a next step.** "You've used today's free
 *    transactions" is a wall. The same fact plus when it lifts and how to skip
 *    the wait is a choice.
 * 2. **Sponsoring, not paying.** "Dark Forest is paying your fees" invites the
 *    question "with whose money, and what do I owe?". Sponsoring is what is
 *    actually happening and reads as a gift rather than a transaction.
 */
import { resetsIn } from "./duration.js";
import type { QuotaUnavailableReason } from "./errors.js";

export interface QuotaAction {
  label: string;
  href?: string;
}

export interface QuotaMessage {
  /** One short line. Assume this may be all the player reads. */
  headline: string;
  /** Optional second sentence with the useful detail. */
  detail?: string;
  /** What the player can do about it, when there is something. */
  action?: QuotaAction;
}

export interface QuotaCopyContext {
  /** Milliseconds until the allowance refreshes, for a human phrase. */
  millisUntilReset?: number;
  /** Where a player goes to add gas themselves. */
  bridgeUrl?: string;
}

function addGasAction(bridgeUrl?: string): QuotaAction {
  return { label: "Add gas to your account", href: bridgeUrl };
}

/** Copy for a player who cannot currently be sponsored. */
export function describeQuotaUnavailable(
  reason: QuotaUnavailableReason,
  context: QuotaCopyContext = {},
): QuotaMessage {
  const { millisUntilReset, bridgeUrl } = context;
  const refresh =
    millisUntilReset === undefined
      ? "Your sponsored transactions refresh daily"
      : `Your sponsored transactions ${resetsIn(millisUntilReset)}`;

  switch (reason) {
    case "sync-pending":
      return { headline: "Checking your sponsored transactions…" };

    case "exhausted":
      return {
        headline: "You're out of sponsored transactions for now.",
        detail: `${refresh}. You can also add gas to your account to keep playing right away.`,
        action: addGasAction(bridgeUrl),
      };

    case "no-seats":
      return {
        headline: "Today's sponsored transactions have all been claimed.",
        detail: `${refresh}. Adding gas to your account lets you play now.`,
        action: addGasAction(bridgeUrl),
      };

    case "fee-spike":
      return {
        headline: "Network fees are unusually high, so sponsoring is paused.",
        detail:
          "It should resume on its own once fees settle. Adding gas to your account lets you keep playing meanwhile.",
        action: addGasAction(bridgeUrl),
      };

    case "paymaster-empty":
      return {
        headline: "Sponsored transactions aren't available right now.",
        detail: "Adding gas to your account lets you keep playing.",
        action: addGasAction(bridgeUrl),
      };

    case "rollover":
      return {
        headline: "Your sponsored transactions just refreshed.",
        detail: "Reloading your allowance — this takes a moment.",
      };

    case "not-sponsored":
      return {
        headline: "This action isn't sponsored.",
        detail: "It runs from your own gas instead.",
        action: addGasAction(bridgeUrl),
      };
  }
}

/** Copy for a player who IS being sponsored. */
export function describeSponsored(
  remaining: number,
  context: QuotaCopyContext = {},
): QuotaMessage {
  const { millisUntilReset } = context;
  const refresh =
    millisUntilReset === undefined
      ? ""
      : ` They ${resetsIn(millisUntilReset)}.`;

  if (remaining <= 0) {
    return {
      headline: "Dark Forest is sponsoring your transactions.",
      detail: "You don't need to add gas to play.",
    };
  }

  return {
    headline: `Dark Forest is sponsoring your next ${remaining} transaction${
      remaining === 1 ? "" : "s"
    }.`,
    detail: `You don't need any gas of your own.${refresh}`,
  };
}

/** Flattens a message for places that can only show one string. */
export function flattenQuotaMessage(message: QuotaMessage): string {
  return [message.headline, message.detail].filter(Boolean).join(" ");
}
