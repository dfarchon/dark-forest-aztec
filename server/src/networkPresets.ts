/**
 * Network-specific tuning presets.
 *
 * Each preset bundles indexer timing parameters that are appropriate for the
 * target network's block time, node stability, and expected load.  The active
 * preset is selected via the `NETWORK_PRESET` env var (or auto-detected from
 * `nodeKind`), and individual values can still be overridden with dedicated
 * env vars (see config.ts).
 */

export type NetworkPresetName = "devnet" | "testnet" | "mainnet" | "local";

export interface NetworkPreset {
  /** Human-readable label for logging. */
  name: NetworkPresetName;
  /** How often to poll the node for the latest block number (ms). */
  pollIntervalMs: number;
  /** Debounce delay before processing new blocks (ms). */
  debounceMs: number;
  /** Minimum seconds between SQLite snapshot writes. */
  persistMinIntervalSec: number;
  /** Max blocks fetched per getBlockUpdates call. */
  maxBlocksPerRequest: number;
}

const PRESETS: Record<NetworkPresetName, NetworkPreset> = {
  devnet: {
    name: "devnet",
    pollIntervalMs: 10_000, // ~30s block time, node occasionally 502s
    debounceMs: 2_000,
    persistMinIntervalSec: 30,
    maxBlocksPerRequest: 100,
  },
  testnet: {
    name: "testnet",
    pollIntervalMs: 10_000,
    debounceMs: 2_000,
    persistMinIntervalSec: 30,
    maxBlocksPerRequest: 100,
  },
  mainnet: {
    name: "mainnet",
    pollIntervalMs: 15_000,
    debounceMs: 3_000,
    persistMinIntervalSec: 60,
    maxBlocksPerRequest: 50,
  },
  local: {
    name: "local",
    pollIntervalMs: 1_000, // sandbox produces blocks quickly
    debounceMs: 500,
    persistMinIntervalSec: 5,
    maxBlocksPerRequest: 200,
  },
};

export const NETWORK_PRESET_NAMES = Object.keys(
  PRESETS,
) as NetworkPresetName[];

export function isNetworkPresetName(
  value: string,
): value is NetworkPresetName {
  return value in PRESETS;
}

/**
 * Return the built-in preset for the given network name.
 * Throws if the name is not recognized.
 */
export function getNetworkPreset(name: NetworkPresetName): NetworkPreset {
  return PRESETS[name];
}
