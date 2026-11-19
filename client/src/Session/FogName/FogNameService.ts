/**
 * Presentation-only Dark Forest `.fog` name host service (`fog-sdk/read` for reads,
 * lazy `fog-sdk` for burner-scoped primary writes).
 *
 * Verifies network/rollup/registry identity before resolving batched visible addresses
 * (`<= 64` per shared snapshot, `concurrency <= 8`, `30s` non-overlapping foreground refresh,
 * `15s` fail-closed read watchdog) and executes `setPrimary` / `clearPrimary` exclusively
 * with the active local burner account.
 */

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import type { AztecNode } from "@aztec-labs/aztec.js/node";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
import { type Monomitter, monomitter } from "@dfpunk/events";
import type { FogContext } from "fog-sdk";
import {
  type BatchEntry,
  FogError,
  formatName,
  type Label,
  labelFromCanonical,
  NAME_SUFFIX,
  normalizeName,
  RegistryReader,
  resolvePrimary,
  resolvePrimaryMany,
  toFogError,
} from "fog-sdk/read";

export { FogError };

export const FOG_NAMESERVER_URL = "https://fog-testnet.huantian233.workers.dev";

const FOG_DEPLOYMENT = {
  chainId: 11155111n,
  chainIdString: "11155111",
  rollupVersion: 679261766n,
  rollupVersionString: "679261766",
  l1Rollup: "0x1f435a7f2da358caf887a470faeee7d5d5f4efba",
  registry:
    "0x2d4dcccfab0afa50d15d4ec3fd7c3ef4beac112a0379bb51102ffd8a18969bd7",
  sponsoredFpc:
    "0x2d8fff82a3b0c15d0a89169e7d8d043e079ab94d52031f1de1e4972ebad169d3",
} as const;

const REFRESH_INTERVAL_MS = 30_000;
const READ_WATCHDOG_MS = 15_000;
const MAX_VISIBLE_ADDRESSES = 64;
const RESOLVE_CONCURRENCY = 8;
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

/** Normalizes user input as a root `.fog` name; subnames are rejected. */
export function normalizeRootFogName(input: string): Label {
  const label = normalizeName(input, {
    suffix: NAME_SUFFIX,
    allowSubnames: false,
  });
  if (label.parent !== undefined || label.label.includes(".")) {
    throw new FogError(
      "invalid_name",
      "subnames are not supported for Dark Forest player names"
    );
  }
  return label;
}

function formatVerifiedRootPrimary(canonicalName: string): string | undefined {
  if (!canonicalName || canonicalName.includes(".")) return undefined;
  try {
    const validated = labelFromCanonical(canonicalName);
    if (validated.parent !== undefined || validated.label.includes(".")) {
      return undefined;
    }
    return formatName(validated);
  } catch {
    return undefined;
  }
}

function parseNonZeroAztecAddress(
  raw: string | undefined | null
): AztecAddress | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!HEX_ADDRESS_RE.test(trimmed)) return undefined;
  try {
    const address = AztecAddress.fromStringUnsafe(trimmed);
    return address.isZero() ? undefined : address;
  } catch {
    return undefined;
  }
}

function requireNonZeroAztecAddress(
  raw: string,
  field = "address"
): AztecAddress {
  const parsed = parseNonZeroAztecAddress(raw);
  if (!parsed) {
    throw new FogError("wrong_deployment", `Invalid Aztec ${field}: ${raw}`);
  }
  return parsed;
}

function canonicalizeAddressKey(
  raw: string | undefined | null
): string | undefined {
  return parseNonZeroAztecAddress(raw)?.toString();
}

/** Compares two Aztec or EVM addresses canonically (whitespace- and case-insensitive). */
export function addressesEqual(
  a: string | undefined,
  b: string | undefined
): boolean {
  if (!a || !b) return false;
  const normA = canonicalizeAddressKey(a) ?? a.trim().toLowerCase();
  const normB = canonicalizeAddressKey(b) ?? b.trim().toLowerCase();
  return normA === normB;
}

export type FogNameAvailability =
  | "idle"
  | "ready"
  | "network_mismatch"
  | "error";

export interface ActiveAccountPrimaryState {
  readonly status:
    | "unknown"
    | "verified"
    | "none"
    | "stale"
    | "label_unavailable"
    | "error";
  readonly formattedName?: string;
  readonly canonicalLabel?: string;
  readonly reason?: string;
}

