/**
 * Chain-side checks for a completed deploy manifest.
 * Used by `pnpm deploy:check` and by bootstrap before it sends txs.
 */
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { AztecNode } from '@aztec-labs/aztec.js/node';

import {
    type DeployManifest,
    findLatestCompleteManifest,
    readManifest,
} from './manifest.ts';

export type OnChainContract = {
    name: string;
    address: string;
    onChain: boolean;
};

export function resolveCompletedDeployment(
    network: string,
    id?: string
): DeployManifest {
    const manifest = id
        ? readManifest(network, id)
        : findLatestCompleteManifest(network);
    if (!manifest) {
        throw new Error(
            `No complete deployment on ${network}. Run pnpm deploy:run first.`
        );
    }
    if (manifest.status !== 'complete') {
        throw new Error(
            `Deployment ${manifest.id} is ${manifest.status}; expected complete.`
        );
    }
    return manifest;
}

export function addressesFromManifest(
    manifest: DeployManifest
): Record<string, string> {
    const addresses: Record<string, string> = {};
    for (const entry of manifest.contracts) {
        if (entry.status !== 'deployed' || !entry.address) {
            throw new Error(
                `Deployment ${manifest.id}: ${entry.name} is missing a deployed address.`
            );
        }
        addresses[entry.name] = entry.address;
    }
    return addresses;
}

export async function inspectContractsOnChain(
    node: AztecNode,
    addresses: Readonly<Record<string, string>>
): Promise<OnChainContract[]> {
    const results: OnChainContract[] = [];
    for (const [name, address] of Object.entries(addresses)) {
        const instance = await node.getContract(
            AztecAddress.fromStringUnsafe(address)
        );
        results.push({ name, address, onChain: instance != null });
    }
    return results;
}

/**
 * Assert that every named contract address exists on the node's current chain.
 * Reports all missing contracts together.
 */
export async function assertContractsDeployed(
    node: AztecNode,
    addresses: Readonly<Record<string, string>>
): Promise<OnChainContract[]> {
    const results = await inspectContractsOnChain(node, addresses);
    const missing = results.filter((entry) => !entry.onChain);
    if (missing.length === 0) return results;

    const details = missing
        .map(({ name, address }) => `  - ${name}: ${address}`)
        .join('\n');
    throw new Error(
        `Contracts from the deployment manifest are not present on the current chain:\n${details}\n` +
            'Check AZTEC_NETWORK/AZTEC_NODE_URL or run pnpm deploy:run.'
    );
}
