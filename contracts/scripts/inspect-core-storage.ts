/**
 * Diagnostic: read Core's configured storage addresses (utility unconstrained),
 * compare to contracts/.env, and for each storage contract check whether **Core**
 * is authorized to write (`is_authorized_unconstrained(Core)`). Other systems
 * (Move, Admin, artifact apps) are not checked — scope is Core-only.
 *
 * Config has no is_authorized — only address comparison for that row.
 *
 * Usage: node --experimental-transform-types scripts/inspect-core-storage.ts
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import path from 'path';

import type { ContractSpec } from './utils/contracts.ts';
import {
    getContractInstances,
    getSponsoredPFCContract,
    loadAccountFromEnv,
    setupWallet,
} from './utils/index.ts';
import { unwrapSimulateResult } from './utils/simulate-result.ts';

dotenv.config({
    path: path.join(import.meta.dirname, '..', '.env'),
    override: true,
});

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';

/** Same order as Core.set_all_storage_addresses / get_all_storage_addresses_unconstrained */
const ROWS: Array<{
    label: string;
    envKey: string;
    /** For getContractInstances; Config has no auth check */
    specName: string;
    checkCoreAuthorized: boolean;
}> = [
    {
        label: 'Config',
        envKey: 'CONFIG_CONTRACT_ADDRESS',
        specName: 'Config',
        checkCoreAuthorized: false,
    },
    {
        label: 'WorldStorage',
        envKey: 'WORLD_STORAGE_CONTRACT_ADDRESS',
        specName: 'WorldStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'PlayerStorage',
        envKey: 'PLAYER_STORAGE_CONTRACT_ADDRESS',
        specName: 'PlayerStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'PlanetStorage',
        envKey: 'PLANET_STORAGE_CONTRACT_ADDRESS',
        specName: 'PlanetStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'PlanetRevealedCoordsStorage',
        envKey: 'PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS',
        specName: 'PlanetRevealedCoordsStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'PlanetEventsStorage',
        envKey: 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS',
        specName: 'PlanetEventsStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'PlanetArtifactsStorage',
        envKey: 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS',
        specName: 'PlanetArtifactsStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'ArrivalStorage',
        envKey: 'ARRIVAL_STORAGE_CONTRACT_ADDRESS',
        specName: 'ArrivalStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'ArtifactStorage',
        envKey: 'ARTIFACT_STORAGE_CONTRACT_ADDRESS',
        specName: 'ArtifactStorage',
        checkCoreAuthorized: true,
    },
    {
        label: 'ArtifactLocationStorage',
        envKey: 'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
        specName: 'ArtifactLocationStorage',
        checkCoreAuthorized: true,
    },
];

const CONTRACT_SPECS: ContractSpec[] = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
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
        name: 'PlanetRevealedCoordsStorage',
        modulePath: './artifacts/PlanetRevealedCoordsStorage.ts',
        exportName: 'PlanetRevealedCoordsStorageContract',
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
    {
        name: 'Core',
        modulePath: './artifacts/Core.ts',
        exportName: 'CoreContract',
    },
];

function toAddressString(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (
        typeof v === 'object' &&
        'toString' in v &&
        typeof (v as { toString: () => string }).toString === 'function'
    ) {
        return (v as { toString: () => string }).toString();
    }
    return String(v);
}

/** Unwrap simulate result for get_all_storage_addresses_unconstrained (tuple → 10 strings). */
function parseTenAddresses(raw: unknown): string[] {
    const unwrapped = unwrapSimulateResult(raw);
    if (Array.isArray(unwrapped)) {
        if (unwrapped.length !== 10) {
            throw new Error(
                `Expected 10 addresses, got array length ${unwrapped.length}`
            );
        }
        return unwrapped.map(toAddressString);
    }
    if (unwrapped !== null && typeof unwrapped === 'object') {
        const vals = Object.values(unwrapped as Record<string, unknown>);
        if (vals.length === 10) {
            return vals.map(toAddressString);
        }
    }
    throw new Error(
        `Unexpected get_all_storage_addresses_unconstrained shape: ${typeof unwrapped}`
    );
}