export interface FogNameServiceState {
  readonly availability: FogNameAvailability;
  readonly activeBurnerAddress?: string;
  readonly writesEnabled: boolean;
  readonly writesDisabledReason?: string;
  readonly statusMessage?: string;
  readonly verifiedNames: ReadonlyMap<string, string>;
  readonly activePrimary: ActiveAccountPrimaryState;
}

export interface BurnerWalletSession {
  readonly wallet: Wallet;
  readonly account: AztecAddress;
  readonly isBurner: boolean;
  readonly useSponsoredFpc: boolean;
  readonly sponsoredFpcAddress?: AztecAddress;
}

export interface FogNameWriteOutcome {
  readonly txHash: string;
  readonly formattedName?: string;
}

export type InspectableAztecNode = AztecNode & {
  getL1ContractAddresses?: () => Promise<{
    rollupAddress?: { toString(): string };
  }>;
};

export interface FogNameServiceOptions {
  readonly getNode: () => InspectableAztecNode | undefined;
  readonly getActiveAddress: () => string | undefined;
  readonly getBurnerSession: () => BurnerWalletSession | undefined;
}

const INITIAL_PRIMARY: ActiveAccountPrimaryState = { status: "unknown" };

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

async function readNodeL1Rollup(
  node: InspectableAztecNode
): Promise<string | undefined> {
  const info = (await node.getNodeInfo()) as {
    l1ContractAddresses?: { rollupAddress?: { toString(): string } };
  };
  const fromInfo = info?.l1ContractAddresses?.rollupAddress?.toString();
  if (fromInfo) return fromInfo;
  if (typeof node.getL1ContractAddresses === "function") {
    const l1 = await node.getL1ContractAddresses();
    return l1?.rollupAddress?.toString();
  }
  return undefined;
}

export class FogNameService {
  public readonly state$: Monomitter<FogNameServiceState>;

  private readonly opts: FogNameServiceOptions;
  private readonly observedCounts = new Map<string, number>();
  private readonly onVisibilityChange: () => void;
  private cachedReader?: { node: InspectableAztecNode; reader: RegistryReader };
  private state: FogNameServiceState;
  private epoch = 0;
  private destroyed = false;
  private rerunRequested = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private activePoll: {
    promise: Promise<void>;
    timedOut: boolean;
    clearWatchdog: () => void;
  } | null = null;

