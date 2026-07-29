/**
 * The deploy-time config validation. A paymaster's policy is immutable, so a
 * config that passes here yet deploys something dangerous is expensive — these
 * tests pin the guards that a codex review found missing.
 */
import { describe, expect, test } from "vitest";
import {
  parseQuotaFpcConfig,
  QuotaFpcConfigError,
} from "../../../contracts/fpc/config/schema.js";

const TARGET = `0x${"1".repeat(64)}`;

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "test",
    policy: { maxFeeWei: "1000", maxUsesPerDay: 10, maxUsersPerDay: 10 },
    maxLossWei: "1000000000",
    allowedTargets: [{ name: "T", address: TARGET }],
    ...overrides,
  };
}

describe("config validation", () => {
  test("a sane config parses", () => {
    expect(() => parseQuotaFpcConfig(base())).not.toThrow();
  });

  test("the loss cap accounts for the ~3 generations spendable around rollover", () => {
    // per-generation worst case = 1000 x 10 x 10 = 100_000; x3 = 300_000.
    const overrides = { maxLossWei: "250000" }; // above 1x, below 3x
    expect(() => parseQuotaFpcConfig(base(overrides))).toThrow(/3 x maxFee/);
    // 300_000 exactly is accepted.
    expect(() =>
      parseQuotaFpcConfig(base({ maxLossWei: "300000" })),
    ).not.toThrow();
  });

  test("values beyond the contract's integer widths are rejected", () => {
    expect(() =>
      parseQuotaFpcConfig(
        base({
          policy: {
            maxFeeWei: (2n ** 128n).toString(),
            maxUsesPerDay: 1,
            maxUsersPerDay: 1,
          },
        }),
      ),
    ).toThrow(/maximum/);
    expect(() =>
      parseQuotaFpcConfig(
        base({
          policy: {
            maxFeeWei: "1000",
            maxUsesPerDay: 2 ** 32,
            maxUsersPerDay: 1,
          },
        }),
      ),
    ).toThrow(/u32 maximum/);
  });

  test("a named zero-address target is rejected, not silently dropped", () => {
    expect(() =>
      parseQuotaFpcConfig(
        base({
          allowedTargets: [
            { name: "Real", address: TARGET },
            { name: "Oops", address: `0x${"0".repeat(64)}` },
          ],
        }),
      ),
    ).toThrow(/zero address/);
  });

  test("errors are QuotaFpcConfigError, so callers can distinguish them", () => {
    try {
      parseQuotaFpcConfig(base({ maxLossWei: "1" }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaFpcConfigError);
    }
  });
});
