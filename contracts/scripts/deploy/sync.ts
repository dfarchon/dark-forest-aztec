/**
 * Publish a completed deploy manifest to packages/contracts/src/index.ts
 * and copy scripts/artifacts into packages/contracts/src/artifacts.
 *
 *   pnpm deploy:publish
 *   pnpm deploy:publish --id <id>
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { CONTRACTS_PACKAGE_ROOT, loadNetworkEnv } from '../runtime/env.ts';
import { requireNetworkConfigured } from '../runtime/network.ts';
import {
    ARTIFACTS_DIR,
    KEY_COMMENTS,
    PXE_REGISTRATION_KEYS,
} from './definitions.ts';
import {
    type DeployManifest,
    findLatestCompleteManifest,
    readManifest,
    relativeManifestPath,
} from './manifest.ts';

const REPO_ROOT = path.resolve(CONTRACTS_PACKAGE_ROOT, '..');
const INDEX_TS_PATH = path.join(
    REPO_ROOT,
    'packages',
    'contracts',
    'src',
    'index.ts'
);
const ARTIFACTS_DEST = path.join(
    REPO_ROOT,
    'packages',
    'contracts',
    'src',
    'artifacts'
);

type CliArgs = { id?: string };

function parseArgs(argv: string[]): CliArgs {
    let id: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--id') {
            const next = argv[i + 1];
            if (!next || next.startsWith('-')) {
                throw new Error('Missing value for --id.');
            }
            id = next;
            i += 1;
            continue;
        }
        if (arg.startsWith('--id=')) {
            id = arg.slice('--id='.length);
            continue;
        }
        throw new Error(
            `Unknown argument: ${arg}\n` +
                'Usage: pnpm deploy:publish [--id <id>]'
        );
    }
    return { id };
}

function commentForKey(key: string): string {
    return KEY_COMMENTS[key] ?? key;
}

function formatValue(value: string): string {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'false') return lower;
    if (/^\d+$/.test(value)) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
}

function generateIndexTs(
    entries: Array<{ key: string; value: string }>
): string {
    const lines: string[] = [
        '',
        '/**',
        ' * ACCOUNT_ADDRESS, START_BLOCK, and contract addresses. Generated from a deploy manifest by scripts/deploy/sync.ts',
        ' */',
        '',
    ];
    for (const { key, value } of entries) {
        lines.push('/**');
        lines.push(` * ${commentForKey(key)}`);
        lines.push(' */');
        lines.push(`export const ${key} = ${formatValue(value)};`);
        lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
}

function entriesFromManifest(
    manifest: DeployManifest
): Array<{ key: string; value: string }> {
    const byKey: Record<string, string> = {
        ACCOUNT_ADDRESS: manifest.deployerAddress,
        START_BLOCK: String(manifest.startBlock),
    };
    for (const entry of manifest.contracts) {
        if (entry.status !== 'deployed') {
            throw new Error(
                `Cannot publish ${manifest.id}: ${entry.name} is ${entry.status}.`
            );
        }
        if (!entry.address || !entry.deployerAddress || !entry.salt) {
            throw new Error(
                `Cannot publish ${manifest.id}: ${entry.name} is missing address, deployer, or salt.`
            );
        }
        byKey[`${entry.envPrefix}_CONTRACT_ADDRESS`] = entry.address;
        byKey[`${entry.envPrefix}_DEPLOYER_ADDRESS`] = entry.deployerAddress;
        byKey[`${entry.envPrefix}_DEPLOYMENT_SALT`] = entry.salt;
    }
    for (const key of PXE_REGISTRATION_KEYS) {
        if (byKey[key] === undefined) byKey[key] = '';
    }
    return Object.entries(byKey)
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key));
}

function resolveManifest(network: string, id?: string): DeployManifest {
    if (id) {
        const manifest = readManifest(network, id);
        if (manifest.status !== 'complete') {
            throw new Error(
                `Deployment ${id} is ${manifest.status}. Publish only a complete run.`
            );
        }
        return manifest;
    }
    const latestComplete = findLatestCompleteManifest(network);
    if (!latestComplete) {
        throw new Error(
            `No complete deployment on ${network}. Run pnpm deploy:run first.`
        );
    }
    return latestComplete;
}

function writeIndexTs(manifest: DeployManifest): void {
    const entries = entriesFromManifest(manifest);
    const destDir = path.dirname(INDEX_TS_PATH);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(INDEX_TS_PATH, generateIndexTs(entries), 'utf-8');
    console.log(
        `Wrote ${entries.length} exports (ACCOUNT_ADDRESS, START_BLOCK, contract addresses) to ${INDEX_TS_PATH}`
    );
}

function askConfirm(question: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

async function copyArtifacts(): Promise<void> {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
        throw new Error(`Artifacts dir not found: ${ARTIFACTS_DIR}`);
    }
    if (fs.existsSync(ARTIFACTS_DEST)) {
        console.log(`Destination already exists: ${ARTIFACTS_DEST}`);
        const ok = await askConfirm('Overwrite? (y/N): ');
        if (!ok) {
            console.log('Skipped copying artifacts.');
            return;
        }
        fs.rmSync(ARTIFACTS_DEST, { recursive: true });
    }
    fs.cpSync(ARTIFACTS_DIR, ARTIFACTS_DEST, { recursive: true });
    const count = fs.readdirSync(ARTIFACTS_DEST).length;
    console.log(`Copied all artifacts (${count} items) to ${ARTIFACTS_DEST}`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    requireNetworkConfigured();
    const { network } = loadNetworkEnv();
    const manifest = resolveManifest(network, args.id);
    console.log(
        `Publishing ${manifest.id} (${relativeManifestPath(network, manifest.id)})`
    );
    writeIndexTs(manifest);
    await copyArtifacts();
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