  public constructor(opts: FogNameServiceOptions) {
    this.opts = opts;
    this.state = {
      availability: "idle",
      activeBurnerAddress: this.getActiveBurnerAddress(),
      writesEnabled: false,
      writesDisabledReason: "Fog network verification has not completed yet.",
      verifiedNames: new Map(),
      activePrimary: INITIAL_PRIMARY,
    };
    this.state$ = monomitter<FogNameServiceState>(true);
    this.state$.publish(this.state);

    this.onVisibilityChange = () => {
      if (this.destroyed) return;
      if (isDocumentHidden()) {
        this.clearScheduledTimer();
      } else {
        void this.refreshNow();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  public getState(): FogNameServiceState {
    return this.state;
  }

  public getActiveBurnerAddress(): string | undefined {
    const session = this.opts.getBurnerSession();
    return session?.isBurner ? session.account.toString() : undefined;
  }

  public getVerifiedName(
    address: string | undefined | null
  ): string | undefined {
    const key = canonicalizeAddressKey(address);
    return key ? this.state.verifiedNames.get(key) : undefined;
  }

  public observeAddress(address: string | undefined | null): () => void {
    const key = canonicalizeAddressKey(address);
    if (!key || this.destroyed) return () => {};
    const prev = this.observedCounts.get(key) ?? 0;
    this.observedCounts.set(key, prev + 1);
    if (
      prev === 0 &&
      !this.state.verifiedNames.has(key) &&
      !isDocumentHidden()
    ) {
      this.schedulePoll(0);
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const count = this.observedCounts.get(key) ?? 0;
      if (count <= 1) this.observedCounts.delete(key);
      else this.observedCounts.set(key, count - 1);
    };
  }

  public notifyContextChanged(opts?: { resetNetwork?: boolean }): void {
    if (this.destroyed) return;
    this.epoch += 1;
    if (opts?.resetNetwork) this.cachedReader = undefined;
    this.clearScheduledTimer();
    const availability = opts?.resetNetwork ? "idle" : this.state.availability;
    const gate = this.computeWriteGate(availability);
    this.publishState({
      availability,
      writesEnabled: gate.enabled,
      writesDisabledReason: gate.reason,
      statusMessage: opts?.resetNetwork ? undefined : this.state.statusMessage,
      verifiedNames: new Map(),
      activePrimary: INITIAL_PRIMARY,
    });
    if (!isDocumentHidden()) void this.refreshNow();
  }

  public refreshNow(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.clearScheduledTimer();

    if (this.activePoll) {
      this.rerunRequested = true;
      return this.activePoll.timedOut
        ? Promise.resolve()
        : this.activePoll.promise;
    }

    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    const clearWatchdog = () => {
      if (watchdogTimer !== undefined) {
        clearTimeout(watchdogTimer);
        watchdogTimer = undefined;
      }
    };

    const record = {
      promise: Promise.resolve(),
      timedOut: false,
      clearWatchdog,
    };

    watchdogTimer = setTimeout(() => {
      watchdogTimer = undefined;
      if (this.destroyed || this.activePoll !== record) return;
      record.timedOut = true;
      this.epoch += 1;
      const msg = `Fog read timed out after ${READ_WATCHDOG_MS}ms; cleared cached names until connection recovers.`;
      this.publishState({
        availability: "error",
        writesEnabled: false,
        writesDisabledReason: this.computeWriteGate("error").reason,
        statusMessage: msg,
        verifiedNames: new Map(),
        activePrimary: { status: "error", reason: msg },
      });
    }, READ_WATCHDOG_MS);

    record.promise = this.executePollPass(() => record.timedOut)
      .catch(() => {})
      .finally(() => {
        clearWatchdog();
        if (this.activePoll === record) this.activePoll = null;
        if (this.destroyed || isDocumentHidden()) {
          this.rerunRequested = false;
          return;
        }
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.schedulePoll(0);
        } else {
          this.schedulePoll(REFRESH_INTERVAL_MS);
        }
      });

    this.activePoll = record;
    return record.promise;
  }

  public async confirmPrimary(
    rawInput: string,
    expectedBurnerAddress?: string
  ): Promise<FogNameWriteOutcome> {
    const label = normalizeRootFogName(rawInput);
    const formattedName = formatName(label);
    return this.withBurnerFogContext(
      expectedBurnerAddress,
      async (sdk, ctx) => {
        const res = await sdk.setPrimary(ctx, {
          name: label,
          acceptUnverifiedResolver: false,
        });
        return { txHash: res.tx.txHash, formattedName };
      }
    );
  }

  public async clearAccountPrimary(
    expectedBurnerAddress?: string
  ): Promise<FogNameWriteOutcome> {
    return this.withBurnerFogContext(
      expectedBurnerAddress,
      async (sdk, ctx) => {
        const res = await sdk.clearPrimary(ctx);
        return { txHash: res.tx.txHash };
      }
    );
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.epoch += 1;
    this.clearScheduledTimer();
    this.activePoll?.clearWatchdog();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.observedCounts.clear();
    this.cachedReader = undefined;
    this.state$.clear();
  }

  private async withBurnerFogContext<T>(
    expectedBurnerAddress: string | undefined,
    run: (sdk: typeof import("fog-sdk"), ctx: FogContext) => Promise<T>
  ): Promise<T> {
    const session = this.requireBurnerSession(expectedBurnerAddress);
    const initialNode = this.opts.getNode();
    const reader = await this.ensureVerifiedReader();
    this.assertSessionUnchanged(session, initialNode);
    const sdk = await import("fog-sdk");
    this.assertSessionUnchanged(session, initialNode);

    const sponsoredFpc = session.useSponsoredFpc
      ? (session.sponsoredFpcAddress ??
        requireNonZeroAztecAddress(FOG_DEPLOYMENT.sponsoredFpc, "sponsoredFpc"))
      : undefined;

    const ctx = await sdk.connectFog(reader, {
      wallet: session.wallet,
      account: session.account,
      deployment: {
        registry: FOG_DEPLOYMENT.registry,
        chainId: FOG_DEPLOYMENT.chainIdString,
        rollupVersion: FOG_DEPLOYMENT.rollupVersionString,
      },
      sponsoredFpc,
    });
    this.assertSessionUnchanged(session, initialNode);

    const outcome = await run(sdk, ctx);
    if (!this.destroyed) {
      this.epoch += 1;
      const accountKey = session.account.toString();
      const activeKey = canonicalizeAddressKey(this.opts.getActiveAddress());
      const nextVerified = new Map(this.state.verifiedNames);
      nextVerified.delete(accountKey);
      this.publishState({
        ...this.state,
        verifiedNames: nextVerified,
        activePrimary:
          !activeKey || activeKey === accountKey
            ? INITIAL_PRIMARY
            : this.state.activePrimary,
      });
      void this.refreshNow();
    }
    return outcome;
  }

  private schedulePoll(delayMs: number): void {
    if (this.destroyed || isDocumentHidden() || this.activePoll) return;
    this.clearScheduledTimer();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      if (!this.destroyed && !isDocumentHidden()) void this.refreshNow();
    }, delayMs);
  }

