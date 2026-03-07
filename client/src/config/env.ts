/**
 * Client env config: reads VITE_* from import.meta.env with defaults.
 * Used for node URL, indexer bootstrap, and default setting behavior (VITE_APP_MODE).
 */

/** Aztec v4 devnet (matches SDK 4.0.0-devnet.2-patch.1). Use so the client works without a local node. */
const AZTEC_V4_DEVNET_URL = "https://v4-devnet-2.aztec-labs.com";

function getString(key: string): string | undefined {
  const value = import.meta.env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

/**
 * Aztec node URL. Defaults to v4 devnet when unset or empty so the client works without a local node.
 * Set VITE_AZTEC_NODE_URL=http://localhost:8080 for local sandbox.
 */
export function getNodeUrl(): string {
  return getString("VITE_AZTEC_NODE_URL") ?? AZTEC_V4_DEVNET_URL;
}

/**
 * Optional off-chain indexer API base URL for bootstrap snapshot.
 * When undefined, client syncs from node starting at START_BLOCK.
 */
export function getIndexerBootstrapUrl(): string | undefined {
  return getString("VITE_INDEXER_BOOTSTRAP_URL");
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
