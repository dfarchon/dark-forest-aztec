/**
 * Run post-deploy interactions using contract addresses from .env.
 * Use after deploy: pnpm configure
 *
 * Resume / idempotency:
 *   pnpm configure
 *   pnpm configure --from <step-id|number>
 *   pnpm configure --help
 *
 * Phase 1 always writes deployment-default Config values. Later steps are
 * checked on-chain and skipped when complete. --from preflight-checks earlier
 * Phase 2–4 steps.
 *
 * Requires: .env with ACCOUNT_* and all *_CONTRACT_ADDRESS keys (see deploy).
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';

import {
    buildSendOpts,
    createTolerantAztecNodeClient,
    exitIfAccountFundingRequired,
    getAztecNodeUrl,
    getContractInstances,
    getProverEnabled,
    getRequiredEnv,
    loadContractsEnv,
    prepareFeePayment,
    resolveDeployerAccount,
    setupWallet,
    unwrapSimulateResult,
} from '../utils/index.ts';
import {
    classifyAuthorization,
    classifyPointers,
    CONFIGURE_STEP_META,
    decideStepAction,
    formatConfigureUsage,
    normalizeAddressLoose,
    parseConfigureArgs,
    PLANET_DEFAULT_STATS,
    resolveStartIndex,
    type StepStatus,
    TOTAL_CONFIGURE_STEPS,
} from './configureResume.ts';
import {
    ARTIFACT_SYSTEM_NAMES,
    PHASE3_AUTHORIZED_BY_STORAGE,
    PHASE4_ARTIFACT_EXTRA_STORAGES,
    type StorageContractName,
    type SystemContractName,
} from './storageAuthorizationExpectations.ts';

{
    const early = parseConfigureArgs(process.argv.slice(2));
    if (early.ok && early.options.help) {
        console.log(formatConfigureUsage());
        process.exit(0);
    }
    if (!early.ok) {
        console.error(early.error);
        process.exit(1);
    }
}

loadContractsEnv();

/** Phase 3 batch order (matches CONFIGURE_STEP_META auth.*.phase3). */
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

