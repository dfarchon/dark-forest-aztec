/**
 * Client env config: reads VITE_* from import.meta.env with defaults.
 * Used for node URL, indexer bootstrap, and default setting behavior (VITE_APP_MODE).
 */

const DEFAULT_NODE_URL = "http://localhost:8080";
const DEFAULT_PROVER_URL = "http://127.0.0.1:59833";

/** Default indexer bootstrap URL (testnet server) when VITE_INDEXER_BOOTSTRAP_URL is unset in testnet builds. */
const DEFAULT_INDEXER_BOOTSTRAP_URL = "";

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
 * In testnet builds, defaults to the testnet server when env is unset.
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

/**
 * Native accelerator / TeeRex-style prover HTTP base URL (host + port).
 * Defaults to http://127.0.0.1:59833 when unset.
 */
export function getProverUrl(): string {
  return getString("VITE_TEEREX_PROVER_URL") ?? DEFAULT_PROVER_URL;
}

function getBoolean(key: string, defaultValue: boolean): boolean {
  const value = getString(key);
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
}

/**
 * Whether to use SponsoredFeePaymentMethod/SponsoredFPC for local development.
 * Env:
 * - preferred: VITE_SPONSOR_MODE=true
 * - compatibility: VITE_SPONSER_MODE=true (typo)
 */
export function getSponsorMode(): boolean {
  // Prefer correctly-spelled env var.
  const fromSponsor = getString("VITE_SPONSOR_MODE");
  if (fromSponsor !== undefined)
    return fromSponsor === "true" || fromSponsor === "1";

  return getBoolean("VITE_SPONSER_MODE", false);
}
