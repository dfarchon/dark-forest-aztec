/**
 * Connection config: user-overridable node URL and indexer bootstrap URL.
 * Reads from localStorage first; falls back to env (VITE_*) when not set.
 * Used so users can configure blockchain and indexer links before entering the game.
 */

import { getIndexerBootstrapUrl, getNodeUrl, getProverUrl } from "./env";

const STORAGE_KEY_NODE_URL = "dfpunk:connection:nodeUrl";
const STORAGE_KEY_INDEXER_BOOTSTRAP_URL =
  "dfpunk:connection:indexerBootstrapUrl";
const STORAGE_KEY_PROVER_URL = "dfpunk:connection:proverUrl";

export interface ConnectionOverrides {
  nodeUrl?: string;
  /** null = explicitly no indexer; undefined = use env default */
  indexerBootstrapUrl?: string | null;
  proverUrl?: string;
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
}

/**
 * Read current overrides from localStorage for form display.
 * Keys not present => undefined (use env). Empty string for indexer => explicitly no bootstrap.
 */
export function getConnectionOverrides(): ConnectionOverrides {
  const nodeStored = localStorage.getItem(STORAGE_KEY_NODE_URL);
  const indexerStored = localStorage.getItem(STORAGE_KEY_INDEXER_BOOTSTRAP_URL);
  const proverStored = localStorage.getItem(STORAGE_KEY_PROVER_URL);
  return {
    nodeUrl: nodeStored !== null ? nodeStored : undefined,
    indexerBootstrapUrl:
      indexerStored === null
        ? undefined
        : indexerStored.length > 0
          ? indexerStored
          : null,
    proverUrl: proverStored !== null ? proverStored : undefined,
  };
}
