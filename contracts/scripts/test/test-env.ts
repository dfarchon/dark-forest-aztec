/**
 * Print the active network configuration for gasMainRound2 scripts.
 *
 * - Network keys come from `networks/<AZTEC_NETWORK>.env` via runtime/env.ts and runtime/network.ts.
 * - Secret keys (ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY, ...) are never printed, only "(set)".
 * - Contract addresses live in the latest complete deploy manifest, not in the network file.
 * - Duplicate keys are reported: the last occurrence in the file wins (same as the loader).
 *
 * Usage (from contracts/): pnpm exec tsx scripts/test/test-env.ts
 */
import fs from 'fs';
import path from 'path';

import { findLatestCompleteManifest } from '../deploy/manifest.ts';
import {
    getNetworkValue,
    isSecretKey,
    loadNetworkEnv,
    SECRET_KEYS,
} from '../runtime/env.ts';
import {
    diagnoseNetwork,
    printNetworkReport,
    REQUIRED_NETWORK_KEYS,
} from '../runtime/network.ts';

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

function main() {
    const ctx = loadNetworkEnv();
    const rel = path.relative(process.cwd(), ctx.networkFilePath);
    const counts = countOccurrences(ctx.networkFilePath);

    console.log(`📄 Network: ${ctx.network}`);
    console.log(`📄 Config:  ${rel}`);
    console.log(
        `📊 Total lines: ${fs.readFileSync(ctx.networkFilePath, 'utf-8').split('\n').length}`
    );

    printNetworkReport();

    const diagnosis = diagnoseNetwork();
    let missing = 0;
    let duplicated = 0;

    console.log('\n--- Required network keys ---');
    for (const key of REQUIRED_NETWORK_KEYS) {
        const value = getNetworkValue(key);
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

    console.log('\n--- Account keys (values hidden) ---');
    for (const key of SECRET_KEYS) {
        const value = getNetworkValue(key);
        const count = counts.get(key) ?? 0;
        const shown = isSecretKey(key) && key !== 'ACCOUNT_ADDRESS';
        const text = !value ? '(missing)' : shown ? '(set)' : value;
        if (!value) {
            console.log(`  ❌ ${key} = ${text}`);
            missing++;
        } else if (count > 1) {
            console.log(`  ⚠️  ${key} = ${text}  (${count} occurrences!)`);
            duplicated++;
        } else {
            console.log(`  ✅ ${key} = ${text}`);
        }
    }

    console.log('\n--- Latest complete deployment ---');
    const manifest = findLatestCompleteManifest(ctx.network);
    if (!manifest) {
        console.log(
            `  ❌ No complete deploy manifest for ${ctx.network}. Run pnpm deploy:run.`
        );
    } else {
        console.log(`  id: ${manifest.id}`);
        console.log(`  deployer: ${manifest.deployerAddress}`);
        for (const c of manifest.contracts) {
            console.log(
                `  ${c.status === 'deployed' ? '✅' : '❌'} ${c.name} = ${c.address ?? '(none)'}`
            );
        }
    }

    console.log(`\n--- Summary ---`);
    console.log(`  Network ready: ${diagnosis.ok ? 'yes' : 'no'}`);
    for (const reason of diagnosis.reasons) console.log(`    - ${reason}`);
    console.log(`  Missing keys: ${missing}`);
    console.log(`  Duplicated keys: ${duplicated}`);

    if (duplicated > 0) {
        console.log(
            `\n⚠️  ${duplicated} keys appear more than once in ${rel}.`
        );
        console.log(
            '   The loader keeps the LAST occurrence of each key; multiple ACCOUNT_* blocks'
        );
        console.log(
            '   are allowed (pnpm account:generate appends); the last block is active.'
        );
    }
}

try {
    main();
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}
