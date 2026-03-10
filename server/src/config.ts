import { START_BLOCK } from "@dfpunk/contracts";

import {
  getNetworkPreset,
  isNetworkPresetName,
  NETWORK_PRESET_NAMES,
  type NetworkPresetName,
} from "./networkPresets.ts";

export const DEFAULT_AZTEC_NODE_URL = "https://v4-devnet-2.aztec-labs.com";

export const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://df-aztec.netlify.app",
];

export interface ServerRuntimeConfig {
  aztecNodeUrl: string;
  nodeKind: "local" | "remote";
  networkPreset: NetworkPresetName;
  port: number;
  sqlitePath: string;
  persistMinIntervalSec: number;
  pollIntervalMs: number;
  debounceMs: number;
  maxBlocksPerRequest: number;
  adminToken: string;
  corsOrigins: string[];
  indexerStartBlock: number;
}

function parseIntEnv(
  raw: string | undefined,
  fallback: number,
  key: string,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[ServerConfig] ${key} must be a non-negative integer`);
  }
  return value;
}

function parseAztecNodeUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_AZTEC_NODE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("[ServerConfig] AZTEC_NODE_URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("[ServerConfig] AZTEC_NODE_URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

function detectNodeKind(url: string): "local" | "remote" {
  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "local";
  }
  return "remote";
}

function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? DEFAULT_CORS_ORIGINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolvePresetName(
  raw: string | undefined,
  nodeKind: "local" | "remote",
): NetworkPresetName {
  if (raw != null && raw.trim() !== "") {
    const name = raw.trim().toLowerCase();
    if (!isNetworkPresetName(name)) {
      throw new Error(
        `[ServerConfig] NETWORK_PRESET must be one of: ${NETWORK_PRESET_NAMES.join(", ")}`,
      );
    }
    return name;
  }
  // Auto-detect: local sandbox → "local", remote → "devnet".
  return nodeKind === "local" ? "local" : "devnet";
}

export function parseServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerRuntimeConfig {
  const aztecNodeUrl = parseAztecNodeUrl(env.AZTEC_NODE_URL);
  const nodeKind = detectNodeKind(aztecNodeUrl);
  const networkPreset = resolvePresetName(env.NETWORK_PRESET, nodeKind);
  const preset = getNetworkPreset(networkPreset);

  return {
    aztecNodeUrl,
    nodeKind,
    networkPreset,
    port: parseIntEnv(env.PORT, 3001, "PORT"),
    sqlitePath: env.SQLITE_PATH?.trim() || "./data/indexer.db",
    persistMinIntervalSec: parseIntEnv(
      env.PERSIST_MIN_INTERVAL_SEC,
      preset.persistMinIntervalSec,
      "PERSIST_MIN_INTERVAL_SEC",
    ),
    pollIntervalMs: parseIntEnv(
      env.POLL_INTERVAL_MS,
      preset.pollIntervalMs,
      "POLL_INTERVAL_MS",
    ),
    debounceMs: parseIntEnv(
      env.DEBOUNCE_MS,
      preset.debounceMs,
      "DEBOUNCE_MS",
    ),
    maxBlocksPerRequest: parseIntEnv(
      env.MAX_BLOCKS_PER_REQUEST,
      preset.maxBlocksPerRequest,
      "MAX_BLOCKS_PER_REQUEST",
    ),
    adminToken: env.ADMIN_TOKEN ?? "",
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    indexerStartBlock: parseIntEnv(
      env.INDEXER_START_BLOCK,
      START_BLOCK,
      "INDEXER_START_BLOCK",
    ),
  };
}
