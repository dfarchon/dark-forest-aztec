/**
 * Post-configure verification: for each system contract, read on-chain storage pointers,
 * compare to .env, and check is_authorized vs configure Phase 3–4 expectations
 * (see storageAuthorizationExpectations.ts).
 *
 * Usage: pnpm verify-perms
 * Requires: same .env as configure (ACCOUNT_*, *_CONTRACT_ADDRESS).
 *
 * Account: `resolveDeployerAccount(..., { mode: 'loadOnly', readonlyVerification: true })` loads
 * the same ACCOUNT_* wallet as other scripts. The account must already be deployed on this chain —
 * this script does not deploy the account contract, game contracts, or send configure txs.
 * Aztec.js `simulate()` still needs a `from` address so the wallet/PXE can run the call.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';

import {
    getAztecNodeUrl,
    getContractInstances,
    getProverEnabled,
    getRequiredEnv,
    getSponsoredPFCContract,
    loadContractsEnv,
    resolveDeployerAccount,
    setupWallet,
    unwrapSimulateResult,
} from '../utils/index.ts';
import {
    configureExpectsAuthorized,
    type StorageContractName,
    type SystemContractName,
} from './storageAuthorizationExpectations.ts';

loadContractsEnv();

const AZTEC_NODE_URL = getAztecNodeUrl();
const PROVER_ENABLED = getProverEnabled();
const isLocalSandbox =
    /^https?:\/\/localhost(:\d+)?$/i.test(AZTEC_NODE_URL) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(AZTEC_NODE_URL);

const CONTRACT_SPECS = [
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
        name: 'Admin',
        modulePath: './artifacts/Admin.ts',
        exportName: 'AdminContract',
    },
    {
        name: 'Core',
        modulePath: './artifacts/Core.ts',
        exportName: 'CoreContract',
    },
    {
        name: 'Move',
        modulePath: './artifacts/Move.ts',
        exportName: 'MoveContract',
    },
    {
        name: 'ArtifactAction',
        modulePath: './artifacts/ArtifactAction.ts',
        exportName: 'ArtifactActionContract',
    },
    {
        name: 'ArtifactFind',
        modulePath: './artifacts/ArtifactFind.ts',
        exportName: 'ArtifactFindContract',
    },
    {
        name: 'ArtifactProspect',
        modulePath: './artifacts/ArtifactProspect.ts',
        exportName: 'ArtifactProspectContract',
    },
    {
        name: 'ArtifactValut',
        modulePath: './artifacts/ArtifactValut.ts',
        exportName: 'ArtifactValutContract',
    },
];

function addressesFromEnv(): Record<string, string> {
    const envKeys: Array<[string, string]> = [
        ['Config', 'CONFIG_CONTRACT_ADDRESS'],
        ['WorldStorage', 'WORLD_STORAGE_CONTRACT_ADDRESS'],
        ['PlayerStorage', 'PLAYER_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetStorage', 'PLANET_STORAGE_CONTRACT_ADDRESS'],
        [
            'PlanetRevealedCoordsStorage',
            'PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS',
        ],
        ['PlanetEventsStorage', 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetArtifactsStorage', 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS'],
        ['ArrivalStorage', 'ARRIVAL_STORAGE_CONTRACT_ADDRESS'],
        ['ArtifactStorage', 'ARTIFACT_STORAGE_CONTRACT_ADDRESS'],
        [
            'ArtifactLocationStorage',
            'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
        ],
        ['Admin', 'ADMIN_CONTRACT_ADDRESS'],
        ['Core', 'CORE_CONTRACT_ADDRESS'],
        ['Move', 'MOVE_CONTRACT_ADDRESS'],
        ['ArtifactAction', 'ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS'],
        ['ArtifactFind', 'ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS'],
        ['ArtifactProspect', 'ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS'],
        ['ArtifactValut', 'ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS'],
    ];
    const out: Record<string, string> = {};
    for (const [name, key] of envKeys) {
        out[name] = getRequiredEnv(key);
    }
    return out;
}

type PointerField = {
    field: string;
    envKey: string;
    storage: StorageContractName | 'Config';
};

const ADMIN_FIELDS: PointerField[] = [
    {
        field: 'config_storage_address',
        envKey: 'CONFIG_CONTRACT_ADDRESS',
        storage: 'Config',
    },
    {
        field: 'world_storage_address',
        envKey: 'WORLD_STORAGE_CONTRACT_ADDRESS',
        storage: 'WorldStorage',
    },
    {
        field: 'player_storage_address',
        envKey: 'PLAYER_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlayerStorage',
    },
    {
        field: 'planet_storage_address',
        envKey: 'PLANET_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetStorage',
    },
];

const CORE_FIELDS: PointerField[] = [
    {
        field: 'config_storage_address',
        envKey: 'CONFIG_CONTRACT_ADDRESS',
        storage: 'Config',
    },
    {
        field: 'world_storage_address',
        envKey: 'WORLD_STORAGE_CONTRACT_ADDRESS',
        storage: 'WorldStorage',
    },
    {
        field: 'player_storage_address',
        envKey: 'PLAYER_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlayerStorage',
    },
    {
        field: 'planet_storage_address',
        envKey: 'PLANET_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetStorage',
    },
    {
        field: 'planet_revealed_coords_storage_address',
        envKey: 'PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetRevealedCoordsStorage',
    },
    {
        field: 'planet_events_storage_address',
        envKey: 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetEventsStorage',
    },
    {
        field: 'planet_artifacts_storage_address',
        envKey: 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetArtifactsStorage',
    },
    {
        field: 'arrivals_storage_address',
        envKey: 'ARRIVAL_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArrivalStorage',
    },
    {
        field: 'artifact_storage_address',
        envKey: 'ARTIFACT_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArtifactStorage',
    },
    {
        field: 'artifact_location_storage_address',
        envKey: 'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArtifactLocationStorage',
    },
];

const MOVE_FIELDS: PointerField[] = [
    {
        field: 'config_storage_address',
        envKey: 'CONFIG_CONTRACT_ADDRESS',
        storage: 'Config',
    },
    {
        field: 'world_storage_address',
        envKey: 'WORLD_STORAGE_CONTRACT_ADDRESS',
        storage: 'WorldStorage',
    },
    {
        field: 'player_storage_address',
        envKey: 'PLAYER_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlayerStorage',
    },
    {
        field: 'planet_storage_address',
        envKey: 'PLANET_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetStorage',
    },
    {
        field: 'planet_events_storage_address',
        envKey: 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetEventsStorage',
    },
    {
        field: 'planet_artifacts_storage_address',
        envKey: 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetArtifactsStorage',
    },
    {
        field: 'arrivals_storage_address',
        envKey: 'ARRIVAL_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArrivalStorage',
    },
    {
        field: 'artifact_storage_address',
        envKey: 'ARTIFACT_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArtifactStorage',
    },
    {
        field: 'artifact_location_storage_address',
        envKey: 'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArtifactLocationStorage',
    },
];

const ARTIFACT_FIELDS: PointerField[] = [
    {
        field: 'config_storage_address',
        envKey: 'CONFIG_CONTRACT_ADDRESS',
        storage: 'Config',
    },
    {
        field: 'arrivals_storage_address',
        envKey: 'ARRIVAL_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArrivalStorage',
    },
    {
        field: 'artifact_storage_address',
        envKey: 'ARTIFACT_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArtifactStorage',
    },
    {
        field: 'artifact_location_storage_address',
        envKey: 'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
        storage: 'ArtifactLocationStorage',
    },
    {
        field: 'planet_storage_address',
        envKey: 'PLANET_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetStorage',
    },
    {
        field: 'planet_artifacts_storage_address',
        envKey: 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetArtifactsStorage',
    },
    {
        field: 'planet_events_storage_address',
        envKey: 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlanetEventsStorage',
    },
    {
        field: 'player_storage_address',
        envKey: 'PLAYER_STORAGE_CONTRACT_ADDRESS',
        storage: 'PlayerStorage',
    },
    {
        field: 'world_storage_address',
        envKey: 'WORLD_STORAGE_CONTRACT_ADDRESS',
        storage: 'WorldStorage',
    },
];

function snakeToCamel(s: string): string {
    return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function getStructField(obj: Record<string, unknown>, field: string): unknown {
    if (field in obj) return obj[field];
    const camel = snakeToCamel(field);
    if (camel in obj) return obj[camel];
    return undefined;
}

function normalizeAddress(value: unknown): string {
    if (value === null || value === undefined) {
        throw new Error('Missing address value');
    }
    if (typeof value === 'string') {
        return AztecAddress.fromStringUnsafe(value).toString();
    }
    if (value instanceof AztecAddress) {
        return value.toString();
    }
    if (typeof value === 'object' && value !== null && 'toString' in value) {
        const s = (value as { toString: () => string }).toString();
        return AztecAddress.fromStringUnsafe(s).toString();
    }
    throw new Error(`Cannot normalize address: ${String(value)}`);
}

function getIsAuthorizedMethod(storage: ContractBase) {
    return storage.methods as unknown as {
        is_authorized: (a: AztecAddress) => {
            simulate: (o?: object) => Promise<unknown>;
        };
    };
}

async function main() {
    const addresses = addressesFromEnv();
    let failures = 0;

    console.log(
        '🔍 System → storage pointers & is_authorized (vs configure.ts)\n'
    );
    console.log(`Aztec Node URL: ${AZTEC_NODE_URL}`);
    if (PROVER_ENABLED && isLocalSandbox) {
        console.warn(
            '⚠️  Prover ON: verification may be slow. For local sandbox, PROVER_ENABLED=false is faster.\n'
        );
    }

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const simulationSender = await resolveDeployerAccount(wallet, aztecNode, {
        mode: 'loadOnly',
        readonlyVerification: true,
        deployTimeoutMs: 120_000,
    });
    const simOpts = { from: simulationSender };

    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );

    const storageByName = {
        WorldStorage: contracts['WorldStorage']!,
        PlayerStorage: contracts['PlayerStorage']!,
        PlanetStorage: contracts['PlanetStorage']!,
        PlanetRevealedCoordsStorage: contracts['PlanetRevealedCoordsStorage']!,
        PlanetEventsStorage: contracts['PlanetEventsStorage']!,
        PlanetArtifactsStorage: contracts['PlanetArtifactsStorage']!,
        ArrivalStorage: contracts['ArrivalStorage']!,
        ArtifactStorage: contracts['ArtifactStorage']!,
        ArtifactLocationStorage: contracts['ArtifactLocationStorage']!,
    };

    const admin = contracts['Admin']!;
    const core = contracts['Core']!;
    const move = contracts['Move']!;
    const artifactAction = contracts['ArtifactAction']!;
    const artifactFind = contracts['ArtifactFind']!;
    const artifactProspect = contracts['ArtifactProspect']!;
    const artifactValut = contracts['ArtifactValut']!;

    type Section = {
        title: SystemContractName;
        system: ContractBase;
        fields: PointerField[];
    };

    const sections: Section[] = [
        { title: 'Admin', system: admin, fields: ADMIN_FIELDS },
        { title: 'Core', system: core, fields: CORE_FIELDS },
        { title: 'Move', system: move, fields: MOVE_FIELDS },
        {
            title: 'ArtifactAction',
            system: artifactAction,
            fields: ARTIFACT_FIELDS,
        },
        {
            title: 'ArtifactFind',
            system: artifactFind,
            fields: ARTIFACT_FIELDS,
        },
        {
            title: 'ArtifactProspect',
            system: artifactProspect,
            fields: ARTIFACT_FIELDS,
        },
        {
            title: 'ArtifactValut',
            system: artifactValut,
            fields: ARTIFACT_FIELDS,
        },
    ];

    for (const { title, system, fields } of sections) {
        console.log(`\n━━━ [${title}] ${system.address.toString()} ━━━`);

        const raw = unwrapSimulateResult(
            await system.methods
                .get_all_storage_addresses_unconstrained()
                .simulate(simOpts)
        );
        const ptrs = raw as Record<string, unknown>;

        const shortAddr = (hex: string) =>
            hex.slice(0, 6) + '…' + hex.slice(-4);

        const fieldColWidth = Math.max(...fields.map((f) => f.field.length));

        type RowResult = {
            row: PointerField;
            ptrOk: boolean;
            onChain?: string;
            envAddr?: string;
            ptrError?: string;
            authOk?: boolean;
            authResult?: boolean;
            expectedAuth?: boolean;
        };

        const results: RowResult[] = [];

        for (const row of fields) {
            const rawVal = getStructField(ptrs, row.field);
            let onChain: string;
            try {
                onChain = normalizeAddress(rawVal);
            } catch (e) {
                results.push({ row, ptrOk: false, ptrError: String(e) });
                failures += 1;
                continue;
            }

            const expectedFromEnv = normalizeAddress(
                AztecAddress.fromStringUnsafe(getRequiredEnv(row.envKey))
            );

            if (onChain !== expectedFromEnv) {
                results.push({
                    row,
                    ptrOk: false,
                    onChain,
                    envAddr: expectedFromEnv,
                });
                failures += 1;
                continue;
            }

            const entry: RowResult = { row, ptrOk: true, onChain };

            if (row.storage !== 'Config') {
                const storage = storageByName[row.storage];
                const expectedAuth = configureExpectsAuthorized(
                    title,
                    row.storage
                );
                const authResult = unwrapSimulateResult(
                    await getIsAuthorizedMethod(storage)
                        .is_authorized(system.address)
                        .simulate(simOpts)
                ) as boolean;
                entry.authOk = authResult === expectedAuth;
                entry.authResult = authResult;
                entry.expectedAuth = expectedAuth;
                if (!entry.authOk) failures += 1;
            }

            results.push(entry);
        }

        for (const r of results) {
            const field = r.row.field.padEnd(fieldColWidth);

            if (!r.ptrOk) {
                if (r.onChain && r.envAddr) {
                    console.log(
                        `  ❌  ${field}  chain ${shortAddr(r.onChain)} ≠ .env ${shortAddr(r.envAddr)}  (${r.row.envKey})`
                    );
                } else {
                    console.log(
                        `  ❌  ${field}  ${r.ptrError}  (${r.row.envKey})`
                    );
                }
                continue;
            }

            const addrCol = `${shortAddr(r.onChain!)} = .env`;
            let authCol: string;
            if (r.authOk === undefined) {
                authCol = '';
            } else if (r.authOk) {
                authCol = `  🌹 authorized=${r.authResult}`;
            } else {
                authCol = `  💀 authorized=${r.authResult} (expected ${r.expectedAuth})`;
            }

            console.log(`  ✅  ${field}  ${addrCol}${authCol}`);
        }
    }

    console.log('');
    if (failures > 0) {
        console.log(`❌ Failed checks: ${failures}`);
        process.exit(1);
    }
    console.log('✅ All pointer and authorization checks passed.');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
