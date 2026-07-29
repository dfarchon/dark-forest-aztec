/**
 * Config schema for the QuotaFpc paymaster.
 *
 * The Noir contract is app-agnostic: every application-specific value lives in
 * a JSON config validated here. Forking the paymaster for another app means
 * writing one of these files — no contract changes.
 */

/** Maximum allowlist entries, must match MAX_ALLOWED_TARGETS in the contract. */
export const MAX_ALLOWED_TARGETS = 12;

/** Maximum calls in an account entrypoint payload (aztec-nr ACCOUNT_MAX_CALLS). */
export const ACCOUNT_MAX_CALLS = 5;

export interface QuotaFpcPolicy {
  /**
   * Ceiling on what the paymaster will pay for a single transaction, in fee
   * juice wei. Asserted during private setup, so an over-budget transaction
   * cannot even be proven. Size it from measured costs times a headroom
   * multiplier — network base fees float, and a transaction that no longer fits
   * this ceiling simply falls back to the user paying.
   */
  maxFeeWei: string;
  /** Sponsored transactions per user per day. */
  maxUsesPerDay: number;
  /** Distinct users sponsored per day. */
  maxUsersPerDay: number;
}

export interface QuotaFpcTarget {
  /** Human label, used in logs and errors. */
  name: string;
  /**
   * Deployed address of a sponsored contract, or the name of an env var
   * holding it (prefix `env:`), so configs can avoid hardcoding addresses.
   */
  address: string;
}

export interface QuotaFpcConfig {
  /** Identifier for this deployment, e.g. "dark-forest-mainnet". */
  name: string;
  /** Free-text note shown in deploy output — what this instance sponsors. */
  description?: string;
  policy: QuotaFpcPolicy;
  /** Contracts whose calls this paymaster will sponsor. */
  allowedTargets: QuotaFpcTarget[];
  /**
   * Total the operator is willing to lose, in fee juice wei. The deploy script
   * refuses to fund beyond this — the paymaster has no withdraw, so this is the
   * real budget control.
   */
  maxLossWei: string;
}

export class QuotaFpcConfigError extends Error {}

/** The contract's u128 fields cannot hold more than this. */
const U128_MAX = 2n ** 128n - 1n;
/** The contract's u32 fields cannot hold more than this. */
const U32_MAX = 2 ** 32 - 1;

function requirePositiveBigint(value: string, field: string, max: bigint): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new QuotaFpcConfigError(`${field} must be an integer string, got ${JSON.stringify(value)}`);
  }
  if (parsed <= 0n) {
    throw new QuotaFpcConfigError(`${field} must be greater than zero, got ${value}`);
  }
  // The contract's field would silently wrap or the deploy would fail late; a
  // value this large is always a mistake, so reject it here with the reason.
  if (parsed > max) {
    throw new QuotaFpcConfigError(`${field} exceeds the contract's maximum (${max}), got ${value}`);
  }
  return parsed;
}

function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new QuotaFpcConfigError(`${field} must be a positive integer, got ${value}`);
  }
  if (value > U32_MAX) {
    throw new QuotaFpcConfigError(`${field} exceeds the contract's u32 maximum (${U32_MAX}), got ${value}`);
  }
  return value;
}

/**
 * Validates a config and resolves any `env:` target addresses.
 * Throws QuotaFpcConfigError with an actionable message on any problem —
 * misconfiguring a paymaster that cannot be corrected after deploy is expensive.
 */
