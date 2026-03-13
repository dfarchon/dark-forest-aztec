/**
 * Run post-deploy interactions using contract addresses from .env.
 * Use after deploy: pnpm configure (or node --experimental-transform-types scripts/configure.ts)
 * Requires: .env with ACCOUNT_*, CONFIG_CONTRACT_ADDRESS, ADMIN_CONTRACT_ADDRESS, CORE_CONTRACT_ADDRESS,
 * MOVE_CONTRACT_ADDRESS, WORLD_STORAGE_CONTRACT_ADDRESS, PLAYER_STORAGE_CONTRACT_ADDRESS,
 * PLANET_STORAGE_CONTRACT_ADDRESS, PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
 * PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS, PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
 * ARRIVAL_STORAGE_CONTRACT_ADDRESS, ARTIFACT_STORAGE_CONTRACT_ADDRESS,
 * ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';

import {
    getContractInstances,
    getSponsoredPFCContract,
    loadAccountFromEnv,
    setupWallet,
} from './utils/index.ts';

dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
/** Prover OFF by default — configure is 10–100x faster. Set PROVER_ENABLED=true only for proof benchmarking. */
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'true';

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
        name: 'ArtifactVault',
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
        ['ArtifactVault', 'ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS'],
    ];
    const out: Record<string, string> = {};
    for (const [name, key] of envKeys) {
        const v = process.env[key];
        if (!v) throw new Error(`Missing ${key} in .env (run deploy first)`);
        out[name] = v;
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

async function main() {
    const scriptStartTime = Date.now();

    const addresses = addressesFromEnv();
    console.log('✅ All required environment variables are present');
    console.log(`📋 Config: ${addresses['Config']}`);
    console.log(`📋 Admin: ${addresses['Admin']}`);
    console.log(`📋 Core: ${addresses['Core']}`);
    console.log(`📋 WorldStorage: ${addresses['WorldStorage']}`);
    console.log(`📋 PlayerStorage: ${addresses['PlayerStorage']}`);
    console.log(`📋 PlanetStorage: ${addresses['PlanetStorage']}`);
    console.log(
        `📋 PlanetRevealedCoordsStorage: ${addresses['PlanetRevealedCoordsStorage']}`
    );
    console.log(`📋 PlanetEventsStorage: ${addresses['PlanetEventsStorage']}`);
    console.log(
        `📋 PlanetArtifactsStorage: ${addresses['PlanetArtifactsStorage']}`
    );
    console.log(`📋 ArrivalStorage: ${addresses['ArrivalStorage']}`);
    console.log(`📋 ArtifactStorage: ${addresses['ArtifactStorage']}`);
    console.log(
        `📋 ArtifactLocationStorage: ${addresses['ArtifactLocationStorage']}`
    );
    console.log(`📋 Move: ${addresses['Move']}`);
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}`);
    console.log(`⚡ Prover: ${PROVER_ENABLED ? 'ON (slow)' : 'OFF (fast)'}\n`);

    if (PROVER_ENABLED) {
        console.warn(
            '⚠️  PROVER_ENABLED=true: configure will be very slow. For fast run, set PROVER_ENABLED=false.\n'
        );
    }

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    console.log('📝 Registering SponsoredFPC contract...');
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: false, // Always false for fast configure
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    console.log('👤 Loading account from .env...');
    const deployer = await loadAccountFromEnv(wallet, aztecNode);
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
    const artifactVaultSystem = contracts['ArtifactVault'];

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
    if (!artifactActionSystem || !artifactVaultSystem) {
        throw new Error('ArtifactAction or ArtifactVault instance missing');
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

    const opts = {
        from: deployer,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

    /** Batch authorize contracts on a storage contract (idempotent for re-runs). */
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

        // Filter out already-authorized addresses
        const toAuthorize: AztecAddress[] = [];
        for (const addr of contractAddrs) {
            const isAuth = await methods
                .is_authorized(addr)
                .simulate({ from: deployer });
            if (!isAuth) toAuthorize.push(addr);
        }
        if (toAuthorize.length === 0) return;

        // Pad to fixed array of 3
        const padded: [AztecAddress, AztecAddress, AztecAddress] = [
            toAuthorize[0] ?? AztecAddress.zero(),
            toAuthorize[1] ?? AztecAddress.zero(),
            toAuthorize[2] ?? AztecAddress.zero(),
        ];
        await methods
            .add_authorized_contracts_batch(padded, toAuthorize.length)
            .send(opts);
    };

    const TOTAL_STEPS = 32;
    let stepIndex = 0;
    const run = async (label: string, action: () => Promise<unknown>) => {
        stepIndex += 1;
        console.log(`\n⚙️  [${stepIndex}/${TOTAL_STEPS}] ${label}`);
        const stepStart = Date.now();
        await action();
        const stepMs = Date.now() - stepStart;
        const stepTime =
            stepMs >= 1000 ? `${(stepMs / 1000).toFixed(1)}s` : `${stepMs}ms`;
        const totalElapsed = Date.now() - scriptStartTime;
        console.log(
            `✅ ${label} (${stepTime}) | elapsed: ${formatElapsed(totalElapsed)}`
        );
    };

    console.log('\n🔍 Configuring contracts (32 steps)...\n');

    // ---- Phase 1: Config initialization (10 calls) ----

    await run(
        'Config.set_default_configs_batch_1() [world, snark, game, thresholds, artifacts, spaceships]',
        async () => {
            await config.methods.set_default_configs_batch_1().send(opts);
        }
    );

    await run(
        'Config.set_default_configs_batch_2() [space_junk, capture_zones]',
        async () => {
            await config.methods.set_default_configs_batch_2().send(opts);
        }
    );

    for (const tier of [0, 1, 2, 3] as const) {
        await run(
            `Config.set_default_game_config_planet_type_weights_tier(${tier})`,
            async () => {
                await config.methods
                    .set_default_game_config_planet_type_weights_tier(tier)
                    .send(opts);
            }
        );
    }

    // ---- planet default stats (batched: 5+5 instead of 10 individual calls) ----
    const planetDefaultStats = [
        {
            level: 0,
            stats: {
                population_cap: 100000n,
                population_growth: 417n,
                range: 99n,
                speed: 75n,
                defense: 400n,
                silver_growth: 0n,
                silver_cap: 0n,
                barbarian_percentage: 0n,
            },
        },
        {
            level: 1,
            stats: {
                population_cap: 400000n,
                population_growth: 833n,
                range: 177n,
                speed: 75n,
                defense: 400n,
                silver_growth: 56n,
                silver_cap: 100000n,
                barbarian_percentage: 1n,
            },
        },
        {
            level: 2,
            stats: {
                population_cap: 1600000n,
                population_growth: 1250n,
                range: 315n,
                speed: 75n,
                defense: 300n,
                silver_growth: 167n,
                silver_cap: 500000n,
                barbarian_percentage: 2n,
            },
        },
        {
            level: 3,
            stats: {
                population_cap: 6000000n,
                population_growth: 1667n,
                range: 591n,
                speed: 75n,
                defense: 300n,
                silver_growth: 417n,
                silver_cap: 2500000n,
                barbarian_percentage: 3n,
            },
        },
        {
            level: 4,
            stats: {
                population_cap: 25000000n,
                population_growth: 2083n,
                range: 1025n,
                speed: 75n,
                defense: 300n,
                silver_growth: 833n,
                silver_cap: 12000000n,
                barbarian_percentage: 4n,
            },
        },
        {
            level: 5,
            stats: {
                population_cap: 100000000n,
                population_growth: 2500n,
                range: 1734n,
                speed: 75n,
                defense: 200n,
                silver_growth: 1667n,
                silver_cap: 50000000n,
                barbarian_percentage: 5n,
            },
        },
        {
            level: 6,
            stats: {
                population_cap: 300000000n,
                population_growth: 2917n,
                range: 2838n,
                speed: 75n,
                defense: 200n,
                silver_growth: 2778n,
                silver_cap: 100000000n,
                barbarian_percentage: 7n,
            },
        },
        {
            level: 7,
            stats: {
                population_cap: 500000000n,
                population_growth: 3333n,
                range: 4414n,
                speed: 75n,
                defense: 200n,
                silver_growth: 2778n,
                silver_cap: 200000000n,
                barbarian_percentage: 10n,
            },
        },
        {
            level: 8,
            stats: {
                population_cap: 700000000n,
                population_growth: 3750n,
                range: 6306n,
                speed: 75n,
                defense: 200n,
                silver_growth: 2778n,
                silver_cap: 300000000n,
                barbarian_percentage: 20n,
            },
        },
        {
            level: 9,
            stats: {
                population_cap: 800000000n,
                population_growth: 4167n,
                range: 8829n,
                speed: 75n,
                defense: 200n,
                silver_growth: 2778n,
                silver_cap: 400000000n,
                barbarian_percentage: 25n,
            },
        },
    ];

    // Batch 1: levels 0-4
    await run('Config.set_planet_default_stats_batch(0-4)', async () => {
        const batch = planetDefaultStats.slice(0, 5);
        await config.methods
            .set_planet_default_stats_batch(
                batch.map((b) => b.level),
                batch.map((b) => b.stats),
                5
            )
            .send(opts);
    });

    // Batch 2: levels 5-9
    await run('Config.set_planet_default_stats_batch(5-9)', async () => {
        const batch = planetDefaultStats.slice(5, 10);
        await config.methods
            .set_planet_default_stats_batch(
                batch.map((b) => b.level),
                batch.map((b) => b.stats),
                5
            )
            .send(opts);
    });

    await run('Config.initialize_upgrades_defense()', async () => {
        await config.methods.initialize_upgrades_defense().send(opts);
    });

    await run('Config.initialize_upgrades_range()', async () => {
        await config.methods.initialize_upgrades_range().send(opts);
    });

    await run('Config.initialize_upgrades_speed()', async () => {
        await config.methods.initialize_upgrades_speed().send(opts);
    });

    await run('Config.set_default_upgrade_config()', async () => {
        await config.methods.set_default_upgrade_config().send(opts);
    });

    await run('Config.initialize_cumulative_rarities()', async () => {
        await config.methods.initialize_cumulative_rarities().send(opts);
    });

    // ---- Phase 2: System contract setup (3 calls) ----

    await run('Admin.set_all_storage_addresses()', async () => {
        await admin.methods
            .set_all_storage_addresses(
                config.address,
                worldStorage.address,
                playerStorage.address,
                planetStorage.address
            )
            .send(opts);
    });

    await run('Core.set_all_storage_addresses()', async () => {
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
    });

    await run('Move.set_all_storage_addresses()', async () => {
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
    });

    // ---- Phase 3: Storage authorization (9 calls) ----

    await run('WorldStorage.add_authorized_contracts_batch()', async () => {
        await addAuthorizedBatchIfNeeded(worldStorage, [
            admin.address,
            core.address,
            move.address,
        ]);
    });

    await run('PlayerStorage.add_authorized_contracts_batch()', async () => {
        await addAuthorizedBatchIfNeeded(playerStorage, [
            admin.address,
            core.address,
            move.address,
        ]);
    });

    await run('PlanetStorage.add_authorized_contracts_batch()', async () => {
        await addAuthorizedBatchIfNeeded(planetStorage, [
            admin.address,
            core.address,
            move.address,
        ]);
    });

    await run(
        'PlanetRevealedCoordsStorage.add_authorized_contracts_batch()',
        async () => {
            await addAuthorizedBatchIfNeeded(planetRevealedCoordsStorage, [
                core.address,
            ]);
        }
    );

    await run(
        'PlanetEventsStorage.add_authorized_contracts_batch()',
        async () => {
            await addAuthorizedBatchIfNeeded(planetEventsStorage, [
                core.address,
                move.address,
            ]);
        }
    );

    await run(
        'PlanetArtifactsStorage.add_authorized_contracts_batch()',
        async () => {
            await addAuthorizedBatchIfNeeded(planetArtifactsStorage, [
                core.address,
                move.address,
            ]);
        }
    );

    await run('ArrivalStorage.add_authorized_contracts_batch()', async () => {
        await addAuthorizedBatchIfNeeded(arrivalStorage, [
            core.address,
            move.address,
        ]);
    });

    await run('ArtifactStorage.add_authorized_contracts_batch()', async () => {
        await addAuthorizedBatchIfNeeded(artifactStorage, [
            core.address,
            move.address,
        ]);
    });

    await run(
        'ArtifactLocationStorage.add_authorized_contracts_batch()',
        async () => {
            await addAuthorizedBatchIfNeeded(artifactLocationStorage, [
                core.address,
                move.address,
            ]);
        }
    );

    // ---- Phase 4: ArtifactAction & ArtifactVault setup ----

    await run('ArtifactAction.set_all_storage_addresses()', async () => {
        await artifactActionSystem.methods
            .set_all_storage_addresses(
                config.address,
                worldStorage.address,
                playerStorage.address,
                planetStorage.address,
                planetArtifactsStorage.address,
                planetEventsStorage.address,
                arrivalStorage.address,
                artifactStorage.address,
                artifactLocationStorage.address
            )
            .send(opts);
    });

    await run('ArtifactVault.set_all_storage_addresses()', async () => {
        await artifactVaultSystem.methods
            .set_all_storage_addresses(
                config.address,
                worldStorage.address,
                playerStorage.address,
                planetStorage.address,
                planetArtifactsStorage.address,
                planetEventsStorage.address,
                arrivalStorage.address,
                artifactStorage.address,
                artifactLocationStorage.address
            )
            .send(opts);
    });

    // Authorize both artifact systems on storages (batch where supported)
    await run(
        'WorldStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(worldStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    await run(
        'PlayerStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(playerStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    await run(
        'PlanetStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(planetStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    await run(
        'PlanetArtifactsStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(planetArtifactsStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    await run(
        'PlanetEventsStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(planetEventsStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    await run(
        'ArtifactStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(artifactStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    await run(
        'ArtifactLocationStorage.add_authorized_contracts_batch(artifact systems)',
        async () => {
            await addAuthorizedBatchIfNeeded(artifactLocationStorage, [
                artifactActionSystem.address,
                artifactVaultSystem.address,
            ]);
        }
    );

    const elapsedMs = Date.now() - scriptStartTime;
    console.log('\n✅ Configure done.');
    console.log(`⏱️  Total time: ${formatElapsed(elapsedMs)} (${elapsedMs}ms)`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
