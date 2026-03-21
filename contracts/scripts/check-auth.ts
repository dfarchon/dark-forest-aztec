/**
 * Diagnostic: check whether Core/Move/Admin are authorized on each storage contract.
 * Uses unconstrained (utility) functions that read directly from the node's state tree.
 *
 * Usage: node --experimental-transform-types scripts/check-auth.ts
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import path from 'path';

import {
    getContractInstances,
    getSponsoredPFCContract,
    loadAccountFromEnv,
    setupWallet,
} from './utils/index.ts';

dotenv.config({
    path: path.join(import.meta.dirname, '..', '.env'),
    override: true,
});

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';

const CONTRACT_SPECS = [
    {
        name: 'WorldStorage',
        modulePath: './artifacts/WorldStorage.ts',
        exportName: 'WorldStorageContract',
    },
    {
        name: 'PlayerStorage',
        modulePath: './artifacts/PlayerStorage.ts',
        exportName: 'PlayerStorageContract',
    },
    {
        name: 'PlanetStorage',
        modulePath: './artifacts/PlanetStorage.ts',
        exportName: 'PlanetStorageContract',
    },
    {
        name: 'PlanetEventsStorage',
        modulePath: './artifacts/PlanetEventsStorage.ts',
        exportName: 'PlanetEventsStorageContract',
    },
    {
        name: 'PlanetArtifactsStorage',
        modulePath: './artifacts/PlanetArtifactsStorage.ts',
        exportName: 'PlanetArtifactsStorageContract',
    },
    {
        name: 'ArrivalStorage',
        modulePath: './artifacts/ArrivalStorage.ts',
        exportName: 'ArrivalStorageContract',
    },
    {
        name: 'ArtifactStorage',
        modulePath: './artifacts/ArtifactStorage.ts',
        exportName: 'ArtifactStorageContract',
    },
    {
        name: 'ArtifactLocationStorage',
        modulePath: './artifacts/ArtifactLocationStorage.ts',
        exportName: 'ArtifactLocationStorageContract',
    },
];

const ENV_KEYS: Array<[string, string]> = [
    ['WorldStorage', 'WORLD_STORAGE_CONTRACT_ADDRESS'],
    ['PlayerStorage', 'PLAYER_STORAGE_CONTRACT_ADDRESS'],
    ['PlanetStorage', 'PLANET_STORAGE_CONTRACT_ADDRESS'],
    ['PlanetEventsStorage', 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS'],
    ['PlanetArtifactsStorage', 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS'],
    ['ArrivalStorage', 'ARRIVAL_STORAGE_CONTRACT_ADDRESS'],
    ['ArtifactStorage', 'ARTIFACT_STORAGE_CONTRACT_ADDRESS'],
    ['ArtifactLocationStorage', 'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS'],
];

function addressesFromEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, key] of ENV_KEYS) {
        const v = process.env[key];
        if (!v) throw new Error(`Missing ${key} in .env`);
        out[name] = v;
    }
    return out;
}

async function main() {
    const coreAddr = process.env.CORE_CONTRACT_ADDRESS;
    const moveAddr = process.env.MOVE_CONTRACT_ADDRESS;
    const adminAddr = process.env.ADMIN_CONTRACT_ADDRESS;
    const accountAddr = process.env.ACCOUNT_ADDRESS;

    if (!coreAddr) throw new Error('Missing CORE_CONTRACT_ADDRESS');

    console.log('🔗 Connecting to:', AZTEC_NODE_URL);
    console.log('📋 Core:', coreAddr);
    console.log('📋 Move:', moveAddr);
    console.log('📋 Admin:', adminAddr);
    console.log('📋 Account (deployer):', accountAddr);

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: false,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
    const deployer = await loadAccountFromEnv(wallet, aztecNode);

    const addresses = addressesFromEnv();
    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );

    const checkAddrs = [
        { label: 'Core', addr: AztecAddress.fromString(coreAddr) },
    ];
    if (moveAddr)
        checkAddrs.push({
            label: 'Move',
            addr: AztecAddress.fromString(moveAddr),
        });
    if (adminAddr)
        checkAddrs.push({
            label: 'Admin',
            addr: AztecAddress.fromString(adminAddr),
        });

    console.log('\n🔍 Checking authorization state...\n');

    for (const [storageName, contract] of Object.entries(contracts)) {
        console.log(`--- ${storageName} (${contract.address.toString()}) ---`);

        const methods = contract.methods as Record<
            string,
            (...args: unknown[]) => {
                simulate: (opts?: object) => Promise<unknown>;
            }
        >;

        // Try unconstrained first (reads from node state tree directly)
        for (const { label, addr } of checkAddrs) {
            try {
                if (methods['is_authorized_unconstrained']) {
                    const result = await methods['is_authorized_unconstrained'](
                        addr
                    ).simulate({ from: deployer });
                    const isAuth =
                        typeof result === 'object' &&
                        result !== null &&
                        'result' in result
                            ? (result as { result: unknown }).result
                            : result;
                    console.log(
                        `  ${label} (${addr.toString().slice(0, 10)}...): ${isAuth ? '✅ authorized' : '❌ NOT authorized'}`
                    );
                } else if (methods['is_authorized']) {
                    const result = await methods['is_authorized'](
                        addr
                    ).simulate({ from: deployer });
                    const isAuth =
                        typeof result === 'object' &&
                        result !== null &&
                        'result' in result
                            ? (result as { result: unknown }).result
                            : result;
                    console.log(
                        `  ${label} (${addr.toString().slice(0, 10)}...): ${isAuth ? '✅ authorized' : '❌ NOT authorized'}`
                    );
                } else {
                    console.log(`  ${label}: ⚠️ no is_authorized method found`);
                }
            } catch (err) {
                console.log(
                    `  ${label}: ⚠️ error: ${err instanceof Error ? err.message : err}`
                );
            }
        }

        // Check authorized count
        try {
            if (methods['get_authorized_count_unconstrained']) {
                const countResult = await methods[
                    'get_authorized_count_unconstrained'
                ]().simulate({ from: deployer });
                const count =
                    typeof countResult === 'object' &&
                    countResult !== null &&
                    'result' in countResult
                        ? (countResult as { result: unknown }).result
                        : countResult;
                console.log(`  Authorized count: ${count}`);
            }
        } catch {
            /* ignore */
        }

        // Check admin
        try {
            if (methods['get_admin_unconstrained']) {
                const adminResult = await methods[
                    'get_admin_unconstrained'
                ]().simulate({ from: deployer });
                const admin =
                    typeof adminResult === 'object' &&
                    adminResult !== null &&
                    'result' in adminResult
                        ? (adminResult as { result: unknown }).result
                        : adminResult;
                console.log(`  Admin: ${admin}`);
            }
        } catch {
            /* ignore */
        }

        console.log('');
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