function formatElapsed(ms: number): string {
    if (ms >= 60000) {
        const m = Math.floor(ms / 60000);
        const s = ((ms % 60000) / 1000).toFixed(1);
        return `${m}m ${s}s`;
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

function addr(addresses: Record<string, string>, name: string): string {
    return normalizeAddressLoose(addresses[name]);
}

async function main() {
    const scriptStartTime = Date.now();

    const parsed = parseConfigureArgs(process.argv.slice(2));
    if (!parsed.ok) {
        console.error(parsed.error);
        process.exit(1);
    }
    // --help handled before loadContractsEnv() at module load.

    const resolved = resolveStartIndex(parsed.options);
    if (!resolved.ok) {
        console.error(resolved.error);
        process.exit(1);
    }
    const { startIndex, legacy } = resolved;

    if (legacy) {
        console.warn(
            `\n⚠️  Legacy positional step number detected. Prefer: pnpm configure --from ${startIndex}\n`
        );
    }
    if (startIndex > 1) {
        const meta = CONFIGURE_STEP_META[startIndex - 1]!;
        console.log(
            `\n⏩ Resuming from step ${startIndex} (${meta.id}); preflight-checking 1–${startIndex - 1}\n`
        );
    }
    const addresses = addressesFromEnv();
    console.log('✅ All required environment variables are present');
    console.log(`📋 Config: ${addresses['Config']}`);
    console.log(`📋 Admin: ${addresses['Admin']}`);
    console.log(`📋 Core: ${addresses['Core']}`);
    console.log(`📋 WorldStorage: ${addresses['WorldStorage']}`);
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}`);
    console.log(`⚡ Prover: ${PROVER_ENABLED ? 'ON (slow)' : 'OFF (fast)'}\n`);

    if (PROVER_ENABLED && isLocalSandbox) {
        console.warn(
            '⚠️  Prover ON: configure will be slow. For local sandbox only, set PROVER_ENABLED=false for a fast run.\n'
        );
    }

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createTolerantAztecNodeClient(AZTEC_NODE_URL);

    console.log('📝 Setting up wallet...');
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
    });
    const feeCtx = await prepareFeePayment(wallet);

    console.log('👤 Loading account from .env...');
    const deployer = await resolveDeployerAccount(wallet, aztecNode, {
        mode: 'loadOnly',
        deployTimeoutMs: 120_000,
        feeCtx,
        commandHint: 'pnpm configure',
    });
    console.log(`✅ Account loaded: ${deployer.toString()}\n`);

    console.log('📄 Connecting to contracts...');
    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );
    const config = contracts['Config'];
    const admin = contracts['Admin'];
    const core = contracts['Core'];
    const move = contracts['Move'];
    const artifactActionSystem = contracts['ArtifactAction'];
    const artifactFindSystem = contracts['ArtifactFind'];
    const artifactProspectSystem = contracts['ArtifactProspect'];
    const artifactVaultSystem = contracts['ArtifactValut'];

    const worldStorage = contracts['WorldStorage'];
    const playerStorage = contracts['PlayerStorage'];
    const planetStorage = contracts['PlanetStorage'];
    const planetRevealedCoordsStorage =
        contracts['PlanetRevealedCoordsStorage'];
    const planetEventsStorage = contracts['PlanetEventsStorage'];
    const planetArtifactsStorage = contracts['PlanetArtifactsStorage'];
    const arrivalStorage = contracts['ArrivalStorage'];
    const artifactStorage = contracts['ArtifactStorage'];
    const artifactLocationStorage = contracts['ArtifactLocationStorage'];

    if (!config || !admin) throw new Error('Config or Admin instance missing');
    if (!core) throw new Error('Core instance missing');
    if (!move) throw new Error('Move instance missing');
    if (
        !artifactActionSystem ||
        !artifactFindSystem ||
        !artifactProspectSystem ||
        !artifactVaultSystem
    ) {
        throw new Error(
            'One or more artifact system contracts missing (ArtifactAction, ArtifactFind, ArtifactProspect, ArtifactValut)'
        );
    }

    if (
        !worldStorage ||
        !playerStorage ||
        !planetStorage ||
        !planetRevealedCoordsStorage ||
        !planetEventsStorage ||
        !planetArtifactsStorage ||
        !arrivalStorage ||
        !artifactStorage ||
        !artifactLocationStorage
    ) {
        throw new Error('One or more storage contracts are missing');
    }

    const systemInstances: Record<SystemContractName, ContractBase> = {
        Admin: admin,
        Core: core,
        Move: move,
        ArtifactAction: artifactActionSystem,
        ArtifactFind: artifactFindSystem,
        ArtifactProspect: artifactProspectSystem,
        ArtifactValut: artifactVaultSystem,
    };

    const storageByName: Record<StorageContractName, ContractBase> = {
        WorldStorage: worldStorage,
        PlayerStorage: playerStorage,
        PlanetStorage: planetStorage,
        PlanetRevealedCoordsStorage: planetRevealedCoordsStorage,
        PlanetEventsStorage: planetEventsStorage,
        PlanetArtifactsStorage: planetArtifactsStorage,
        ArrivalStorage: arrivalStorage,
        ArtifactStorage: artifactStorage,
        ArtifactLocationStorage: artifactLocationStorage,
    };

    const opts = buildSendOpts(deployer, feeCtx);
    const simOpts = { from: deployer };

    /** Batch authorize contracts on a storage contract (idempotent, handles >3 via multiple batches). */
    const addAuthorizedBatchIfNeeded = async (
        storage: ContractBase,
        contractAddrs: AztecAddress[]
    ) => {
        const methods = storage.methods as unknown as {
            is_authorized: (a: AztecAddress) => {
                simulate: (o?: object) => Promise<boolean>;
            };
            add_authorized_contracts_batch: (
                a: [AztecAddress, AztecAddress, AztecAddress],
                c: number
            ) => {
                send: (o: typeof opts) => Promise<unknown>;
            };
        };

        const toAuthorize: AztecAddress[] = [];
        for (const addrToAuth of contractAddrs) {
            const isAuth = unwrapSimulateResult(
                await methods.is_authorized(addrToAuth).simulate(simOpts)
            ) as boolean;
            if (!isAuth) toAuthorize.push(addrToAuth);
        }
        if (toAuthorize.length === 0) return;

        for (let i = 0; i < toAuthorize.length; i += 3) {
            const chunk = toAuthorize.slice(i, i + 3);
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

    const readAuthFlags = async (
        storage: ContractBase,
        contractAddrs: AztecAddress[]
    ): Promise<boolean[]> => {
        const methods = storage.methods as unknown as {
            is_authorized: (a: AztecAddress) => {
                simulate: (o?: object) => Promise<unknown>;
            };
        };
        const flags: boolean[] = [];
        for (const a of contractAddrs) {
            flags.push(
                unwrapSimulateResult(
                    await methods.is_authorized(a).simulate(simOpts)
                ) as boolean
            );
        }
        return flags;
    };

    const readPointers = async (
        system: ContractBase
    ): Promise<Record<string, unknown>> => {
        return unwrapSimulateResult(
            await system.methods
                .get_all_storage_addresses_unconstrained()
                .simulate(simOpts)
        ) as Record<string, unknown>;
    };

    type RuntimeStep = {
        meta: (typeof CONFIGURE_STEP_META)[number];
        check: () => Promise<StepStatus>;
        execute: () => Promise<void>;
    };

    const adminExpected = {
        config_storage_address: addr(addresses, 'Config'),
        world_storage_address: addr(addresses, 'WorldStorage'),
        player_storage_address: addr(addresses, 'PlayerStorage'),
        planet_storage_address: addr(addresses, 'PlanetStorage'),
    };

    const coreExpected = {
        config_storage_address: addr(addresses, 'Config'),
        world_storage_address: addr(addresses, 'WorldStorage'),
        player_storage_address: addr(addresses, 'PlayerStorage'),
        planet_storage_address: addr(addresses, 'PlanetStorage'),
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

    const artifactStorageArgs = [
        config.address,
        arrivalStorage.address,
        artifactStorage.address,
        artifactLocationStorage.address,
        planetStorage.address,
        planetArtifactsStorage.address,
        planetEventsStorage.address,
        playerStorage.address,
        worldStorage.address,
    ] as const;

    const artifactSystemAddresses = ARTIFACT_SYSTEM_NAMES.map(
        (n) => systemInstances[n].address
    );

    const steps: RuntimeStep[] = [
        {
            meta: CONFIGURE_STEP_META[0]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods.set_default_configs_batch_1().send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[1]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods.set_default_configs_batch_2().send(opts);
            },
        },
        ...([0, 1, 2, 3] as const).map((tier) => ({
            meta: CONFIGURE_STEP_META[2 + tier]!,
            check: async () => 'needed' as const,
            execute: async () => {
                await config.methods
                    .set_default_game_config_planet_type_weights_tier(tier)
                    .send(opts);
            },
        })),
        {
            meta: CONFIGURE_STEP_META[6]!,
            check: async () => 'needed',
            execute: async () => {
                const batch = PLANET_DEFAULT_STATS.slice(0, 5);
                await config.methods
                    .set_planet_default_stats_batch(
                        batch.map((b) => b.level),
                        batch.map((b) => b.stats),
                        5
                    )
                    .send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[7]!,
            check: async () => 'needed',
            execute: async () => {
                const batch = PLANET_DEFAULT_STATS.slice(5, 10);
                await config.methods
                    .set_planet_default_stats_batch(
                        batch.map((b) => b.level),
                        batch.map((b) => b.stats),
                        5
                    )
                    .send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[8]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods.initialize_upgrades_defense().send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[9]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods.initialize_upgrades_range().send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[10]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods.initialize_upgrades_speed().send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[11]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods.set_default_upgrade_config().send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[12]!,
            check: async () => 'needed',
            execute: async () => {
                await config.methods
                    .initialize_cumulative_rarities()
                    .send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[13]!,
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
                        worldStorage.address,
                        playerStorage.address,
                        planetStorage.address
                    )
                    .send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[14]!,
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
                        worldStorage.address,
                        playerStorage.address,
                        planetStorage.address,
                        planetRevealedCoordsStorage.address,
                        planetEventsStorage.address,
                        planetArtifactsStorage.address,
                        arrivalStorage.address,
                        artifactStorage.address,
                        artifactLocationStorage.address
                    )
                    .send(opts);
            },
        },
        {
            meta: CONFIGURE_STEP_META[15]!,
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
                        worldStorage.address,
                        playerStorage.address,
                        planetStorage.address,
                        planetEventsStorage.address,
                        planetArtifactsStorage.address,
                        arrivalStorage.address,
                        artifactStorage.address,
                        artifactLocationStorage.address
                    )
                    .send(opts);
            },
        },
        ...PHASE3_STORAGE_ORDER.map((storageName, i) => {
            const batch = PHASE3_AUTHORIZED_BY_STORAGE[storageName];
            const storage = storageByName[storageName];
            const addrs = batch.map((n) => systemInstances[n].address);
            return {
                meta: CONFIGURE_STEP_META[16 + i]!,
                check: async () =>
                    classifyAuthorization(await readAuthFlags(storage, addrs)),
                execute: async () => {
                    await addAuthorizedBatchIfNeeded(storage, addrs);
                },
            };
        }),
        ...(
            [
                artifactActionSystem,
                artifactFindSystem,
                artifactProspectSystem,
                artifactVaultSystem,
            ] as const
        ).map((instance, i) => ({
            meta: CONFIGURE_STEP_META[25 + i]!,
            check: async () =>
                classifyPointers(
                    await readPointers(instance),
                    artifactExpected,
                    ARTIFACT_POINTER_FIELDS
                ),
            execute: async () => {
                await instance.methods
                    .set_all_storage_addresses(...artifactStorageArgs)
                    .send(opts);
            },
        })),
        ...PHASE4_ARTIFACT_EXTRA_STORAGES.map((storageName, i) => {
            const storage = storageByName[storageName];
            return {
                meta: CONFIGURE_STEP_META[29 + i]!,
                check: async () =>
                    classifyAuthorization(
                        await readAuthFlags(storage, artifactSystemAddresses)
                    ),
                execute: async () => {
                    await addAuthorizedBatchIfNeeded(
                        storage,
                        artifactSystemAddresses
                    );
                },
            };
        }),
    ];

    if (steps.length !== TOTAL_CONFIGURE_STEPS) {
        throw new Error(
            `Internal error: built ${steps.length} steps, expected ${TOTAL_CONFIGURE_STEPS}`
        );
    }

    console.log(
        `\n🔍 Configuring contracts (${TOTAL_CONFIGURE_STEPS} steps, on-chain resume)...\n`
    );

    let executed = 0;
    let skippedComplete = 0;
    let skippedFrom = 0;

    for (const step of steps) {
        const status = await step.check();
        const decision = decideStepAction({
            step: step.meta,
            status,
            startIndex,
        });

        if (decision.action === 'abort') {
            console.error(`\n❌ ${decision.message}`);
            process.exit(1);
        }

        const tag = `[${step.meta.index}/${TOTAL_CONFIGURE_STEPS}] ${step.meta.id}`;

        if (decision.action === 'skip') {
            if (decision.reason === 'before_from') {
                skippedFrom += 1;
                console.log(`  ${tag} (skipped --from; on-chain: ${status})`);
            } else {
                skippedComplete += 1;
                console.log(`  ${tag} (already complete)`);
            }
            continue;
        }

        console.log(`\n⚙️  ${tag} ${step.meta.label}`);
        const stepStart = Date.now();
        await step.execute();
        executed += 1;
        const stepMs = Date.now() - stepStart;
        const stepTime =
            stepMs >= 1000 ? `${(stepMs / 1000).toFixed(1)}s` : `${stepMs}ms`;
        const totalElapsed = Date.now() - scriptStartTime;
        console.log(
            `✅ executed (${stepTime}) | elapsed: ${formatElapsed(totalElapsed)}`
        );
    }

    const elapsedMs = Date.now() - scriptStartTime;
    console.log('\n✅ Configure done.');
    console.log(
        `📊 executed=${executed} skipped_complete=${skippedComplete} skipped_from=${skippedFrom}`
    );
    console.log(`⏱️  Total time: ${formatElapsed(elapsedMs)} (${elapsedMs}ms)`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
