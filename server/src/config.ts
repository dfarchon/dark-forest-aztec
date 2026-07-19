import { START_BLOCK } from "@dfpunk/contracts";

export const DEFAULT_AZTEC_NODE_URL = "https://canonical.testnet.rpc.aztec-labs.com";

export const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://dark-forest-aztec-testnet-v5.netlify.app",
  "https://dfpunk-aztec.netlify.app",
  "https://dfpunk-aztec-testnet.netlify.app",
];

export interface ServerRuntimeConfig {
  aztecNodeUrl: string;
  nodeKind: "local" | "remote";
  port: number;
  sqlitePath: string;
  snapshotSchemaVersion: number;
  persistMinIntervalSec: number;
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

export function parseServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerRuntimeConfig {
  const aztecNodeUrl = parseAztecNodeUrl(env.AZTEC_NODE_URL);
  const snapshotSchemaVersion = parseIntEnv(
    env.SNAPSHOT_SCHEMA_VERSION,
    1,
    "SNAPSHOT_SCHEMA_VERSION",
  );
  if (snapshotSchemaVersion < 1) {
    throw new Error(
      "[ServerConfig] SNAPSHOT_SCHEMA_VERSION must be a positive integer",
    );
  }
  return {
    aztecNodeUrl,
    nodeKind: detectNodeKind(aztecNodeUrl),
    port: parseIntEnv(env.PORT, 3001, "PORT"),
    sqlitePath: env.SQLITE_PATH?.trim() || "./data/indexer.db",
    snapshotSchemaVersion,
    persistMinIntervalSec: parseIntEnv(
      env.PERSIST_MIN_INTERVAL_SEC,
      10,
      "PERSIST_MIN_INTERVAL_SEC",
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