export function parseQuotaFpcConfig(
  raw: unknown,
  env: Record<string, string | undefined> = process.env,
): QuotaFpcConfig & { resolvedTargets: { name: string; address: string }[] } {
  if (typeof raw !== "object" || raw === null) {
    throw new QuotaFpcConfigError("Config must be a JSON object");
  }
  const config = raw as QuotaFpcConfig;

  if (!config.name?.trim()) {
    throw new QuotaFpcConfigError("name is required");
  }
  if (!config.policy) {
    throw new QuotaFpcConfigError("policy is required");
  }

  const maxFee = requirePositiveBigint(config.policy.maxFeeWei, "policy.maxFeeWei", U128_MAX);
  const maxUses = requirePositiveInt(config.policy.maxUsesPerDay, "policy.maxUsesPerDay");
  const maxUsers = requirePositiveInt(config.policy.maxUsersPerDay, "policy.maxUsersPerDay");
  const maxLoss = requirePositiveBigint(config.maxLossWei, "maxLossWei", U128_MAX * BigInt(U32_MAX) * BigInt(U32_MAX));

  if (!Array.isArray(config.allowedTargets) || config.allowedTargets.length === 0) {
    throw new QuotaFpcConfigError("allowedTargets must list at least one contract");
  }
  if (config.allowedTargets.length > MAX_ALLOWED_TARGETS) {
    throw new QuotaFpcConfigError(
      `allowedTargets holds ${config.allowedTargets.length} entries, but the contract allows ${MAX_ALLOWED_TARGETS}`,
    );
  }

  const resolvedTargets = config.allowedTargets.map((target, index) => {
    if (!target?.name?.trim()) {
      throw new QuotaFpcConfigError(`allowedTargets[${index}].name is required`);
    }
    const raw = target.address?.trim();
    if (!raw) {
      throw new QuotaFpcConfigError(`allowedTargets[${index}] (${target.name}) needs an address`);
    }
    const address = raw.startsWith("env:") ? env[raw.slice(4)]?.trim() : raw;
    if (!address) {
      throw new QuotaFpcConfigError(
        `allowedTargets[${index}] (${target.name}) resolves to nothing: set ${raw.slice(4)}`,
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(address)) {
      throw new QuotaFpcConfigError(
        `allowedTargets[${index}] (${target.name}) is not a 32-byte address: ${address}`,
      );
    }
    // The zero address is the contract's "empty slot" marker; a named target
    // that resolves to it would be silently dropped from the allowlist.
    if (/^0x0+$/.test(address)) {
      throw new QuotaFpcConfigError(
        `allowedTargets[${index}] (${target.name}) is the zero address, which the contract treats as an empty slot`,
      );
    }
    return { name: target.name, address };
  });

  const seen = new Map<string, string>();
  for (const target of resolvedTargets) {
    const previous = seen.get(target.address.toLowerCase());
    if (previous) {
      throw new QuotaFpcConfigError(
        `allowedTargets lists ${target.address} twice (${previous} and ${target.name})`,
      );
    }
    seen.set(target.address.toLowerCase(), target.name);
  }

  // Worst case a single UTC day can cost, versus what the operator accepts
  // losing. NOTE the 3x: around a rollover, a stale-but-valid anchor can spend
  // the previous generation, current anchors the current one, and the last 600s
  // grace window the next — up to three generations chargeable within one day.
  // (See the freshness logic in the contract.) Surfaced as a hard error because
  // there is no withdraw, so this bound is the operator's real exposure.
  //
  // This is validation only. It does NOT cap on-chain spending — the contract
  // has no such limit — so the paymaster's *balance* remains the ultimate cap.
  // Fund in tranches accordingly.
  const perGeneration = maxFee * BigInt(maxUses) * BigInt(maxUsers);
  const worstCasePerDay = perGeneration * 3n;
  if (worstCasePerDay > maxLoss) {
    throw new QuotaFpcConfigError(
      `Policy allows up to ${worstCasePerDay} wei/day (3 x maxFee x maxUses x maxUsers, for the ~3 generations ` +
        `spendable around a rollover) but maxLossWei is ${maxLoss}. Lower the policy or raise the loss budget ` +
        `deliberately — funds sent to the paymaster cannot be recovered, and the balance is the only real cap.`,
    );
  }

  return { ...config, resolvedTargets };
}

/** Pads the allowlist to the contract's fixed-size array with zero addresses. */
export function padAllowedTargets(addresses: string[]): string[] {
  if (addresses.length > MAX_ALLOWED_TARGETS) {
    throw new QuotaFpcConfigError(`Too many targets: ${addresses.length} > ${MAX_ALLOWED_TARGETS}`);
  }
  const zero = `0x${"0".repeat(64)}`;
  return [...addresses, ...Array(MAX_ALLOWED_TARGETS - addresses.length).fill(zero)];
}
