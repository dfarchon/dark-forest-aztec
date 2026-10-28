/**
 * Per-batch deploy journal. Each run gets a unique id under
 * contracts/deployments/<network>/<id>/manifest.json.
 */
import type { ContractArtifact } from '@aztec-labs/stdlib/abi';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

import { CONTRACTS_PACKAGE_ROOT } from '../runtime/env.ts';
import type { DeployDefinition } from './definitions.ts';

export const DEPLOYMENTS_DIR = path.join(CONTRACTS_PACKAGE_ROOT, 'deployments');

export const DEPLOYMENT_ID_RE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$/;

export type ManifestStatus = 'in_progress' | 'complete';
export type ContractStatus = 'planned' | 'prepared' | 'deployed';

export type ManifestContract = {
    name: string;
    envPrefix: string;
    status: ContractStatus;
    salt?: string;
    address?: string;
    deployerAddress?: string;
    deployedAt?: string;
};

export type DeployManifest = {
    id: string;
    network: string;
    nodeUrl: string;
    deployerAddress: string;
    startBlock: number;
    status: ManifestStatus;
    artifactFingerprint: string;
    createdAt: string;
    updatedAt: string;
    contracts: ManifestContract[];
};

export function createDeploymentId(now: Date = new Date()): string {
    const utc = now
        .toISOString()
        .replace(/-/g, '')
        .replace(/:/g, '')
        .replace(/\.\d+Z$/, 'Z');
    return `${utc}-${randomBytes(2).toString('hex')}`;
}

export function assertDeploymentId(id: string): string {
    if (!DEPLOYMENT_ID_RE.test(id)) {
        throw new Error(
            `Invalid deployment id "${id}". Expected YYYYMMDDTHHMMSSZ-xxxx.`
        );
    }
    return id;
}

export function networkDeploymentsDir(network: string): string {
    return path.join(DEPLOYMENTS_DIR, network);
}

export function deploymentDir(network: string, id: string): string {
    return path.join(networkDeploymentsDir(network), assertDeploymentId(id));
}

export function manifestFilePath(network: string, id: string): string {
    return path.join(deploymentDir(network, id), 'manifest.json');
}

export function latestFilePath(network: string): string {
    return path.join(networkDeploymentsDir(network), 'latest');
}

function atomicWriteFile(filePath: string, contents: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, contents, 'utf-8');
    fs.renameSync(tmp, filePath);
}

export function writeManifest(manifest: DeployManifest): DeployManifest {
    const next: DeployManifest = {
        ...manifest,
        updatedAt: new Date().toISOString(),
    };
    atomicWriteFile(
        manifestFilePath(next.network, next.id),
        JSON.stringify(next, null, 2) + '\n'
    );
    return next;
}

export function writeLatest(network: string, id: string): void {
    atomicWriteFile(latestFilePath(network), `${assertDeploymentId(id)}\n`);
}

export function readLatestId(network: string): string | undefined {
    const filePath = latestFilePath(network);
    if (!fs.existsSync(filePath)) return undefined;
    const id = fs.readFileSync(filePath, 'utf-8').trim();
    if (!id) return undefined;
    return assertDeploymentId(id);
}

export function readManifest(network: string, id: string): DeployManifest {
    const filePath = manifestFilePath(network, id);
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `No deploy manifest at ${path.relative(process.cwd(), filePath)}.`
        );
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return validateManifest(parsed, network, id);
}

function validateManifest(
    value: unknown,
    network: string,
    id: string
): DeployManifest {
    if (!value || typeof value !== 'object') {
        throw new Error(`Deploy manifest ${id} is not an object.`);
    }
    const manifest = value as DeployManifest;
    if (manifest.id !== id) {
        throw new Error(
            `Deploy manifest id mismatch: file ${id}, contents ${manifest.id}.`
        );
    }
    if (manifest.network !== network) {
        throw new Error(
            `Deploy manifest network mismatch: expected ${network}, got ${manifest.network}.`
        );
    }
    if (manifest.status !== 'in_progress' && manifest.status !== 'complete') {
        throw new Error(`Deploy manifest ${id} has invalid status.`);
    }
    if (!Array.isArray(manifest.contracts)) {
        throw new Error(`Deploy manifest ${id} is missing contracts.`);
    }
    return manifest;
}

export function listDeploymentIds(network: string): string[] {
    const dir = networkDeploymentsDir(network);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
            (entry) => entry.isDirectory() && DEPLOYMENT_ID_RE.test(entry.name)
        )
        .map((entry) => entry.name)
        .sort();
}

export function findLatestCompleteManifest(
    network: string
): DeployManifest | undefined {
    const ids = listDeploymentIds(network);
    for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i]!;
        const manifest = readManifest(network, id);
        if (manifest.status === 'complete') return manifest;
    }
    return undefined;
}

export function createManifest(params: {
    id: string;
    network: string;
    nodeUrl: string;
    deployerAddress: string;
    startBlock: number;
    artifactFingerprint: string;
    definitions: DeployDefinition[];
}): DeployManifest {
    const now = new Date().toISOString();
    return writeManifest({
        id: params.id,
        network: params.network,
        nodeUrl: params.nodeUrl,
        deployerAddress: params.deployerAddress,
        startBlock: params.startBlock,
        status: 'in_progress',
        artifactFingerprint: params.artifactFingerprint,
        createdAt: now,
        updatedAt: now,
        contracts: params.definitions.map((definition) => ({
            name: definition.name,
            envPrefix: definition.envPrefix,
            status: 'planned',
        })),
    });
}

export function digestArtifact(
    name: string,
    artifact: ContractArtifact
): string {
    const hash = createHash('sha256');
    hash.update(name);
    hash.update(artifact.name ?? '');
    hash.update(artifact.aztecVersion ?? '');
    for (const fn of artifact.functions ?? []) {
        hash.update(fn.name);
        if (fn.bytecode) hash.update(fn.bytecode);
    }
    return hash.digest('hex');
}

export function combineArtifactFingerprint(digests: string[]): string {
    return createHash('sha256').update(digests.join(',')).digest('hex');
}

export function relativeManifestPath(network: string, id: string): string {
    return path.relative(process.cwd(), manifestFilePath(network, id));
}
