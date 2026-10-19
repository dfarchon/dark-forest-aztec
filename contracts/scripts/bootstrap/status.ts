/**
 * Read-only report of system storage pointers and storage authorization.
 *
 *   pnpm bootstrap:status
 *   pnpm bootstrap:status --id <deployment-id>
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { unwrapSimulateResult } from '@dfpunk/utils';

import {
    bootstrapExpectsAuthorized,
    type StorageContractName,
    type SystemContractName,
} from './auth.ts';
import { openBootstrapContext, parseBootstrapTargetArgs } from './context.ts';

type PointerField = {
    field: string;
    target: StorageContractName | 'Config';
};

const ADMIN_FIELDS: PointerField[] = [
    { field: 'config_storage_address', target: 'Config' },
    { field: 'world_storage_address', target: 'WorldStorage' },
    { field: 'player_storage_address', target: 'PlayerStorage' },
    { field: 'planet_storage_address', target: 'PlanetStorage' },
];

const CORE_FIELDS: PointerField[] = [
    ...ADMIN_FIELDS,
    {
        field: 'planet_revealed_coords_storage_address',
        target: 'PlanetRevealedCoordsStorage',
    },
    { field: 'planet_events_storage_address', target: 'PlanetEventsStorage' },
    {
        field: 'planet_artifacts_storage_address',
        target: 'PlanetArtifactsStorage',
    },
    { field: 'arrivals_storage_address', target: 'ArrivalStorage' },
    { field: 'artifact_storage_address', target: 'ArtifactStorage' },
    {
        field: 'artifact_location_storage_address',
        target: 'ArtifactLocationStorage',
    },
];

const MOVE_FIELDS: PointerField[] = [
    { field: 'config_storage_address', target: 'Config' },
    { field: 'world_storage_address', target: 'WorldStorage' },
    { field: 'player_storage_address', target: 'PlayerStorage' },
    { field: 'planet_storage_address', target: 'PlanetStorage' },
    { field: 'planet_events_storage_address', target: 'PlanetEventsStorage' },
    {
        field: 'planet_artifacts_storage_address',
        target: 'PlanetArtifactsStorage',
    },
    { field: 'arrivals_storage_address', target: 'ArrivalStorage' },
    { field: 'artifact_storage_address', target: 'ArtifactStorage' },
    {
        field: 'artifact_location_storage_address',
        target: 'ArtifactLocationStorage',
    },
];

const ARTIFACT_FIELDS: PointerField[] = [
    { field: 'config_storage_address', target: 'Config' },
    { field: 'arrivals_storage_address', target: 'ArrivalStorage' },
    { field: 'artifact_storage_address', target: 'ArtifactStorage' },
    {
        field: 'artifact_location_storage_address',
        target: 'ArtifactLocationStorage',
    },
    { field: 'planet_storage_address', target: 'PlanetStorage' },
    {
        field: 'planet_artifacts_storage_address',
        target: 'PlanetArtifactsStorage',
    },
    { field: 'planet_events_storage_address', target: 'PlanetEventsStorage' },
    { field: 'player_storage_address', target: 'PlayerStorage' },
    { field: 'world_storage_address', target: 'WorldStorage' },
];

function getField(value: Record<string, unknown>, field: string): unknown {
    if (field in value) return value[field];
    const camel = field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return value[camel];
}

function normalizeAddress(value: unknown): string {
    if (value === null || value === undefined) {
        throw new Error('Missing address value');
    }
    return AztecAddress.fromStringUnsafe(String(value)).toString();
}

function shortAddress(value: string): string {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function requiredContract(
    contracts: Record<string, ContractBase>,
    name: string
): ContractBase {
    const contract = contracts[name];
    if (!contract) throw new Error(`Contract ${name} is not connected.`);
    return contract;
}

async function main(): Promise<void> {
    const target = parseBootstrapTargetArgs(process.argv.slice(2));
    if (target.rest.filter((arg) => arg !== '--').length > 0) {
        throw new Error('Usage: pnpm bootstrap:status [--id <deployment-id>]');
    }
    const context = await openBootstrapContext({
        id: target.id,
        commandHint: 'pnpm bootstrap:status',
        readonly: true,
    });
    const { addresses, contracts, session } = context;
    const simOpts = { from: session.deployer };
    const storageByName: Record<StorageContractName, ContractBase> = {
        WorldStorage: requiredContract(contracts, 'WorldStorage'),
        PlayerStorage: requiredContract(contracts, 'PlayerStorage'),
        PlanetStorage: requiredContract(contracts, 'PlanetStorage'),
        PlanetRevealedCoordsStorage: requiredContract(
            contracts,
            'PlanetRevealedCoordsStorage'
        ),
        PlanetEventsStorage: requiredContract(contracts, 'PlanetEventsStorage'),
        PlanetArtifactsStorage: requiredContract(
            contracts,
            'PlanetArtifactsStorage'
        ),
        ArrivalStorage: requiredContract(contracts, 'ArrivalStorage'),
        ArtifactStorage: requiredContract(contracts, 'ArtifactStorage'),
        ArtifactLocationStorage: requiredContract(
            contracts,
            'ArtifactLocationStorage'
        ),
    };
    const sections: Array<{
        name: SystemContractName;
        contract: ContractBase;
        fields: PointerField[];
    }> = [
        {
            name: 'Admin',
            contract: requiredContract(contracts, 'Admin'),
            fields: ADMIN_FIELDS,
        },
        {
            name: 'Core',
            contract: requiredContract(contracts, 'Core'),
            fields: CORE_FIELDS,
        },
        {
            name: 'Move',
            contract: requiredContract(contracts, 'Move'),
            fields: MOVE_FIELDS,
        },
        ...(
            [
                'ArtifactAction',
                'ArtifactFind',
                'ArtifactProspect',
                'ArtifactValut',
            ] as const
        ).map((name) => ({
            name,
            contract: requiredContract(contracts, name),
            fields: ARTIFACT_FIELDS,
        })),
    ];

    let failures = 0;
    console.log('\nSystem storage pointers and authorization');
    for (const section of sections) {
        console.log(
            `\n[${section.name}] ${section.contract.address.toString()}`
        );
        const pointers = unwrapSimulateResult(
            await section.contract.methods
                .get_all_storage_addresses_unconstrained()
                .simulate(simOpts)
        ) as Record<string, unknown>;

        for (const row of section.fields) {
            let actual: string;
            try {
                actual = normalizeAddress(getField(pointers, row.field));
            } catch (err) {
                failures += 1;
                console.log(`  FAIL ${row.field}: ${String(err)}`);
                continue;
            }
            const expected = normalizeAddress(addresses[row.target]);
            if (actual !== expected) {
                failures += 1;
                console.log(
                    `  FAIL ${row.field}: chain ${shortAddress(actual)} != manifest ${shortAddress(expected)}`
                );
                continue;
            }

            if (row.target === 'Config') {
                console.log(
                    `  OK   ${row.field}: ${shortAddress(actual)} (manifest)`
                );
                continue;
            }
            const storage = storageByName[row.target];
            const methods = storage.methods as unknown as {
                is_authorized: (address: AztecAddress) => {
                    simulate: (options?: object) => Promise<unknown>;
                };
            };
            const authorized = unwrapSimulateResult(
                await methods
                    .is_authorized(section.contract.address)
                    .simulate(simOpts)
            ) as boolean;
            const expectedAuth = bootstrapExpectsAuthorized(
                section.name,
                row.target
            );
            if (authorized !== expectedAuth) {
                failures += 1;
                console.log(
                    `  FAIL ${row.field}: pointer OK, authorized=${authorized}, expected=${expectedAuth}`
                );
            } else {
                console.log(
                    `  OK   ${row.field}: ${shortAddress(actual)}, authorized=${authorized}`
                );
            }
        }
    }

    if (failures > 0) {
        throw new Error(`${failures} bootstrap status checks failed.`);
    }
    console.log('\nAll pointer and authorization checks passed.');
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
