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
        name: 'ArtifactSystem',
        modulePath: './artifacts/ArtifactSystem.ts',
        exportName: 'ArtifactSystemContract',
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
        ['ArtifactSystem', 'ARTIFACT_SYSTEM_CONTRACT_ADDRESS'],
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
    const deployer = await loadAccountFromEnv(wallet);
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
    const artifactSystem = contracts['ArtifactSystem'];

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
    if (!artifactSystem) throw new Error('ArtifactSystem instance missing');

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

    /** Add authorized contract only if not already authorized (idempotent for re-runs). */
    const addAuthorizedIfNeeded = async (
        storage: ContractBase,
        contractAddr: AztecAddress
    ) => {
        const methods = storage.methods as unknown as {
            is_authorized: (a: AztecAddress) => {
                simulate: (o?: object) => Promise<boolean>;
            };
            add_authorized_contract: (a: AztecAddress) => {
                send: (o: typeof opts) => Promise<unknown>;
            };
        };
        const isAuth = await methods
            .is_authorized(contractAddr)
            .simulate({ from: deployer });
        if (isAuth) return;
        await methods.add_authorized_contract(contractAddr).send(opts);
    };

    const TOTAL_STEPS = 59;
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

    console.log('\n🔍 Configuring contracts...\n');

    await run('Config.set_default_world_config()', async () => {
        await config.methods.set_default_world_config().send(opts);
    });

    await run('Config.set_default_snark_config()', async () => {
        await config.methods.set_default_snark_config().send(opts);
    });

    await run('Config.set_default_game_config()', async () => {
        await config.methods.set_default_game_config().send(opts);
    });

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

    await run('Config.set_default_artifacts_config()', async () => {
        await config.methods.set_default_artifacts_config().send(opts);
    });

    await run('Config.set_default_spaceships_config()', async () => {
        await config.methods.set_default_spaceships_config().send(opts);
    });

    await run('Config.set_default_space_junk_config()', async () => {
        await config.methods.set_default_space_junk_config().send(opts);
    });

    await run('Config.set_default_capture_zones_config()', async () => {
        await config.methods.set_default_capture_zones_config().send(opts);
    });

    // ---- planet default stats & upgrades ----
    // NOTE: Public storage writes are limited to 63 per call.
    // PlanetDefaultStats has 8 u128 fields; writing 10 levels in a single call would exceed the limit.
    // We therefore write per-level (10 separate calls).
    const planetDefaultStats = [
        // level 0: Asteroid
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
        // level 1: Brown Dwarf
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
        // level 2: Red Dwarf
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
        // level 3: White Dwarf
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
        // level 4: Yellow Star
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
        // level 5: Blue Star
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
        // level 6: Giant
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
        // level 7: Supergiant
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
        // level 8: Unlabeled1
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
        // level 9: Unlabeled2
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

    for (const { level, stats } of planetDefaultStats) {
        await run(`set_planet_default_stats(${level})`, async () => {
            await config.methods
                .set_planet_default_stats(level, stats)
                .send(opts);
        });
    }

    await run('Config.initializeUpgrades()', async () => {
        await config.methods.initializeUpgrades().send(opts);
    });

    await run('Config.initialize_cumulative_rarities()', async () => {
        await config.methods.initialize_cumulative_rarities().send(opts);
    });

    await run('Admin system', async () => {
        await run('admin.set_config_storage_address()', async () => {
            await admin.methods
                .set_config_storage_address(config.address)
                .send(opts);
        });

        await run('admin.set_world_storage_address()', async () => {
            await admin.methods
                .set_world_storage_address(worldStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(worldStorage, admin.address);
        });

        await run('admin.set_player_storage_address()', async () => {
            await admin.methods
                .set_player_storage_address(playerStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(playerStorage, admin.address);
        });

        await run('admin.set_planet_storage_address()', async () => {
            await admin.methods
                .set_planet_storage_address(planetStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(planetStorage, admin.address);
        });
    });

    await run('Core system', async () => {
        await run('core.set_config_storage_address()', async () => {
            await core.methods
                .set_config_storage_address(config.address)
                .send(opts);
        });

        await run('core.set_world_storage_address()', async () => {
            await core.methods
                .set_world_storage_address(worldStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(worldStorage, core.address);
        });

        await run('core.set_player_storage_address()', async () => {
            await core.methods
                .set_player_storage_address(playerStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(playerStorage, core.address);
        });

        await run('core.set_planet_storage_address()', async () => {
            await core.methods
                .set_planet_storage_address(planetStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(planetStorage, core.address);
        });

        await run(
            'core.set_planet_revealed_coords_storage_address()',
            async () => {
                await core.methods
                    .set_planet_revealed_coords_storage_address(
                        planetRevealedCoordsStorage.address
                    )
                    .send(opts);
                await addAuthorizedIfNeeded(
                    planetRevealedCoordsStorage,
                    core.address
                );
            }
        );

        await run('core.set_planet_events_storage_address()', async () => {
            await core.methods
                .set_planet_events_storage_address(planetEventsStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(planetEventsStorage, core.address);
        });

        await run('core.set_planet_artifacts_storage_address()', async () => {
            await core.methods
                .set_planet_artifacts_storage_address(
                    planetArtifactsStorage.address
                )
                .send(opts);
            await addAuthorizedIfNeeded(planetArtifactsStorage, core.address);
        });

        await run('core.set_arrivals_storage_address()', async () => {
            await core.methods
                .set_arrivals_storage_address(arrivalStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(arrivalStorage, core.address);
        });

        await run('core.set_artifact_storage_address()', async () => {
            await core.methods
                .set_artifact_storage_address(artifactStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(artifactStorage, core.address);
        });

        await run('core.set_artifact_location_storage_address()', async () => {
            await core.methods
                .set_artifact_location_storage_address(
                    artifactLocationStorage.address
                )
                .send(opts);
            await addAuthorizedIfNeeded(artifactLocationStorage, core.address);
        });
    });

    await run('Move system', async () => {
        await run('move.set_config_storage_address()', async () => {
            await move.methods
                .set_config_storage_address(config.address)
                .send(opts);
        });

        await run('move.set_world_storage_address()', async () => {
            await move.methods
                .set_world_storage_address(worldStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(worldStorage, move.address);
        });

        await run('move.set_player_storage_address()', async () => {
            await move.methods
                .set_player_storage_address(playerStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(playerStorage, move.address);
        });

        await run('move.set_planet_storage_address()', async () => {
            await move.methods
                .set_planet_storage_address(planetStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(planetStorage, move.address);
        });

        await run('move.set_planet_events_storage_address()', async () => {
            await move.methods
                .set_planet_events_storage_address(planetEventsStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(planetEventsStorage, move.address);
        });

        await run('move.set_planet_artifacts_storage_address()', async () => {
            await move.methods
                .set_planet_artifacts_storage_address(
                    planetArtifactsStorage.address
                )
                .send(opts);
            await addAuthorizedIfNeeded(planetArtifactsStorage, move.address);
        });

        await run('move.set_arrivals_storage_address()', async () => {
            await move.methods
                .set_arrivals_storage_address(arrivalStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(arrivalStorage, move.address);
        });

        await run('move.set_artifact_storage_address()', async () => {
            await move.methods
                .set_artifact_storage_address(artifactStorage.address)
                .send(opts);
            await addAuthorizedIfNeeded(artifactStorage, move.address);
        });

        await run('move.set_artifact_location_storage_address()', async () => {
            await move.methods
                .set_artifact_location_storage_address(
                    artifactLocationStorage.address
                )
                .send(opts);
            await addAuthorizedIfNeeded(artifactLocationStorage, move.address);
        });
    });

    const elapsedMs = Date.now() - scriptStartTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    const elapsedMin = Math.floor(elapsedMs / 60000);
    const elapsedSecRem = ((elapsedMs % 60000) / 1000).toFixed(1);
    const timeStr =
        elapsedMs >= 60000
            ? `${elapsedMin}m ${elapsedSecRem}s`
            : `${elapsedSec}s`;
    await run('ArtifactSystem system', async () => {
        await run('artifactSystem.set_config_storage_address()', async () => {
            await artifactSystem.methods
                .set_config_storage_address(config.address)
                .send(opts);
        });

        await run('artifactSystem.set_world_storage_address()', async () => {
            await artifactSystem.methods
                .set_world_storage_address(worldStorage.address)
                .send(opts);
            await worldStorage.methods
                .add_authorized_contract(artifactSystem.address)
                .send(opts);
        });

        await run('artifactSystem.set_player_storage_address()', async () => {
            await artifactSystem.methods
                .set_player_storage_address(playerStorage.address)
                .send(opts);
            await playerStorage.methods
                .add_authorized_contract(artifactSystem.address)
                .send(opts);
        });

        await run('artifactSystem.set_planet_storage_address()', async () => {
            await artifactSystem.methods
                .set_planet_storage_address(planetStorage.address)
                .send(opts);
            await planetStorage.methods
                .add_authorized_contract(artifactSystem.address)
                .send(opts);
        });

        await run(
            'artifactSystem.set_planet_artifacts_storage_address()',
            async () => {
                await artifactSystem.methods
                    .set_planet_artifacts_storage_address(
                        planetArtifactsStorage.address
                    )
                    .send(opts);
                await planetArtifactsStorage.methods
                    .add_authorized_contract(artifactSystem.address)
                    .send(opts);
            }
        );

        await run(
            'artifactSystem.set_planet_events_storage_address()',
            async () => {
                await artifactSystem.methods
                    .set_planet_events_storage_address(
                        planetEventsStorage.address
                    )
                    .send(opts);
                await planetEventsStorage.methods
                    .add_authorized_contract(artifactSystem.address)
                    .send(opts);
            }
        );

        await run('artifactSystem.set_arrivals_storage_address()', async () => {
            await artifactSystem.methods
                .set_arrivals_storage_address(arrivalStorage.address)
                .send(opts);
        });

        await run('artifactSystem.set_artifact_storage_address()', async () => {
            await artifactSystem.methods
                .set_artifact_storage_address(artifactStorage.address)
                .send(opts);
            await artifactStorage.methods
                .add_authorized_contract(artifactSystem.address)
                .send(opts);
        });

        await run(
            'artifactSystem.set_artifact_location_storage_address()',
            async () => {
                await artifactSystem.methods
                    .set_artifact_location_storage_address(
                        artifactLocationStorage.address
                    )
                    .send(opts);
                await artifactLocationStorage.methods
                    .add_authorized_contract(artifactSystem.address)
                    .send(opts);
            }
        );
    });

    console.log('\n✅ Configure done.');
    console.log(`⏱️  Total time: ${timeStr} (${elapsedMs}ms)`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
