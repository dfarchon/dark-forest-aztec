import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readDeployment,
  readLatestId,
  type DeploymentRecord,
  type StorageAddresses,
} from "./deployment.ts";
import { loadNetworkEnv } from "./env.ts";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SHELL_OVERRIDES = [
  "AZTEC_NODE_URL",
  "ANALYTICS_START_BLOCK",
  "ANALYTICS_DB",
  "DEPLOYMENT_ID",
] as const;

export function analyticsPackageRoot(): string {
  return PACKAGE_ROOT;
}

export function contractsPackageRoot(): string {
  return path.resolve(PACKAGE_ROOT, "..", "contracts");
}

export interface AnalyticsConfig {
  network: string;
  deploymentId: string;
  nodeUrl: string;
  dbPath: string;
  startBlock: number;
  addresses: StorageAddresses;
}

export function parseAnalyticsConfig(input: {
  network: string;
  values: Record<string, string | undefined>;
  deployment: DeploymentRecord;
  packageRoot?: string;
}): AnalyticsConfig {
  const packageRoot = input.packageRoot ?? PACKAGE_ROOT;
  const deployment = input.deployment;
  if (deployment.network !== input.network) {
    throw new Error(
      `[analytics] Imported deployment ${deployment.id} is for ${deployment.network}, not ${input.network}.`,
    );
  }
  const rawUrl = input.values.AZTEC_NODE_URL?.trim() ?? "";
  if (!rawUrl) {
    throw new Error(
      `[analytics] AZTEC_NODE_URL is required in networks/${input.network}.env`,
    );
  }
  const nodeUrl = rawUrl.replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(nodeUrl);
  } catch {
    throw new Error(
      `[analytics] AZTEC_NODE_URL in networks/${input.network}.env must be a valid URL`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `[analytics] AZTEC_NODE_URL in networks/${input.network}.env must use http or https`,
    );
  }
  const startRaw = input.values.ANALYTICS_START_BLOCK?.trim();
  const startBlock = startRaw ? Number(startRaw) : deployment.startBlock;
  if (!Number.isInteger(startBlock) || startBlock < 0) {
    throw new Error(
      `[analytics] ANALYTICS_START_BLOCK in networks/${input.network}.env must be a non-negative integer`,
    );
  }
  const dbRaw = input.values.ANALYTICS_DB?.trim();
  const dbPath = dbRaw
    ? path.resolve(packageRoot, dbRaw)
    : path.join(packageRoot, "data", input.network, deployment.id, "events.db");
  return {
    network: input.network,
    deploymentId: deployment.id,
    nodeUrl,
    dbPath,
    startBlock,
    addresses: deployment.addresses,
  };
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  packageRoot = PACKAGE_ROOT,
): AnalyticsConfig {
  const loaded = loadNetworkEnv(packageRoot, env);
  const values: Record<string, string | undefined> = { ...loaded.values };
  for (const key of SHELL_OVERRIDES) {
    const override = env[key]?.trim();
    if (override) values[key] = override;
  }
  const deploymentId =
    values.DEPLOYMENT_ID?.trim() || readLatestId(packageRoot, loaded.network);
  if (!deploymentId) {
    throw new Error(
      `[analytics] No deployment selected for ${loaded.network}. Run: pnpm --filter analytics import`,
    );
  }
  const deployment = readDeployment(packageRoot, loaded.network, deploymentId);
  return parseAnalyticsConfig({
    network: loaded.network,
    values,
    deployment,
    packageRoot,
  });
}
