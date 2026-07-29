/**
 * Display rules for sponsorship.
 *
 * The failure that matters here is not a crash — it is telling a player
 * something untrue, or telling them something true and leaving them stuck. Both
 * are asserted below.
 */
import { describe, expect, test } from "vitest";
import { reasonFromRevert } from "../src/errors.js";
import { humanizeDuration, resetsIn } from "../src/duration.js";
import {
  describeQuotaUnavailable,
  describeSponsored,
  flattenQuotaMessage,
} from "../src/messages.js";
import { millisUntilReset, resetLabel } from "../src/generation.js";

const DAY_START = 1_785_024_000n;
const BRIDGE = "https://example.invalid/bridge";
const THREE_HOURS = 3 * 60 * 60 * 1000;

describe("humanised durations", () => {
  test("rounds to the coarsest useful unit", () => {
    expect(humanizeDuration(THREE_HOURS)).toBe("3 hours");
    expect(humanizeDuration(60 * 60 * 1000)).toBe("an hour");
    expect(humanizeDuration(90 * 60 * 1000)).toBe("1.5 hours");
    expect(humanizeDuration(25 * 60 * 1000)).toBe("25 minutes");
    expect(humanizeDuration(60 * 1000)).toBe("a minute");
    expect(humanizeDuration(24 * 60 * 60 * 1000)).toBe("a day");
  });

  test("stays vague near zero rather than inviting a countdown", () => {
    expect(humanizeDuration(3_000)).toBe("under a minute");
    expect(humanizeDuration(0)).toBe("any moment now");
    expect(humanizeDuration(-5)).toBe("any moment now");
  });

  test("resetsIn reads as a sentence fragment", () => {
    expect(resetsIn(THREE_HOURS)).toBe("resets in 3 hours");
  });
});

describe("sponsored copy", () => {
  test("says sponsoring, never paying", () => {
    const message = describeSponsored(12, { millisUntilReset: THREE_HOURS });
    const text = flattenQuotaMessage(message);
    expect(text).toMatch(/sponsoring/i);
    // "paying your fees" invites "with whose money, and what do I owe?".
    expect(text).not.toMatch(/paying|pays for|covering the cost/i);
  });

  test("names the count and when it refreshes", () => {
    const text = flattenQuotaMessage(
      describeSponsored(12, { millisUntilReset: THREE_HOURS }),
    );
    expect(text).toContain("12");
    expect(text).toMatch(/resets in 3 hours/);
  });

  test("singular reads correctly", () => {
    expect(describeSponsored(1).headline).toMatch(/next 1 transaction\./);
  });
});

describe("unavailable copy", () => {
  test("being out of transactions offers a way to keep playing", () => {
    const message = describeQuotaUnavailable("exhausted", {
      millisUntilReset: THREE_HOURS,
      bridgeUrl: BRIDGE,
    });
    // The old copy — "You've used today's free transactions" — was a wall.
    expect(message.headline).not.toMatch(/you've used/i);
    expect(flattenQuotaMessage(message)).toMatch(/resets in 3 hours/);
    expect(message.action?.href).toBe(BRIDGE);
    expect(message.action?.label).toMatch(/add gas/i);
  });

  test("every dead-end reason offers an action", () => {
    for (const reason of [
      "exhausted",
      "no-seats",
      "fee-spike",
      "paymaster-empty",
      "not-sponsored",
    ] as const) {
      const message = describeQuotaUnavailable(reason, { bridgeUrl: BRIDGE });
      expect(message.action, `${reason} needs a next step`).toBeDefined();
      expect(message.action?.href).toBe(BRIDGE);
    }
  });

  test("transient states offer no action, because waiting is the action", () => {
    expect(describeQuotaUnavailable("sync-pending").action).toBeUndefined();
    expect(describeQuotaUnavailable("rollover").action).toBeUndefined();
  });

  test("waiting and being out still read differently", () => {
    const waiting = flattenQuotaMessage(
      describeQuotaUnavailable("sync-pending"),
    );
    const out = flattenQuotaMessage(describeQuotaUnavailable("exhausted"));
    expect(waiting).not.toBe(out);
    expect(waiting).not.toMatch(/out of/i);
  });

  test("no internal vocabulary reaches the player", () => {
    for (const reason of [
      "sync-pending",
      "exhausted",
      "no-seats",
      "fee-spike",
      "paymaster-empty",
      "rollover",
      "not-sponsored",
    ] as const) {
      const text = flattenQuotaMessage(
        describeQuotaUnavailable(reason, { bridgeUrl: BRIDGE }),
      );
      // "quota" is deliberately allowed — it is the word the product uses.
      expect(text).not.toMatch(/nullifier|generation|paymaster|FPC|wei|seat/i);
    }
  });
});

describe("revert mapping", () => {
  test("each contract failure maps to the reason a player would act on", () => {
    expect(reasonFromRevert("No sponsored transactions remaining")).toBe(
      "exhausted",
    );
    expect(reasonFromRevert("No sponsorship seats available today")).toBe(
      "no-seats",
    );
    expect(
      reasonFromRevert("Gas settings exceed the sponsorship allowance"),
    ).toBe("fee-spike");
    expect(reasonFromRevert("Generation is not currently sponsorable")).toBe(
      "rollover",
    );
    expect(
      reasonFromRevert("Sponsored call targets a non-allowlisted contract"),
    ).toBe("not-sponsored");
  });

  test("an unrecognised failure is not forced into a reason", () => {
    expect(reasonFromRevert("some unrelated network error")).toBeUndefined();
    expect(reasonFromRevert("")).toBeUndefined();
  });
});

describe("reset arithmetic still underpins the copy", () => {
  test("the countdown matches the day boundary", () => {
    expect(resetLabel()).toBe("00:00 UTC");
    expect(millisUntilReset(DAY_START + 86_400n - 60n)).toBe(60_000);
  });
});
