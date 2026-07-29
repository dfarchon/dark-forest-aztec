/**
 * Display rules for the allowance.
 *
 * The failure that matters here is not a crash — it is telling a player
 * something untrue. Specifically: an allowance the wallet has not finished
 * reading must never render as "you're out", because that pushes an active
 * player toward funding they do not need.
 */
import { describe, expect, test } from "vitest";
import { describeQuotaUnavailable, reasonFromRevert } from "../src/errors.js";
import { millisUntilReset, resetLabel } from "../src/generation.js";

const DAY_START = 1_785_024_000n;

describe("player-facing copy", () => {
  test("every reason has copy, and none of it blames the player", () => {
    const reasons = [
      "sync-pending",
      "exhausted",
      "no-seats",
      "fee-spike",
      "paymaster-empty",
      "rollover",
      "not-sponsored",
    ] as const;

    for (const reason of reasons) {
      const copy = describeQuotaUnavailable(reason);
      expect(copy.length).toBeGreaterThan(0);
      // No internal vocabulary leaking into the interface.
      expect(copy).not.toMatch(/nullifier|generation|paymaster|FPC|wei|quota/i);
    }
  });

  test("waiting and being out of transactions read differently", () => {
    const waiting = describeQuotaUnavailable("sync-pending");
    const out = describeQuotaUnavailable("exhausted");
    expect(waiting).not.toBe(out);
    // "Out" must say when they come back; "waiting" must not claim they are gone.
    expect(out).toMatch(/00:00 UTC/);
    expect(waiting).not.toMatch(/used all/i);
  });

  test("exhausted copy tells the player when the allowance returns", () => {
    expect(describeQuotaUnavailable("exhausted")).toMatch(/come back|00:00/i);
    expect(describeQuotaUnavailable("no-seats")).toMatch(/00:00/);
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
    // Guessing here would show confident, wrong copy for an unrelated bug.
    expect(reasonFromRevert("some unrelated network error")).toBeUndefined();
    expect(reasonFromRevert("")).toBeUndefined();
  });
});

describe("reset display", () => {
  test("the countdown matches the label the player is shown", () => {
    expect(resetLabel()).toBe("00:00 UTC");
    // A minute before midnight, the countdown is a minute — not a day.
    expect(millisUntilReset(DAY_START + 86_400n - 60n)).toBe(60_000);
  });
});
