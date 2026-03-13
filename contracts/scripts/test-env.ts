/**
 * Print all deployment-related values that dotenv reads from .env.
 * Useful to verify which values scripts will actually use (dotenv takes the FIRST occurrence).
 *
 * Usage: node --experimental-transform-types scripts/test-env.ts
 */
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPath = path.join(import.meta.dirname, '..', '.env');
dotenv.config({ path: envPath });

const ENV_KEYS = [
    // Account
    'ACCOUNT_SALT',
    'ACCOUNT_SECRET_KEY',
    'ACCOUNT_SIGNING_KEY',
    'ACCOUNT_ADDRESS',
    // Block
    'START_BLOCK',
    // Config
    'CONFIG_CONTRACT_ADDRESS',
    'CONFIG_DEPLOYER_ADDRESS',
    'CONFIG_DEPLOYMENT_SALT',
    // Storage contracts
    'WORLD_STORAGE_CONTRACT_ADDRESS',
    'WORLD_STORAGE_DEPLOYER_ADDRESS',
    'WORLD_STORAGE_DEPLOYMENT_SALT',
    'PLAYER_STORAGE_CONTRACT_ADDRESS',
    'PLAYER_STORAGE_DEPLOYER_ADDRESS',
    'PLAYER_STORAGE_DEPLOYMENT_SALT',
    'PLANET_STORAGE_CONTRACT_ADDRESS',
    'PLANET_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_STORAGE_DEPLOYMENT_SALT',
    'PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS',
    'PLANET_REVEALED_COORDS_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_REVEALED_COORDS_STORAGE_DEPLOYMENT_SALT',
    'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS',
    'PLANET_EVENTS_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_EVENTS_STORAGE_DEPLOYMENT_SALT',
    'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS',
    'PLANET_ARTIFACTS_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_ARTIFACTS_STORAGE_DEPLOYMENT_SALT',
    'ARRIVAL_STORAGE_CONTRACT_ADDRESS',
    'ARRIVAL_STORAGE_DEPLOYER_ADDRESS',
    'ARRIVAL_STORAGE_DEPLOYMENT_SALT',
    'ARTIFACT_STORAGE_CONTRACT_ADDRESS',
    'ARTIFACT_STORAGE_DEPLOYER_ADDRESS',
    'ARTIFACT_STORAGE_DEPLOYMENT_SALT',
    'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
    'ARTIFACT_LOCATION_STORAGE_DEPLOYER_ADDRESS',
    'ARTIFACT_LOCATION_STORAGE_DEPLOYMENT_SALT',
    // System contracts
    'ADMIN_CONTRACT_ADDRESS',
    'ADMIN_DEPLOYER_ADDRESS',
    'ADMIN_DEPLOYMENT_SALT',
    'CORE_CONTRACT_ADDRESS',
    'CORE_DEPLOYER_ADDRESS',
    'CORE_DEPLOYMENT_SALT',
    'MOVE_CONTRACT_ADDRESS',
    'MOVE_DEPLOYER_ADDRESS',
    'MOVE_DEPLOYMENT_SALT',
    'ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_ACTION_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_ACTION_SYSTEM_DEPLOYMENT_SALT',
    'ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_FIND_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_FIND_SYSTEM_DEPLOYMENT_SALT',
    'ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_PROSPECT_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_PROSPECT_SYSTEM_DEPLOYMENT_SALT',
    'ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_VAULT_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_VAULT_SYSTEM_DEPLOYMENT_SALT',
] as const;

function countOccurrences(filePath: string): Map<string, number> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const counts = new Map<string, number>();
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

const counts = countOccurrences(envPath);

console.log(`📄 .env path: ${envPath}`);
console.log(
    `📊 Total lines: ${fs.readFileSync(envPath, 'utf-8').split('\n').length}\n`
);

let missing = 0;
let duplicated = 0;

for (const key of ENV_KEYS) {
    const value = process.env[key];
    const count = counts.get(key) ?? 0;

    if (!value) {
        console.log(`  ❌ ${key} = (missing)`);
        missing++;
    } else if (count > 1) {
        console.log(`  ⚠️  ${key} = ${value}  (${count} occurrences!)`);
        duplicated++;
    } else {
        console.log(`  ✅ ${key} = ${value}`);
    }
}

console.log(`\n--- Summary ---`);
console.log(`  Total keys checked: ${ENV_KEYS.length}`);
console.log(`  Present: ${ENV_KEYS.length - missing}`);
console.log(`  Missing: ${missing}`);
console.log(`  Duplicated: ${duplicated}`);

if (duplicated > 0) {
    console.log(`\n⚠️  ${duplicated} keys have duplicate entries in .env.`);
    console.log(
        `   dotenv uses the FIRST occurrence — later values are ignored.`
    );
    console.log(
        `   Run deploy with the updated script to auto-clean stale entries.`
    );
}
