/**
 * Connection config: user-overridable node URL and indexer bootstrap URL.
 * Reads from localStorage first; falls back to env (VITE_*) when not set.
 * Used so users can configure blockchain and indexer links before entering the game.
 */

import {
  getIndexerBootstrapUrl,
  getNodeUrl,
  getProverUrl,
  getSponsoredFpcAddressFromEnv,
} from "./env";

const STORAGE_KEY_NODE_URL = "dfpunk:connection:nodeUrl";
const STORAGE_KEY_INDEXER_BOOTSTRAP_URL =
  "dfpunk:connection:indexerBootstrapUrl";
const STORAGE_KEY_PROVER_URL = "dfpunk:connection:proverUrl";
const STORAGE_KEY_SPONSORED_FPC_ADDRESS =
  "dfpunk:connection:sponsoredFpcAddress";

export interface ConnectionOverrides {
  nodeUrl?: string;
  /** null = explicitly no indexer; undefined = use env default */
  indexerBootstrapUrl?: string | null;
  proverUrl?: string;
  /**
   * SponsoredFPC Aztec address override for sponsor mode.
   * Empty string clears local override (falls back to env / default derivation).
   */
  sponsoredFpcAddress?: string | null;
}

/**
 * Effective Aztec node URL: user override from localStorage, else env default.
 */
export function getEffectiveNodeUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEY_NODE_URL);
  if (stored !== null && stored.length > 0) return stored;
  return getNodeUrl();
}

/**
 * Effective indexer bootstrap URL: user override from localStorage, else env default.
 * If the key exists and is empty string, returns undefined (no bootstrap).
 */
export function getEffectiveIndexerBootstrapUrl(): string | undefined {
  const key = STORAGE_KEY_INDEXER_BOOTSTRAP_URL;
  const stored = localStorage.getItem(key);
  if (stored === null) return getIndexerBootstrapUrl();
  return stored.length > 0 ? stored : undefined;
}

/**
 * Effective accelerator prover URL: user override from localStorage, else env default.
 */
export function getEffectiveProverUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEY_PROVER_URL);
  if (stored !== null && stored.length > 0) return stored;
  return getProverUrl();
}

/**
 * Effective SponsoredFPC address string for sponsor mode: localStorage override,
 * else `VITE_SPONSORED_FPC_ADDRESS`, else undefined (WalletManager derives canonical address from salt).
 */
export function getEffectiveSponsoredFpcAddressOverride(): string | undefined {
  const stored = localStorage.getItem(STORAGE_KEY_SPONSORED_FPC_ADDRESS);
  if (stored !== null && stored.trim().length > 0) return stored.trim();
  return getSponsoredFpcAddressFromEnv();
}

/**
 * Write user overrides to localStorage. Empty string clears override (use env).
 * Call from connection settings UI.
 */
export function setConnectionOverrides(overrides: ConnectionOverrides): void {
  if (overrides.nodeUrl !== undefined) {
    if (overrides.nodeUrl.length > 0) {
      localStorage.setItem(STORAGE_KEY_NODE_URL, overrides.nodeUrl);
    } else {
      localStorage.removeItem(STORAGE_KEY_NODE_URL);
    }
  }
  if (overrides.indexerBootstrapUrl !== undefined) {
    if (
      overrides.indexerBootstrapUrl === null ||
      overrides.indexerBootstrapUrl === ""
    ) {
      // Persist explicit "no indexer" choice so we don't fall back to env default.
      localStorage.setItem(STORAGE_KEY_INDEXER_BOOTSTRAP_URL, "");
    } else {
      localStorage.setItem(
        STORAGE_KEY_INDEXER_BOOTSTRAP_URL,
        overrides.indexerBootstrapUrl
      );
    }
  }
  if (overrides.proverUrl !== undefined) {
    if (overrides.proverUrl.length > 0) {
      localStorage.setItem(STORAGE_KEY_PROVER_URL, overrides.proverUrl);
    } else {
      localStorage.removeItem(STORAGE_KEY_PROVER_URL);
    }
  }
  if (overrides.sponsoredFpcAddress !== undefined) {
    if (
      overrides.sponsoredFpcAddress === null ||
      overrides.sponsoredFpcAddress.trim() === ""
    ) {
      localStorage.removeItem(STORAGE_KEY_SPONSORED_FPC_ADDRESS);
    } else {
      localStorage.setItem(
        STORAGE_KEY_SPONSORED_FPC_ADDRESS,
        overrides.sponsoredFpcAddress.trim()
      );
    }
  }
}

/**
 * Read current overrides from localStorage for form display.
 * Keys not present => undefined (use env). Empty string for indexer => explicitly no bootstrap.
 */
export function getConnectionOverrides(): ConnectionOverrides {
  const nodeStored = localStorage.getItem(STORAGE_KEY_NODE_URL);
  const indexerStored = localStorage.getItem(STORAGE_KEY_INDEXER_BOOTSTRAP_URL);
  const proverStored = localStorage.getItem(STORAGE_KEY_PROVER_URL);
  const sponsoredStored = localStorage.getItem(
    STORAGE_KEY_SPONSORED_FPC_ADDRESS
  );
  return {
    nodeUrl: nodeStored !== null ? nodeStored : undefined,
    indexerBootstrapUrl:
      indexerStored === null
        ? undefined
        : indexerStored.length > 0
          ? indexerStored
          : null,
    proverUrl: proverStored !== null ? proverStored : undefined,
    sponsoredFpcAddress: sponsoredStored !== null ? sponsoredStored : undefined,
  };
}
