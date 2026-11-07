/**
 * Contracts keeps each universe at deployments/<network>/<id>/manifest.json,
 * with deployments/<network>/latest naming the selected id.
 * Analytics copies that directory and reads it the same way.
 * contracts/networks is not copied: it contains account keys.
 */
import fs from "node:fs";
import path from "node:path";

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";

export const DEPLOYMENT_ID_RE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$/;

const STORAGE_CONTRACTS = [
  ["WorldStorage", "world"],
  ["PlayerStorage", "player"],
  ["PlanetStorage", "planet"],
  ["PlanetRevealedCoordsStorage", "planetRevealedCoords"],
  ["PlanetEventsStorage", "planetEvents"],
  ["PlanetArtifactsStorage", "planetArtifacts"],
  ["ArrivalStorage", "arrival"],
  ["ArtifactStorage", "artifact"],
  ["ArtifactLocationStorage", "artifactLocation"],
] as const;

export type StorageContractKey = (typeof STORAGE_CONTRACTS)[number][1];

export type StorageAddresses = Record<StorageContractKey, string>;

export interface DeploymentRecord {
  id: string;
  network: string;
  startBlock: number;
  addresses: StorageAddresses;
}

interface ManifestContract {
  name?: string;
  status?: string;
  address?: string;
}

interface ManifestFile {
  id?: string;
  network?: string;
  startBlock?: number;
  status?: string;
  contracts?: ManifestContract[];
}

function assertDeploymentId(id: string): string {
  if (!DEPLOYMENT_ID_RE.test(id)) {
    throw new Error(
      `[analytics] Invalid deployment id "${id}". Expected YYYYMMDDTHHMMSSZ-xxxx.`,
    );
  }
  return id;
}

export function deploymentsDir(root: string): string {
  return path.join(root, "deployments");
}

export function copyDeployments(
  contractsRoot: string,
  analyticsRoot: string,
): number {
  const source = deploymentsDir(contractsRoot);
  const dest = deploymentsDir(analyticsRoot);
  if (!fs.existsSync(source)) {
    throw new Error(
      `[analytics] No contracts deployments directory at ${source}.`,
    );
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(source, dest, { recursive: true });
  return fs
    .readdirSync(dest, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
}

export function readLatestId(
  root: string,
  network: string,
): string | undefined {
  const filePath = path.join(deploymentsDir(root), network, "latest");
  if (!fs.existsSync(filePath)) return undefined;
  const id = fs.readFileSync(filePath, "utf8").trim();
  if (!id) return undefined;
  return assertDeploymentId(id);
}

export function readDeployment(
  root: string,
  network: string,
  id: string,
): DeploymentRecord {
  const deploymentId = assertDeploymentId(id);
  const filePath = path.join(
    deploymentsDir(root),
    network,
    deploymentId,
    "manifest.json",
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[analytics] No manifest at ${filePath}. Run: pnpm --filter analytics import`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ManifestFile;
  if (parsed.id !== deploymentId) {
    throw new Error(
      `[analytics] Manifest id mismatch: directory ${deploymentId}, contents ${parsed.id ?? ""}.`,
    );
  }
  if (parsed.network !== network) {
    throw new Error(
      `[analytics] Manifest network mismatch: expected ${network}, got ${parsed.network ?? ""}.`,
    );
  }
  if (parsed.status !== "complete") {
    throw new Error(
      `[analytics] Deployment ${deploymentId} is ${parsed.status ?? "unknown"}. Use a complete deployment.`,
    );
  }
  const startBlock = parsed.startBlock;
  if (
    typeof startBlock !== "number" ||
    !Number.isInteger(startBlock) ||
    startBlock < 0
  ) {
    throw new Error(
      `[analytics] Deployment ${deploymentId} has no start block.`,
    );
  }
  const byName = new Map<string, ManifestContract>();
  for (const entry of parsed.contracts ?? []) {
    if (entry.name) byName.set(entry.name, entry);
  }
  const addresses = {} as StorageAddresses;
  for (const [name, key] of STORAGE_CONTRACTS) {
    const entry = byName.get(name);
    if (!entry || entry.status !== "deployed" || !entry.address) {
      throw new Error(
        `[analytics] Deployment ${deploymentId} is missing a deployed ${name} address.`,
      );
    }
    if (!AztecAddress.isAddress(entry.address)) {
      throw new Error(
        `[analytics] Deployment ${deploymentId} has an invalid ${name} address.`,
      );
    }
    addresses[key] = entry.address;
  }
  return {
    id: deploymentId,
    network,
    startBlock,
    addresses,
  };
}
