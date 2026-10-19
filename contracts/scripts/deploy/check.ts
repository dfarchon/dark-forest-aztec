/**
 * Confirm a completed deploy manifest is actually on the current chain.
 *
 *   pnpm deploy:check
 *   pnpm deploy:check --id <deployment-id>
 */
import { loadNetworkEnv } from '../runtime/env.ts';
import { requireNetworkConfigured } from '../runtime/network.ts';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.ts';
import { relativeManifestPath } from './manifest.ts';
import {
    addressesFromManifest,
    inspectContractsOnChain,
    resolveCompletedDeployment,
} from './onchain.ts';
import { getAztecNodeUrlFromNetwork } from './session.ts';

function parseId(argv: string[]): string | undefined {
    const args = argv.filter((arg) => arg !== '--');
    let id: string | undefined;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--id') {
            const next = args[i + 1];
            if (!next || next.startsWith('-')) {
                throw new Error('Missing value for --id.');
            }
            id = next;
            i += 1;
        } else if (arg.startsWith('--id=')) {
            id = arg.slice('--id='.length);
            if (!id) throw new Error('Missing value for --id.');
        } else {
            throw new Error('Usage: pnpm deploy:check [--id <deployment-id>]');
        }
    }
    return id;
}

function shortAddress(address: string): string {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function main(): Promise<void> {
    const id = parseId(process.argv.slice(2));
    requireNetworkConfigured();
    const { network } = loadNetworkEnv();
    const nodeUrl = getAztecNodeUrlFromNetwork();
    const manifest = resolveCompletedDeployment(network, id);
    const addresses = addressesFromManifest(manifest);
    const nameWidth = Math.max(
        ...Object.keys(addresses).map((name) => name.length)
    );

    console.log(
        `Checking ${manifest.id} (${relativeManifestPath(network, manifest.id)})`
    );
    console.log(`Node: ${nodeUrl}\n`);

    const results = await inspectContractsOnChain(
        createTolerantAztecNodeClient(nodeUrl),
        addresses
    );
    let missing = 0;
    for (const entry of results) {
        const tag = entry.onChain ? 'OK     ' : 'MISSING';
        console.log(
            `  ${tag}  ${entry.name.padEnd(nameWidth)}  ${shortAddress(entry.address)}`
        );
        if (!entry.onChain) missing += 1;
    }

    console.log('');
    if (missing > 0) {
        throw new Error(
            `${missing} contract(s) are not on this chain. Check AZTEC_NETWORK/AZTEC_NODE_URL or run pnpm deploy:run.`
        );
    }
    console.log(`${results.length} contracts found on-chain.`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
