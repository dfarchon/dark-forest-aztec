/**
 * Analytics env loader.
 *
 * `.env` contributes only `AZTEC_NETWORK`.
 * `networks/<AZTEC_NETWORK>.env` is written for analytics and holds the node URL.
 * It is not a copy of contracts/networks: those files contain account keys.
 */
import fs from "node:fs";
import path from "node:path";

const NETWORK_NAME_RE = /^[A-Za-z0-9_-]+$/;

const NETWORK_KEYS = [
  "AZTEC_NODE_URL",
  "DEPLOYMENT_ID",
  "ANALYTICS_START_BLOCK",
  "ANALYTICS_DB",
] as const;

export interface LoadedNetwork {
  network: string;
  envFilePath: string;
  networkFilePath: string;
  values: Record<string, string>;
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function readEnvFile(filePath: string): Record<string, string> {
  return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

function analyticsNetworkValues(
  filePath: string,
  raw: Record<string, string>,
): Record<string, string> {
  const unexpected = Object.keys(raw).filter(
    (key) => !(NETWORK_KEYS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `[analytics] ${filePath} has keys analytics does not use: ${unexpected.join(", ")}. Do not copy contracts/networks; those files contain account keys. Keep only ${NETWORK_KEYS.join(", ")}.`,
    );
  }
  return raw;
}

function resolveNetworkName(
  envFilePath: string,
  env: Record<string, string | undefined>,
): string {
  const fromShell = env.AZTEC_NETWORK?.trim();
  if (fromShell) return fromShell;

  if (!fs.existsSync(envFilePath)) {
    throw new Error(
      `[analytics] Missing AZTEC_NETWORK. Copy .env.example to ${path.basename(envFilePath)} and set AZTEC_NETWORK.`,
    );
  }
  const fromFile = readEnvFile(envFilePath).AZTEC_NETWORK?.trim();
  if (fromFile) return fromFile;
  throw new Error(
    `[analytics] Missing AZTEC_NETWORK in ${envFilePath}. See .env.example.`,
  );
}

export function selectedNetwork(
  packageRoot: string,
  env: Record<string, string | undefined>,
): string {
  const network = resolveNetworkName(path.join(packageRoot, ".env"), env);
  if (!NETWORK_NAME_RE.test(network)) {
    throw new Error(
      `[analytics] Invalid AZTEC_NETWORK "${network}". Use a name like local, testnet, or mainnet.`,
    );
  }
  return network;
}

export function loadNetworkEnv(
  packageRoot: string,
  env: Record<string, string | undefined>,
): LoadedNetwork {
  const network = selectedNetwork(packageRoot, env);
  const networkFilePath = path.join(packageRoot, "networks", `${network}.env`);
  if (!fs.existsSync(networkFilePath)) {
    const examplePath = path.join(
      packageRoot,
      "networks",
      `${network}.env.example`,
    );
    const hint = fs.existsSync(examplePath)
      ? ` Copy ${path.basename(examplePath)} to ${path.basename(networkFilePath)} and set AZTEC_NODE_URL.`
      : "";
    throw new Error(
      `[analytics] Missing network config at ${networkFilePath}.${hint}`,
    );
  }
  return {
    network,
    envFilePath: path.join(packageRoot, ".env"),
    networkFilePath,
    values: analyticsNetworkValues(
      networkFilePath,
      readEnvFile(networkFilePath),
    ),
  };
}
