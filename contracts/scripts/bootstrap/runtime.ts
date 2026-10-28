import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { ContractBase } from '@aztec-labs/aztec.js/contracts';
import { unwrapSimulateResult } from '@dfpunk/utils';

import { buildSendOpts } from '../utils/feePayment.ts';
import {
    ARTIFACT_SYSTEM_NAMES,
    PHASE3_AUTHORIZED_BY_STORAGE,
    PHASE4_ARTIFACT_EXTRA_STORAGES,
    type StorageContractName,
    type SystemContractName,
} from './auth.ts';
import type { BootstrapContext } from './context.ts';
import {
    BOOTSTRAP_STEP_META,
    classifyAuthorization,
    classifyBatch1,
    classifyBatch2,
    classifyCumulativeRarities,
    classifyPlanetStatsRange,
    classifyPlanetWeightsTier,
    classifyPointers,
    classifyUpgradeConfig,
    classifyUpgradesBranch,
    EXPECTED_UPGRADE_DEFENSE,
    EXPECTED_UPGRADE_RANGE,
    EXPECTED_UPGRADE_SPEED,
    normalizeAddressLoose,
    PLANET_DEFAULT_STATS,
    type StepStatus,
    TOTAL_BOOTSTRAP_STEPS,
} from './steps.ts';

export type BootstrapRuntimeStep = {
    meta: (typeof BOOTSTRAP_STEP_META)[number];
    check: () => Promise<StepStatus>;
    execute: () => Promise<void>;
};

const PHASE3_STORAGE_ORDER: StorageContractName[] = [
    'WorldStorage',
    'PlayerStorage',
    'PlanetStorage',
    'PlanetRevealedCoordsStorage',
    'PlanetEventsStorage',
    'PlanetArtifactsStorage',
    'ArrivalStorage',
    'ArtifactStorage',
    'ArtifactLocationStorage',
];

const ADMIN_POINTER_FIELDS = [
    'config_storage_address',
    'world_storage_address',
    'player_storage_address',
    'planet_storage_address',
] as const;

const CORE_POINTER_FIELDS = [
    'config_storage_address',
    'world_storage_address',
    'player_storage_address',
    'planet_storage_address',
    'planet_revealed_coords_storage_address',
    'planet_events_storage_address',
    'planet_artifacts_storage_address',
    'arrivals_storage_address',
    'artifact_storage_address',
    'artifact_location_storage_address',
] as const;

const MOVE_POINTER_FIELDS = [
    'config_storage_address',
    'world_storage_address',
    'player_storage_address',
    'planet_storage_address',
    'planet_events_storage_address',
    'planet_artifacts_storage_address',
    'arrivals_storage_address',
    'artifact_storage_address',
    'artifact_location_storage_address',
] as const;

const ARTIFACT_POINTER_FIELDS = [
    'config_storage_address',
    'arrivals_storage_address',
    'artifact_storage_address',
    'artifact_location_storage_address',
    'planet_storage_address',
    'planet_artifacts_storage_address',
    'planet_events_storage_address',
    'player_storage_address',
    'world_storage_address',
] as const;

function requiredContract(
    contracts: Record<string, ContractBase>,
    name: string
): ContractBase {
    const contract = contracts[name];
    if (!contract) throw new Error(`Contract ${name} is not connected.`);
    return contract;
}

function addr(addresses: Record<string, string>, name: string): string {
    return normalizeAddressLoose(addresses[name]);
}

