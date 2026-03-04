/**
 * Sync .env (ACCOUNT_ADDRESS, START_BLOCK, and contract addresses only) to packages/contracts/src/index.ts,
 * and copy all contents of contracts/scripts/artifacts/ to packages/contracts/src/artifacts/.
 * Run from contracts: pnpm run sync-env-and-artifacts
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Paths: script lives in contracts/scripts/ */
const CONTRACTS_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(CONTRACTS_DIR, '.env');
const INDEX_TS_PATH = path.join(
    REPO_ROOT,
    'packages',
    'contracts',
    'src',
    'index.ts'
);
/** Source: contracts/scripts/artifacts (same dir as this script) */
const ARTIFACTS_SRC = path.join(__dirname, 'artifacts');
const ARTIFACTS_DEST = path.join(
    REPO_ROOT,
    'packages',
    'contracts',
    'src',
    'artifacts'
);

/** Only write ACCOUNT_ADDRESS, START_BLOCK, contract addresses, and deploy params (for PXE registration). */
function isAllowedKey(key: string): boolean {
    return (
        key === 'ACCOUNT_ADDRESS' ||
        key === 'START_BLOCK' ||
        key.endsWith('_CONTRACT_ADDRESS') ||
        key.endsWith('_DEPLOYER_ADDRESS') ||
        key.endsWith('_DEPLOYMENT_SALT')
    );
}

/** Human-readable comment for known keys */
const KEY_COMMENTS: Record<string, string> = {
    ACCOUNT_ADDRESS: 'The deployer account address.',
    START_BLOCK: 'Block number at deployment start (from deploy script).',
    CONFIG_CONTRACT_ADDRESS: 'The address for the Config contract.',
    WORLD_STORAGE_CONTRACT_ADDRESS:
        'The address for the WorldStorage contract.',
    PLAYER_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlayerStorage contract.',
    PLANET_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetStorage contract.',
    PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetRevealedCoordsStorage contract.',
    PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetEventsStorage contract.',
    PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetArtifactsStorage contract.',
    ARRIVAL_STORAGE_CONTRACT_ADDRESS:
        'The address for the ArrivalStorage contract.',
    ARTIFACT_STORAGE_CONTRACT_ADDRESS:
        'The address for the ArtifactStorage contract.',
    ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS:
        'The address for the ArtifactLocationStorage contract.',
    ADMIN_CONTRACT_ADDRESS: 'The address for the Admin contract.',
    CORE_CONTRACT_ADDRESS: 'The address for the Core contract.',
    MOVE_CONTRACT_ADDRESS: 'The address for the Move contract.',
    ARTIFACT_SYSTEM_CONTRACT_ADDRESS:
        'The address for the ArtifactSystem contract.',
    ADMIN_DEPLOYER_ADDRESS:
        'Deployer address for Admin (for PXE registration).',
    ADMIN_DEPLOYMENT_SALT: 'Deployment salt for Admin (for PXE registration).',
    CORE_DEPLOYER_ADDRESS: 'Deployer address for Core (for PXE registration).',
    CORE_DEPLOYMENT_SALT: 'Deployment salt for Core (for PXE registration).',
    MOVE_DEPLOYER_ADDRESS: 'Deployer address for Move (for PXE registration).',
    MOVE_DEPLOYMENT_SALT: 'Deployment salt for Move (for PXE registration).',
    ARTIFACT_SYSTEM_DEPLOYER_ADDRESS:
        'Deployer address for ArtifactSystem (for PXE registration).',
    ARTIFACT_SYSTEM_DEPLOYMENT_SALT:
        'Deployment salt for ArtifactSystem (for PXE registration).',
};

function commentForKey(key: string): string {
    return KEY_COMMENTS[key] ?? key;
}

function parseEnv(content: string): Array<{ key: string; value: string }> {
    const lines = content.split(/\r?\n/);
    const map = new Map<string, string>();
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) map.set(key, value);
    }
    return Array.from(map, ([key, value]) => ({ key, value }));
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
        ' * ACCOUNT_ADDRESS, START_BLOCK, and contract addresses. Generated from contracts/.env by sync-env-and-artifacts.ts',
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

/** Deploy params required by client for PXE registration. Always emitted (use '' when missing). */
const PXE_REGISTRATION_KEYS = [
    'CORE_DEPLOYER_ADDRESS',
    'CORE_DEPLOYMENT_SALT',
    'MOVE_DEPLOYER_ADDRESS',
    'MOVE_DEPLOYMENT_SALT',
    'ADMIN_DEPLOYER_ADDRESS',
    'ADMIN_DEPLOYMENT_SALT',
] as const;

function syncEnvToIndexTs(): void {
    if (!fs.existsSync(ENV_PATH)) {
        throw new Error(`.env not found at ${ENV_PATH}`);
    }
    const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    const allEntries = parseEnv(envContent);
    const byKey = Object.fromEntries(allEntries.map((e) => [e.key, e.value]));
    const entries = allEntries.filter((e) => isAllowedKey(e.key));
    // Ensure PXE registration keys are always present (use '' when missing in .env)
    for (const key of PXE_REGISTRATION_KEYS) {
        if (!entries.some((e) => e.key === key)) {
            entries.push({ key, value: byKey[key] ?? '' });
        }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    const tsContent = generateIndexTs(entries);
    const destDir = path.dirname(INDEX_TS_PATH);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.writeFileSync(INDEX_TS_PATH, tsContent, 'utf-8');
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
    if (!fs.existsSync(ARTIFACTS_SRC)) {
        throw new Error(`Artifacts dir not found: ${ARTIFACTS_SRC}`);
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
    fs.cpSync(ARTIFACTS_SRC, ARTIFACTS_DEST, { recursive: true });
    const count = fs.readdirSync(ARTIFACTS_DEST).length;
    console.log(`Copied all artifacts (${count} items) to ${ARTIFACTS_DEST}`);
}

async function main(): Promise<void> {
    syncEnvToIndexTs();
    await copyArtifacts();
}

main();