async function checkAuthorized(
    contract: ContractBase,
    deployer: AztecAddress,
    coreAddr: AztecAddress
): Promise<boolean | null> {
    const methods = contract.methods as Record<
        string,
        (...args: unknown[]) => {
            simulate: (opts?: object) => Promise<unknown>;
        }
    >;
    try {
        if (methods['is_authorized_unconstrained']) {
            const result = await methods['is_authorized_unconstrained'](
                coreAddr
            ).simulate({ from: deployer });
            const unwrapped = unwrapSimulateResult(result);
            return Boolean(unwrapped);
        }
        if (methods['is_authorized']) {
            const result = await methods['is_authorized'](coreAddr).simulate({
                from: deployer,
            });
            const unwrapped = unwrapSimulateResult(result);
            return Boolean(unwrapped);
        }
    } catch {
        return null;
    }
    return null;
}

async function main() {
    const coreAddrStr = process.env.CORE_CONTRACT_ADDRESS;
    if (!coreAddrStr) throw new Error('Missing CORE_CONTRACT_ADDRESS');

    console.log('🔗 Connecting to:', AZTEC_NODE_URL);
    console.log('📋 Core:', coreAddrStr);

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: false,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
    const deployer = await loadAccountFromEnv(wallet, aztecNode);

    const coreAddr = AztecAddress.fromString(coreAddrStr);
    const instances = await getContractInstances(
        wallet,
        { Core: coreAddrStr },
        CONTRACT_SPECS.filter((s) => s.name === 'Core')
    );
    const core = instances['Core'];
    if (!core) throw new Error('Failed to load Core contract');

    console.log(
        '\n📖 On-chain Core storage addresses (get_all_storage_addresses_unconstrained)...\n'
    );

    const simRaw = await core.methods
        .get_all_storage_addresses_unconstrained()
        .simulate({ from: deployer });
    const chainAddresses = parseTenAddresses(simRaw);

    const addressMap: Record<string, string> = {};
    for (let i = 0; i < ROWS.length; i++) {
        addressMap[ROWS[i].specName] = chainAddresses[i];
    }

    const storageInstances = await getContractInstances(
        wallet,
        addressMap,
        CONTRACT_SPECS.filter((s) => s.name !== 'Core')
    );

    for (let i = 0; i < ROWS.length; i++) {
        const row = ROWS[i];
        const chain = chainAddresses[i];
        const envVal = process.env[row.envKey];
        const envNorm = envVal?.trim();

        let match: string;
        if (!envNorm) {
            match = '⚠️ env missing';
        } else if (chain.toLowerCase() === envNorm.toLowerCase()) {
            match = '✅ MATCH';
        } else {
            match = '❌ MISMATCH';
        }

        console.log(`--- ${row.label} ---`);
        console.log(`  Chain (Core): ${chain}`);
        console.log(`  .env [${row.envKey}]: ${envNorm ?? '(unset)'}`);
        console.log(`  Compare: ${match}`);

        if (row.checkCoreAuthorized) {
            const c = storageInstances[row.specName];
            if (!c) {
                console.log(
                    `  Core write access (this storage authorizes Core): ⚠️ could not load contract instance`
                );
            } else {
                const auth = await checkAuthorized(c, deployer, coreAddr);
                if (auth === null) {
                    console.log(
                        `  Core write access (is_authorized*): ⚠️ no method or simulate error`
                    );
                } else {
                    console.log(
                        `  Core write access (this storage authorizes Core): ${auth ? '✅ yes' : '❌ no'}`
                    );
                }
            }
        } else {
            console.log(
                `  Core write access: (skipped — Config has no is_authorized; address compare only)`
            );
        }
        console.log('');
    }

    console.log('✅ inspect-core-storage done.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
