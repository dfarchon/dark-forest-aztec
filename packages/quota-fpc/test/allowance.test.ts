/**
 * Fee-source resolution and the sync-await discipline.
 *
 * These tests encode the rule that cost the most to get right: a wallet that has
 * not yet discovered its allowance note must never be reported as "out of free
 * transactions", because that sends an active player to a funding page they do
 * not need.
 */
import { describe, expect, test } from "vitest";
import {
  awaitAllowanceTransition,
  resolveFeeSource,
  type AllowanceState,
  type FeeSourceInputs,
} from "../src/allowance.js";
import { SECONDS_PER_DAY, generationAt } from "../src/generation.js";

const NOW = 1_785_067_200n; // mid-day
const GENERATION = generationAt(NOW);

function inputs(overrides: Partial<FeeSourceInputs> = {}): FeeSourceInputs {
  const state: AllowanceState = {
    generation: GENERATION,
    subscribed: true,
    remaining: 5,
    syncing: false,
    ...(overrides.state ?? {}),
  };
  return {
    chainTimestampSeconds: NOW,
    findFreeSeat: async () => 3,
    ownBalance: 0n,
    minSelfPayBalance: 5n * 10n ** 18n,
    paymasterBalance: 10n ** 21n,
    minPaymasterBalance: 10n ** 16n,
    ...overrides,
    state,
  };
}

describe("resolveFeeSource", () => {
  test("uses sponsorship when allowance remains", async () => {
    const source = await resolveFeeSource(inputs());
    expect(source).toEqual({ kind: "sponsored", generation: GENERATION });
  });

  test("claims a seat on the first transaction of the day", async () => {
    const source = await resolveFeeSource(
      inputs({
        state: {
          generation: GENERATION,
          subscribed: false,
          remaining: 0,
          syncing: false,
        },
      }),
    );
    expect(source).toEqual({
      kind: "sponsored-first",
      generation: GENERATION,
      seat: 3,
    });
  });

  test("exhausted with no funds is blocked, with funds falls back to self-pay", async () => {
    const exhausted = {
      generation: GENERATION,
      subscribed: true,
      remaining: 0,
      syncing: false,
    };

    expect(await resolveFeeSource(inputs({ state: exhausted }))).toEqual({
      kind: "blocked",
      reason: "exhausted",
    });

    expect(
      await resolveFeeSource(
        inputs({ state: exhausted, ownBalance: 10n ** 19n }),
      ),
    ).toEqual({ kind: "self" });
  });

  test("a syncing allowance is NEVER reported as exhausted", async () => {
    const syncing = {
      generation: GENERATION,
      subscribed: false,
      remaining: 0,
      syncing: true,
    };
    const source = await resolveFeeSource(inputs({ state: syncing }));
    expect(source).toEqual({ kind: "blocked", reason: "sync-pending" });
    // The distinction that matters: retryable, not a dead end.
    expect(source).not.toEqual({ kind: "blocked", reason: "exhausted" });
  });

  test("a full day blocks with no-seats rather than claiming an invalid seat", async () => {
    const source = await resolveFeeSource(
      inputs({
        state: {
          generation: GENERATION,
          subscribed: false,
          remaining: 0,
          syncing: false,
        },
        findFreeSeat: async () => null,
      }),
    );
    expect(source).toEqual({ kind: "blocked", reason: "no-seats" });
  });

  test("a generation held past midnight is caught as rollover, not attempted", async () => {
    const source = await resolveFeeSource(
      inputs({ chainTimestampSeconds: NOW + SECONDS_PER_DAY }),
    );
    expect(source).toEqual({ kind: "blocked", reason: "rollover" });
  });

  test("an empty paymaster degrades to self-pay instead of failing to prove", async () => {
    const source = await resolveFeeSource(
      inputs({ paymasterBalance: 0n, ownBalance: 10n ** 19n }),
    );
    expect(source).toEqual({ kind: "self" });
  });
});

describe("awaitAllowanceTransition", () => {
  test("returns as soon as the expected count appears", async () => {
    let calls = 0;
    const result = await awaitAllowanceTransition({
      readState: async () => {
        calls += 1;
        return calls < 3
          ? { subscribed: false, remaining: 0 }
          : { subscribed: true, remaining: 4 };
      },
      expectedRemaining: 4,
      sleep: async () => {},
    });
    expect(result.syncing).toBe(false);
    expect(result.remaining).toBe(4);
  });

  test("treats the note disappearing as the expected end of the allowance", async () => {
    const result = await awaitAllowanceTransition({
      readState: async () => ({ subscribed: false, remaining: 0 }),
      expectedRemaining: 0,
      sleep: async () => {},
    });
    // Absence is the signal here, not a timeout.
    expect(result.syncing).toBe(false);
    expect(result.subscribed).toBe(false);
  });

  test("a timeout reports syncing rather than inventing an answer", async () => {
    let clock = 0;
    const result = await awaitAllowanceTransition({
      readState: async () => ({ subscribed: false, remaining: 0 }),
      expectedRemaining: 4,
      timeoutMs: 1_000,
      now: () => (clock += 400),
      sleep: async () => {},
    });
    expect(result.syncing).toBe(true);
  });
});
