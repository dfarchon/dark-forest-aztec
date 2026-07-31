/**
 * The deploy-time config validation. The policy is retunable after deploy
 * (12h delay), but the admin address and the account-class rules are
 * constructor immutables — a config that passes here yet deploys something
 * dangerous is still expensive. These tests pin the guards audits found
 * missing.
 */
import { describe, expect, test } from "vitest";
import {
  parseQuotaFpcConfig,
  QuotaFpcConfigError,
} from "../../../contracts/fpc/config/schema.js";

const TARGET = `0x${"1".repeat(64)}`;
const CLASS_ID = `0x${"2".repeat(64)}`;
// Must be BELOW the BN254 modulus to be a real address; 0x33..33 is not.
const ADMIN = `0x0${"3".repeat(63)}`;

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "test",
    policy: { maxFeeWei: "1000", maxUsesPerDay: 10, maxUsersPerDay: 10 },
    maxLossWei: "1000000000",
    allowedTargets: [{ name: "T", address: TARGET }],
    allowedAccountClasses: [{ name: "C", classId: CLASS_ID }],
    adminAddress: ADMIN,
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

  test("account classes: absent, zero, out-of-field, and duplicate are rejected", () => {
    // Absent or empty would sponsor ANY account contract — the C1 hole.
    expect(() =>
      parseQuotaFpcConfig(base({ allowedAccountClasses: [] })),
    ).toThrow(/at least one account class/);
    // Zero is the contract's empty-slot marker: a named class resolving to it
    // would be silently dropped.
    expect(() =>
      parseQuotaFpcConfig(
        base({
          allowedAccountClasses: [
            { name: "Z", classId: `0x${"0".repeat(64)}` },
          ],
        }),
      ),
    ).toThrow(/zero/);
    // At/above the field modulus the on-chain value would differ from config.
    expect(() =>
      parseQuotaFpcConfig(
        base({
          allowedAccountClasses: [
            { name: "F", classId: `0x${"f".repeat(64)}` },
          ],
        }),
      ),
    ).toThrow(/field element/);
    // Same id twice is always a config mistake.
    expect(() =>
      parseQuotaFpcConfig(
        base({
          allowedAccountClasses: [
            { name: "A", classId: CLASS_ID },
            { name: "B", classId: CLASS_ID },
          ],
        }),
      ),
    ).toThrow(/twice/);
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

  test("the unpublished-account requirement defaults ON and rejects non-booleans", () => {
    // Absent must mean ON: without it the class allowlist binds only the
    // account's original class, and a published account can upgrade away from
    // it. A config that forgets the field must get the safe posture.
    expect(parseQuotaFpcConfig(base()).requireUnpublishedAccounts).toBe(true);
    expect(
      parseQuotaFpcConfig(base({ requireUnpublishedAccounts: false }))
        .requireUnpublishedAccounts,
    ).toBe(false);
    expect(() =>
      parseQuotaFpcConfig(base({ requireUnpublishedAccounts: "yes" })),
    ).toThrow(/must be a boolean/);
  });

  test("adminAddress: absent, zero, malformed, and unresolved env are rejected; env: resolves", () => {
    // The admin is immutable with no transfer — a config without one, or with
    // a zero one, deploys a contract whose updates are permanently bricked.
    expect(() =>
      parseQuotaFpcConfig(base({ adminAddress: undefined })),
    ).toThrow(/adminAddress is required/);
    expect(() =>
      parseQuotaFpcConfig(base({ adminAddress: `0x${"0".repeat(64)}` })),
    ).toThrow(/zero address/);
    expect(() => parseQuotaFpcConfig(base({ adminAddress: "0x1234" }))).toThrow(
      /32-byte/,
    );
    // Valid-looking hex that is not a field element would silently resolve to a
    // DIFFERENT account on deploy — and the admin cannot be transferred.
    expect(() =>
      parseQuotaFpcConfig(base({ adminAddress: `0x${"f".repeat(64)}` })),
    ).toThrow(/field element/);
    // env: indirection is explicit, never a fallback: unset var = error.
    expect(() =>
      parseQuotaFpcConfig(base({ adminAddress: "env:MISSING_ADMIN" }), {}),
    ).toThrow(/set MISSING_ADMIN/);
    expect(
      parseQuotaFpcConfig(base({ adminAddress: "env:MY_ADMIN" }), {
        MY_ADMIN: ADMIN,
      }).adminAddress,
    ).toBe(ADMIN);
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
