/**
 * Client env config: reads VITE_* from import.meta.env with defaults.
 * Used for node URL, indexer bootstrap, and default setting behavior (VITE_APP_MODE).
 */

const DEFAULT_NODE_URL = "http://localhost:8080";

/** Default indexer bootstrap URL (devnet server) when VITE_INDEXER_BOOTSTRAP_URL is unset in devnet builds. */
const DEFAULT_INDEXER_BOOTSTRAP_URL =
  "https://server-production-b4e5.up.railway.app";

function getString(key: string): string | undefined {
  const value = import.meta.env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

/**
 * Aztec node URL. Defaults to http://localhost:8080 when unset or empty.
 */
export function getNodeUrl(): string {
  return getString("VITE_AZTEC_NODE_URL") ?? DEFAULT_NODE_URL;
}

/**
 * Optional off-chain indexer API base URL for bootstrap snapshot.
 * When undefined, client syncs from node starting at START_BLOCK.
 * In devnet builds, defaults to the devnet server when env is unset.
 */
export function getIndexerBootstrapUrl(): string | undefined {
  const fromEnv = getString("VITE_INDEXER_BOOTSTRAP_URL");
  if (fromEnv !== undefined) return fromEnv;
  return isProductionLike() ? DEFAULT_INDEXER_BOOTSTRAP_URL : undefined;
}

/**
 * Whether the app should use production-like default settings
 * (e.g. NewPlayer, TutorialOpen default true).
 * Uses VITE_APP_MODE when set (production | development), otherwise import.meta.env.MODE.
 */
export function isProductionLike(): boolean {
  const mode = getString("VITE_APP_MODE");
  if (mode === "production") {
    return true;
  }
  if (mode === "development") {
    return false;
  }
  return import.meta.env.MODE === "production";
}

/**
 * Whether to enable client-side proof generation in PXE.
 * Required for devnet/testnet (true), optional for local development (false for speed).
 * Defaults to false when unset.
 */
export function getProverEnabled(): boolean {
  const value = getString("VITE_PROVER_ENABLED");
  return value === "true";
}
