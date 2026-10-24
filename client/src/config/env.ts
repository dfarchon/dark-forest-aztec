import { BLOCK_EXPLORER_URL } from "@dfpunk/constants";

import {
  DEFAULT_ACCOUNT_MIN_BALANCE_FJ,
  DEFAULT_SPONSORED_FPC_MIN_FJ,
  parseFjDecimalToWei,
} from "../utils/feeJuiceUnits";

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

/** The protocol-level development sponsor path is disabled. */
export function getSponsorMode(): boolean {
  return false;
}

/**
 * Optional SponsoredFPC contract address (Aztec address string) when it differs
 * from the default salt-derived instance (e.g. public testnet). Used only in sponsor mode.
 * Build-time: `VITE_SPONSORED_FPC_ADDRESS`.
 */
export function getSponsoredFpcAddressFromEnv(): string | undefined {
  const v = getString("VITE_SPONSORED_FPC_ADDRESS");
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Minimum SponsoredFPC FeeJuice balance (in wei) required before sponsored deploy / txs preflight.
 * Env: `VITE_SPONSORED_FPC_MIN_BALANCE_FJ` as a decimal FJ string (e.g. "0.01").
 * Falls back to {@link DEFAULT_SPONSORED_FPC_MIN_FJ} when unset or invalid.
 */
export function getSponsoredFpcMinBalanceFjWei(): bigint {
  const raw = getString("VITE_SPONSORED_FPC_MIN_BALANCE_FJ");
  if (raw !== undefined) {
    const parsed = parseFjDecimalToWei(raw.trim());
    if (parsed !== undefined && parsed > 0n) return parsed;
  }
  return parseFjDecimalToWei(DEFAULT_SPONSORED_FPC_MIN_FJ)!;
}

const LOCAL_AZTEC_TX_URL = "http://127.0.0.1:8082/tx-effects";
const LOCAL_ANVIL_TX_URL = "http://127.0.0.1:4000/tx";

/**
 * True when the client is talking to a node on this machine (local Aztec on Anvil).
 */
export function isLocalDevNode(): boolean {
  try {
    const host = new URL(getNodeUrl()).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Explorer page for a transaction hash.
 * Local Aztec game txs open the Aztec explorer. Local L1 txs open Anvil Blockscout.
 * Remote nodes keep the public explorer.
 */
export function txExplorerUrl(hash: string, layer: "l2" | "l1" = "l2"): string {
  if (isLocalDevNode()) {
    const base = layer === "l1" ? LOCAL_ANVIL_TX_URL : LOCAL_AZTEC_TX_URL;
    return `${base}/${hash}`;
  }
  return `${BLOCK_EXPLORER_URL}/${hash}`;
}

/**
 * Address of the project's Sponsored FPC. It pays eligible Dark Forest calls
 * from one shared FeeJuice balance; there is no user, seat, or daily quota.
 * Build-time: `VITE_SPONSORED_FPC_ADDRESS`.
 */
export function getProjectSponsoredFpcAddressFromEnv(): string | undefined {
  const v = getString("VITE_SPONSORED_FPC_ADDRESS");
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** True when the project Sponsored FPC is configured for this build. */
export function isProjectSponsoredFpcEnabled(): boolean {
  return getProjectSponsoredFpcAddressFromEnv() !== undefined;
}

/**
 * Minimum active-account FeeJuice balance (in wei) required before entering the game
 * when `VITE_SPONSOR_MODE` is false. Env: `VITE_ACCOUNT_MIN_BALANCE_FJ` as decimal FJ (e.g. "5").
 * Falls back to {@link DEFAULT_ACCOUNT_MIN_BALANCE_FJ} when unset or invalid.
 */
export function getAccountMinBalanceFjWei(): bigint {
  const raw = getString("VITE_ACCOUNT_MIN_BALANCE_FJ");
  if (raw !== undefined) {
    const parsed = parseFjDecimalToWei(raw.trim());
    if (parsed !== undefined && parsed > 0n) return parsed;
  }
  return parseFjDecimalToWei(DEFAULT_ACCOUNT_MIN_BALANCE_FJ)!;
}
