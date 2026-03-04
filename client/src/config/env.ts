/**
 * Client env config: reads VITE_* from import.meta.env with defaults.
 * Used for node URL, indexer bootstrap, and default setting behavior (VITE_APP_MODE).
 */

const DEFAULT_NODE_URL = "http://localhost:8080";

function getString(key: string): string | undefined {
  const v = import.meta.env[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
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
 */
export function getIndexerBootstrapUrl(): string | undefined {
  return getString("VITE_INDEXER_BOOTSTRAP_URL");
}

/**
 * Whether the app should use "production-like" default settings
 * (e.g. NewPlayer, TutorialOpen default "true").
 * Uses VITE_APP_MODE when set ("production" | "development"), otherwise import.meta.env.MODE.
 */
export function isProductionLike(): boolean {
  const mode = getString("VITE_APP_MODE");
  if (mode === "production") return true;
  if (mode === "development") return false;
  return import.meta.env.MODE === "production";
}
