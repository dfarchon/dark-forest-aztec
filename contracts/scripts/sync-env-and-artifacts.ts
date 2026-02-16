/**
 * Sync .env (ACCOUNT_ADDRESS + contract addresses only) to packages/contracts/src/index.ts,
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

/** Only write ACCOUNT_ADDRESS and keys ending with _CONTRACT_ADDRESS */
function isAllowedKey(key: string): boolean {
    return key === 'ACCOUNT_ADDRESS' || key.endsWith('_CONTRACT_ADDRESS');
}

/** Human-readable comment for known keys */
const KEY_COMMENTS: Record<string, string> = {
    ACCOUNT_ADDRESS: 'The deployer account address.',
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
};

function commentForKey(key: string): string {
    return KEY_COMMENTS[key] ?? key;
}

function parseEnv(content: string): Array<{ key: string; value: string }> {
    const lines = content.split(/\r?\n/);
    const entries: Array<{ key: string; value: string }> = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) entries.push({ key, value });
    }
    return entries;
}

function formatValue(value: string): string {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'false') return lower;
    if (/^\d+$/.test(value)) return value;
    return `'${value.replace(/'/g, "\\'")}'`;
}

function generateIndexTs(
    entries: Array<{ key: string; value: string }>
): string {
    const lines: string[] = [
        '',
        '/**',
        ' * ACCOUNT_ADDRESS and contract addresses. Generated from contracts/.env by sync-env-and-artifacts.ts',
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

function syncEnvToIndexTs(): void {
    if (!fs.existsSync(ENV_PATH)) {
        throw new Error(`.env not found at ${ENV_PATH}`);
    }
    const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    const allEntries = parseEnv(envContent);
    const entries = allEntries.filter((e) => isAllowedKey(e.key));
    const tsContent = generateIndexTs(entries);
    const destDir = path.dirname(INDEX_TS_PATH);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.writeFileSync(INDEX_TS_PATH, tsContent, 'utf-8');
    console.log(
        `Wrote ${entries.length} exports (ACCOUNT_ADDRESS + contract addresses) to ${INDEX_TS_PATH}`
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