export function buildBootstrapSteps(
    context: BootstrapContext
): BootstrapRuntimeStep[] {
    const { addresses, contracts, session } = context;
    const config = requiredContract(contracts, 'Config');
    const admin = requiredContract(contracts, 'Admin');
    const core = requiredContract(contracts, 'Core');
    const move = requiredContract(contracts, 'Move');
    const artifactAction = requiredContract(contracts, 'ArtifactAction');
    const artifactFind = requiredContract(contracts, 'ArtifactFind');
    const artifactProspect = requiredContract(contracts, 'ArtifactProspect');
    const artifactValut = requiredContract(contracts, 'ArtifactValut');

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
    const systemInstances: Record<SystemContractName, ContractBase> = {
        Admin: admin,
        Core: core,
        Move: move,
        ArtifactAction: artifactAction,
        ArtifactFind: artifactFind,
        ArtifactProspect: artifactProspect,
        ArtifactValut: artifactValut,
    };
    const opts = buildSendOpts(session.deployer, session.feeCtx);
    const simOpts = { from: session.deployer };
    const readFullConfig = (): Promise<Record<string, unknown>> =>
        config.methods
            .get_full_config_unconstrained()
            .simulate(simOpts)
            .then(
                (value: unknown) =>
                    unwrapSimulateResult(value) as Record<string, unknown>
            );
    const readConfigHashes = (): Promise<unknown[]> =>
        config.methods
            .get_all_config_hashes_unconstrained()
            .simulate(simOpts)
            .then((value: unknown) => unwrapSimulateResult(value) as unknown[]);

    const readPointers = async (
        system: ContractBase
    ): Promise<Record<string, unknown>> =>
        unwrapSimulateResult(
            await system.methods
                .get_all_storage_addresses_unconstrained()
                .simulate(simOpts)
        ) as Record<string, unknown>;

    const readAuthFlags = async (
        storage: ContractBase,
        contractAddrs: AztecAddress[]
    ): Promise<boolean[]> => {
        const methods = storage.methods as unknown as {
            is_authorized: (address: AztecAddress) => {
                simulate: (options?: object) => Promise<unknown>;
            };
        };
        const flags: boolean[] = [];
        for (const address of contractAddrs) {
            flags.push(
                unwrapSimulateResult(
                    await methods.is_authorized(address).simulate(simOpts)
                ) as boolean
            );
        }
        return flags;
    };

    const addAuthorizedBatchIfNeeded = async (
        storage: ContractBase,
        contractAddrs: AztecAddress[]
    ): Promise<void> => {
        const methods = storage.methods as unknown as {
            is_authorized: (address: AztecAddress) => {
                simulate: (options?: object) => Promise<unknown>;
            };
            add_authorized_contracts_batch: (
                addresses: [AztecAddress, AztecAddress, AztecAddress],
                count: number
            ) => { send: (options: typeof opts) => Promise<unknown> };
        };
        const missing: AztecAddress[] = [];
        for (const address of contractAddrs) {
            const authorized = unwrapSimulateResult(
                await methods.is_authorized(address).simulate(simOpts)
            ) as boolean;
            if (!authorized) missing.push(address);
        }
        for (let i = 0; i < missing.length; i += 3) {
            const chunk = missing.slice(i, i + 3);
            const padded: [AztecAddress, AztecAddress, AztecAddress] = [
                chunk[0] ?? AztecAddress.zero(),
                chunk[1] ?? AztecAddress.zero(),
                chunk[2] ?? AztecAddress.zero(),
            ];
            await methods
                .add_authorized_contracts_batch(padded, chunk.length)
                .send(opts);
        }
    };

    const adminExpected = {
        config_storage_address: addr(addresses, 'Config'),
        world_storage_address: addr(addresses, 'WorldStorage'),
        player_storage_address: addr(addresses, 'PlayerStorage'),
        planet_storage_address: addr(addresses, 'PlanetStorage'),
    };
    const coreExpected = {
        ...adminExpected,
        planet_revealed_coords_storage_address: addr(
            addresses,
            'PlanetRevealedCoordsStorage'
        ),
        planet_events_storage_address: addr(addresses, 'PlanetEventsStorage'),
        planet_artifacts_storage_address: addr(
            addresses,
            'PlanetArtifactsStorage'
        ),
        arrivals_storage_address: addr(addresses, 'ArrivalStorage'),
        artifact_storage_address: addr(addresses, 'ArtifactStorage'),
        artifact_location_storage_address: addr(
            addresses,
            'ArtifactLocationStorage'
        ),
    };
    const moveExpected = {
        config_storage_address: addr(addresses, 'Config'),
        world_storage_address: addr(addresses, 'WorldStorage'),
        player_storage_address: addr(addresses, 'PlayerStorage'),
        planet_storage_address: addr(addresses, 'PlanetStorage'),
        planet_events_storage_address: addr(addresses, 'PlanetEventsStorage'),
        planet_artifacts_storage_address: addr(
            addresses,
            'PlanetArtifactsStorage'
        ),
        arrivals_storage_address: addr(addresses, 'ArrivalStorage'),
        artifact_storage_address: addr(addresses, 'ArtifactStorage'),
        artifact_location_storage_address: addr(
            addresses,
            'ArtifactLocationStorage'
        ),
    };
    const artifactExpected = {
        config_storage_address: addr(addresses, 'Config'),
        arrivals_storage_address: addr(addresses, 'ArrivalStorage'),
        artifact_storage_address: addr(addresses, 'ArtifactStorage'),
        artifact_location_storage_address: addr(
            addresses,
            'ArtifactLocationStorage'
        ),
        planet_storage_address: addr(addresses, 'PlanetStorage'),
        planet_artifacts_storage_address: addr(
            addresses,
            'PlanetArtifactsStorage'
        ),
        planet_events_storage_address: addr(addresses, 'PlanetEventsStorage'),
        player_storage_address: addr(addresses, 'PlayerStorage'),
        world_storage_address: addr(addresses, 'WorldStorage'),
    };

    const artifactSystems = [
        artifactAction,
        artifactFind,
        artifactProspect,
        artifactValut,
    ] as const;
    const artifactStorageArgs = [
        config.address,
        storageByName.ArrivalStorage.address,
        storageByName.ArtifactStorage.address,
        storageByName.ArtifactLocationStorage.address,
        storageByName.PlanetStorage.address,
        storageByName.PlanetArtifactsStorage.address,
        storageByName.PlanetEventsStorage.address,
        storageByName.PlayerStorage.address,
        storageByName.WorldStorage.address,
    ] as const;
    const artifactSystemAddresses = ARTIFACT_SYSTEM_NAMES.map(
        (name) => systemInstances[name].address
    );

    const steps: BootstrapRuntimeStep[] = [
        {
            meta: BOOTSTRAP_STEP_META[0]!,
            check: async () =>
                classifyBatch1(
                    await readFullConfig(),
                    await readConfigHashes()
                ),
            execute: async () => {
                await config.methods.set_default_configs_batch_1().send(opts);
            },
        },
        {
            meta: BOOTSTRAP_STEP_META[1]!,
            check: async () =>
                classifyBatch2(
                    await readFullConfig(),
                    await readConfigHashes()
                ),
            execute: async () => {
                await config.methods.set_default_configs_batch_2().send(opts);
            },
        },
        ...([0, 1, 2, 3] as const).map((tier) => ({
            meta: BOOTSTRAP_STEP_META[2 + tier]!,
            check: async () =>
                classifyPlanetWeightsTier(
                    await readFullConfig(),
                    tier,
                    await readConfigHashes()
                ),
            execute: async () => {
                await config.methods
                    .set_default_game_config_planet_type_weights_tier(tier)
                    .send(opts);
            },
        })),
        ...([0, 5] as const).map((start, i) => ({
            meta: BOOTSTRAP_STEP_META[6 + i]!,
            check: async () =>
                classifyPlanetStatsRange(
                    await readFullConfig(),
                    start,
                    start + 4
                ),
            execute: async () => {
                const batch = PLANET_DEFAULT_STATS.slice(start, start + 5);
                await config.methods
                    .set_planet_default_stats_batch(
                        batch.map((item) => item.level),
                        batch.map((item) => item.stats),
                        5
                    )
                    .send(opts);
            },
        })),
        ...(
            [
                {
                    method: 'initialize_upgrades_defense',
                    check: async () =>
                        classifyUpgradesBranch(
                            await readFullConfig(),
                            0,
                            EXPECTED_UPGRADE_DEFENSE
                        ),
                },
                {
                    method: 'initialize_upgrades_range',
                    check: async () =>
                        classifyUpgradesBranch(
                            await readFullConfig(),
                            1,
                            EXPECTED_UPGRADE_RANGE
                        ),
                },
                {
                    method: 'initialize_upgrades_speed',
                    check: async () =>
                        classifyUpgradesBranch(
                            await readFullConfig(),
                            2,
                            EXPECTED_UPGRADE_SPEED
                        ),
                },
                {
                    method: 'set_default_upgrade_config',
                    check: async () =>
                        classifyUpgradeConfig(
                            await readFullConfig(),
                            await readConfigHashes()
                        ),
                },
                {
                    method: 'initialize_cumulative_rarities',
                    check: async () =>
                        classifyCumulativeRarities(await readFullConfig()),
                },
            ] as const
        ).map((definition, i) => ({
            meta: BOOTSTRAP_STEP_META[8 + i]!,
            check: definition.check,
            execute: async () => {
                await config.methods[definition.method]().send(opts);
            },
        })),
        {
            meta: BOOTSTRAP_STEP_META[13]!,
            check: async () =>
                classifyPointers(
                    await readPointers(admin),
                    adminExpected,
                    ADMIN_POINTER_FIELDS
                ),
            execute: async () => {
                await admin.methods
                    .set_all_storage_addresses(
                        config.address,
                        storageByName.WorldStorage.address,
                        storageByName.PlayerStorage.address,
                        storageByName.PlanetStorage.address
                    )
                    .send(opts);
            },
        },
        {
            meta: BOOTSTRAP_STEP_META[14]!,
            check: async () =>
                classifyPointers(
                    await readPointers(core),
                    coreExpected,
                    CORE_POINTER_FIELDS
                ),
            execute: async () => {
                await core.methods
                    .set_all_storage_addresses(
                        config.address,
                        storageByName.WorldStorage.address,
                        storageByName.PlayerStorage.address,
                        storageByName.PlanetStorage.address,
                        storageByName.PlanetRevealedCoordsStorage.address,
                        storageByName.PlanetEventsStorage.address,
                        storageByName.PlanetArtifactsStorage.address,
                        storageByName.ArrivalStorage.address,
                        storageByName.ArtifactStorage.address,
                        storageByName.ArtifactLocationStorage.address
                    )
                    .send(opts);
            },
        },
        {
            meta: BOOTSTRAP_STEP_META[15]!,
            check: async () =>
                classifyPointers(
                    await readPointers(move),
                    moveExpected,
                    MOVE_POINTER_FIELDS
                ),
            execute: async () => {
                await move.methods
                    .set_all_storage_addresses(
                        config.address,
                        storageByName.WorldStorage.address,
                        storageByName.PlayerStorage.address,
                        storageByName.PlanetStorage.address,
                        storageByName.PlanetEventsStorage.address,
                        storageByName.PlanetArtifactsStorage.address,
                        storageByName.ArrivalStorage.address,
                        storageByName.ArtifactStorage.address,
                        storageByName.ArtifactLocationStorage.address
                    )
                    .send(opts);
            },
        },
        ...PHASE3_STORAGE_ORDER.map((storageName, i) => {
            const storage = storageByName[storageName];
            const authorized = PHASE3_AUTHORIZED_BY_STORAGE[storageName].map(
                (name) => systemInstances[name].address
            );
            return {
                meta: BOOTSTRAP_STEP_META[16 + i]!,
                check: async () =>
                    classifyAuthorization(
                        await readAuthFlags(storage, authorized)
                    ),
                execute: async () =>
                    addAuthorizedBatchIfNeeded(storage, authorized),
            };
        }),
        ...artifactSystems.map((system, i) => ({
            meta: BOOTSTRAP_STEP_META[25 + i]!,
            check: async () =>
                classifyPointers(
                    await readPointers(system),
                    artifactExpected,
                    ARTIFACT_POINTER_FIELDS
                ),
            execute: async () => {
                await system.methods
                    .set_all_storage_addresses(...artifactStorageArgs)
                    .send(opts);
            },
        })),
        ...PHASE4_ARTIFACT_EXTRA_STORAGES.map((storageName, i) => {
            const storage = storageByName[storageName];
            return {
                meta: BOOTSTRAP_STEP_META[29 + i]!,
                check: async () =>
                    classifyAuthorization(
                        await readAuthFlags(storage, artifactSystemAddresses)
                    ),
                execute: async () =>
                    addAuthorizedBatchIfNeeded(
                        storage,
                        artifactSystemAddresses
                    ),
            };
        }),
    ];

    if (steps.length !== TOTAL_BOOTSTRAP_STEPS) {
        throw new Error(
            `Built ${steps.length} bootstrap steps; expected ${TOTAL_BOOTSTRAP_STEPS}.`
        );
    }
    return steps;
}
