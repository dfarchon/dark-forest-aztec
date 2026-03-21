/**
 * Print all deployment-related values that dotenv reads from .env.
 * Parsed values use the LAST occurrence of each key in the file (dotenv `parse` overwrites).
 *
 * Usage: node --experimental-transform-types scripts/test/test-env.ts
 */
import fs from 'fs';

import {
    ENV_KEYS,
    getContractsEnvFilePath,
    getOptionalEnv,
    loadContractsEnv,
} from '../utils/env.ts';

loadContractsEnv();

const envPath = getContractsEnvFilePath();

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
    const value = getOptionalEnv(key);
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
    console.log(`\n⚠️  ${duplicated} keys appear more than once in .env.`);
    console.log(
        `   Parsed value per key is from the LAST occurrence (dotenv parse).`
    );
    console.log(
        `   Multiple ACCOUNT_* blocks are allowed for history; the last block is active.`
    );
}