  private clearScheduledTimer(): void {
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private collectPollAddresses(activeCanonical?: string): AztecAddress[] {
    const seen = new Set<string>();
    const out: AztecAddress[] = [];
    const pushKey = (key: string) => {
      if (seen.has(key) || out.length >= MAX_VISIBLE_ADDRESSES) return;
      seen.add(key);
      const parsed = parseNonZeroAztecAddress(key);
      if (parsed) out.push(parsed);
    };
    if (activeCanonical) pushKey(activeCanonical);
    for (const [key, count] of this.observedCounts.entries()) {
      if (count > 0) pushKey(key);
      if (out.length >= MAX_VISIBLE_ADDRESSES) break;
    }
    return out;
  }

  private async ensureVerifiedReader(): Promise<RegistryReader> {
    const node = this.opts.getNode();
    if (!node) {
      throw new FogError("network", "Aztec node connection is unavailable");
    }
    const l1Rollup = await readNodeL1Rollup(node);
    if (!l1Rollup || l1Rollup.toLowerCase() !== FOG_DEPLOYMENT.l1Rollup) {
      this.cachedReader = undefined;
      throw new FogError(
        "wrong_deployment",
        `L1 rollup mismatch: expected ${FOG_DEPLOYMENT.l1Rollup}, got ${l1Rollup ?? "unknown"}`
      );
    }
    if (this.cachedReader?.node === node) {
      if (this.cachedReader.reader.modular) {
        await this.cachedReader.reader.assertCurrentClass();
      }
      return this.cachedReader.reader;
    }
    const registry = requireNonZeroAztecAddress(
      FOG_DEPLOYMENT.registry,
      "registry"
    );
    const reader = await RegistryReader.connect(node, registry, {
      verifyClass: true,
    });
    if (
      reader.deployment.chainId !== FOG_DEPLOYMENT.chainId ||
      reader.deployment.rollupVersion !== FOG_DEPLOYMENT.rollupVersion ||
      reader.registry.toString().toLowerCase() !== FOG_DEPLOYMENT.registry
    ) {
      this.cachedReader = undefined;
      throw new FogError(
        "wrong_deployment",
        "Connected Fog registry does not match pinned testnet deployment."
      );
    }
    this.cachedReader = { node, reader };
    return reader;
  }

  private requireBurnerSession(expectedBurner?: string): BurnerWalletSession {
    if (this.destroyed) {
      throw new FogError("invalid_argument", "Fog session is closed.");
    }
    const session = this.opts.getBurnerSession();
    if (!session) {
      throw new FogError(
        "invalid_argument",
        "No active Dark Forest burner account is available."
      );
    }
    if (!session.isBurner) {
      throw new FogError(
        "unsupported",
        "In-game primary confirmation requires a local burner account; use the Fog Nameserver app for external wallets."
      );
    }
    if (expectedBurner !== undefined) {
      const expected = canonicalizeAddressKey(expectedBurner);
      if (!expected || session.account.toString() !== expected) {
        throw new FogError(
          "invalid_argument",
          "Active burner account changed before signing; please try again."
        );
      }
    }
    return session;
  }

  private assertSessionUnchanged(
    expected: BurnerWalletSession,
    expectedNode: InspectableAztecNode | undefined
  ): void {
    const current = this.requireBurnerSession(expected.account.toString());
    if (
      current.wallet !== expected.wallet ||
      this.opts.getNode() !== expectedNode
    ) {
      throw new FogError(
        "invalid_argument",
        "Wallet or node connection changed before signing; please retry."
      );
    }
  }

  private computeWriteGate(availability: FogNameAvailability): {
    enabled: boolean;
    reason?: string;
  } {
    if (availability === "network_mismatch") {
      return {
        enabled: false,
        reason: "Connected network does not match the pinned Fog deployment.",
      };
    }
    if (availability !== "ready") {
      return {
        enabled: false,
        reason: "Waiting for Fog network and registry verification.",
      };
    }
    const session = this.opts.getBurnerSession();
    if (!session) {
      return { enabled: false, reason: "No active burner account selected." };
    }
    if (!session.isBurner) {
      return {
        enabled: false,
        reason:
          "Use the external Fog Nameserver app to manage external wallet primaries.",
      };
    }
    return { enabled: true };
  }

  private toActivePrimaryState(
    entry: BatchEntry | undefined
  ): ActiveAccountPrimaryState {
    if (!entry) return INITIAL_PRIMARY;
    if (entry.status === "verified") {
      const formattedName = formatVerifiedRootPrimary(entry.name);
      return formattedName
        ? { status: "verified", canonicalLabel: entry.name, formattedName }
        : { status: "stale", reason: "subname_unsupported" };
    }
    if (entry.status === "none") return { status: "none" };
    if (entry.status === "stale") {
      return { status: "stale", reason: entry.reason };
    }
    if (entry.status === "label_unavailable") {
      return { status: "label_unavailable" };
    }
    return { status: "error", reason: entry.error.message };
  }

  private async executePollPass(isTimedOut: () => boolean): Promise<void> {
    const passEpoch = this.epoch;
    const isStale = () =>
      this.destroyed || isTimedOut() || passEpoch !== this.epoch;
    const activeCanonical = canonicalizeAddressKey(
      this.opts.getActiveAddress()
    );

    try {
      const reader = await this.ensureVerifiedReader();
      if (isStale()) return;
      const snapshot = await reader.snapshot();
      if (isStale()) return;

      const addresses = this.collectPollAddresses(activeCanonical);
      const batchResults =
        addresses.length > 0
          ? await resolvePrimaryMany(reader, addresses, {
              snapshot,
              concurrency: RESOLVE_CONCURRENCY,
            })
          : new Map<string, BatchEntry>();
      if (isStale()) return;

      const verifiedNames = new Map<string, string>();
      for (const [addrKey, entry] of batchResults.entries()) {
        if (entry.status === "verified") {
          const formatted = formatVerifiedRootPrimary(entry.name);
          if (formatted) verifiedNames.set(addrKey, formatted);
        }
      }

      let activePrimary: ActiveAccountPrimaryState = { status: "none" };
      if (activeCanonical) {
        let activeEntry = batchResults.get(activeCanonical);
        if (!activeEntry) {
          const parsedActive = parseNonZeroAztecAddress(activeCanonical);
          if (parsedActive) {
            try {
              activeEntry = await resolvePrimary(
                reader,
                parsedActive,
                snapshot
              );
            } catch (err) {
              activeEntry = { status: "error", error: toFogError(err) };
            }
          }
        }
        if (isStale()) return;
        activePrimary = this.toActivePrimaryState(activeEntry);
      }

      const gate = this.computeWriteGate("ready");
      this.publishState({
        availability: "ready",
        writesEnabled: gate.enabled,
        writesDisabledReason: gate.reason,
        statusMessage: undefined,
        verifiedNames,
        activePrimary,
      });
    } catch (err) {
      if (isStale()) return;
      const fogErr = toFogError(err);
      const availability: FogNameAvailability =
        fogErr.code === "wrong_deployment" || fogErr.code === "unsupported"
          ? "network_mismatch"
          : "error";
      if (availability === "network_mismatch") this.cachedReader = undefined;
      this.publishState({
        availability,
        writesEnabled: false,
        writesDisabledReason: this.computeWriteGate(availability).reason,
        statusMessage: fogErr.message,
        verifiedNames: new Map(),
        activePrimary: { status: "error", reason: fogErr.message },
      });
    }
  }

  private publishState(
    next: Omit<FogNameServiceState, "activeBurnerAddress">
  ): void {
    this.state = {
      ...next,
      activeBurnerAddress: this.getActiveBurnerAddress(),
    };
    this.state$.publish(this.state);
  }
}
