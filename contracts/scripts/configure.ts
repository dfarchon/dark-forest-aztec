/**
 * Run post-deploy interactions using contract addresses from .env.
 * Use after deploy: pnpm configure (or node --experimental-transform-types scripts/configure.ts)
 * Requires: .env with ACCOUNT_*, CONFIG_CONTRACT_ADDRESS, ADMIN_CONTRACT_ADDRESS, CORE_CONTRACT_ADDRESS, and all storage contract addresses.
 */
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
const PROVER_ENABLED = process.env.PROVER_ENABLED !== 'false';

const CONTRACT_SPECS = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
    {
        name: 'GlobalStateStorage',
        modulePath: './artifacts/GlobalStateStorage.ts',
        exportName: 'GlobalStateStorageContract',
    },
    {
        name: 'PlayerStorage',
        modulePath: './artifacts/PlayerStorage.ts',
        exportName: 'PlayerStorageContract',
    },
    {
        name: 'PlanetMetaStorage',
        modulePath: './artifacts/PlanetMetaStorage.ts',
        exportName: 'PlanetMetaStorageContract',
    },
    {
        name: 'PlanetOwnerStorage',
        modulePath: './artifacts/PlanetOwnerStorage.ts',
        exportName: 'PlanetOwnerStorageContract',
    },
    {
        name: 'PlanetCapsStorage',
        modulePath: './artifacts/PlanetCapsStorage.ts',
        exportName: 'PlanetCapsStorageContract',
    },
    {
        name: 'PlanetCoordsStorage',
        modulePath: './artifacts/PlanetCoordsStorage.ts',
        exportName: 'PlanetCoordsStorageContract',
    },
    {
        name: 'PlanetResourcesStorage',
        modulePath: './artifacts/PlanetResourcesStorage.ts',
        exportName: 'PlanetResourcesStorageContract',
    },
    {
        name: 'PlanetModsStorage',
        modulePath: './artifacts/PlanetModsStorage.ts',
        exportName: 'PlanetModsStorageContract',
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
        name: 'ArtifactStateStorage',
        modulePath: './artifacts/ArtifactStateStorage.ts',
        exportName: 'ArtifactStateStorageContract',
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
        name: 'PlanetUpgrade',
        modulePath: './artifacts/PlanetUpgrade.ts',
        exportName: 'PlanetUpgradeContract',
    },
];

function addressesFromEnv(): Record<string, string> {
    const envKeys: Array<[string, string]> = [
        ['Config', 'CONFIG_CONTRACT_ADDRESS'],
        ['GlobalStateStorage', 'GLOBAL_STATE_STORAGE_CONTRACT_ADDRESS'],
        ['PlayerStorage', 'PLAYER_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetMetaStorage', 'PLANET_META_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetOwnerStorage', 'PLANET_OWNER_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetCapsStorage', 'PLANET_CAPS_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetCoordsStorage', 'PLANET_COORDS_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetResourcesStorage', 'PLANET_RESOURCES_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetModsStorage', 'PLANET_MODS_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetEventsStorage', 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS'],
        ['PlanetArtifactsStorage', 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS'],
        ['ArrivalStorage', 'ARRIVAL_STORAGE_CONTRACT_ADDRESS'],
        ['ArtifactStateStorage', 'ARTIFACT_STATE_STORAGE_CONTRACT_ADDRESS'],
        ['Admin', 'ADMIN_CONTRACT_ADDRESS'],
        ['Core', 'CORE_CONTRACT_ADDRESS'],
        ['PlanetUpgrade', 'PLANET_UPGRADE_CONTRACT_ADDRESS'],
    ];
    const out: Record<string, string> = {};
    for (const [name, key] of envKeys) {
        const v = process.env[key];
        if (!v) throw new Error(`Missing ${key} in .env (run deploy first)`);
        out[name] = v;
    }
    return out;
}

async function main() {
    const addresses = addressesFromEnv();
    console.log('✅ All required environment variables are present');
    console.log(`📋 Config: ${addresses['Config']}`);
    console.log(`📋 Admin: ${addresses['Admin']}`);
    console.log(`📋 Core: ${addresses['Core']}`);
    console.log(`📋 PlanetUpgrade: ${addresses['PlanetUpgrade']}`);
    console.log(`📋 GlobalStateStorage: ${addresses['GlobalStateStorage']}`);
    console.log(`📋 PlayerStorage: ${addresses['PlayerStorage']}`);
    console.log(`📋 PlanetMetaStorage: ${addresses['PlanetMetaStorage']}`);
    console.log(`📋 PlanetOwnerStorage: ${addresses['PlanetOwnerStorage']}`);
    console.log(`📋 PlanetCapsStorage: ${addresses['PlanetCapsStorage']}`);
    console.log(
        `📋 PlanetResourcesStorage: ${addresses['PlanetResourcesStorage']}`
    );
    console.log(`📋 PlanetModsStorage: ${addresses['PlanetModsStorage']}`);
    console.log(`📋 PlanetEventsStorage: ${addresses['PlanetEventsStorage']}`);
    console.log(`📋 PlanetCoordsStorage: ${addresses['PlanetCoordsStorage']}`);
    console.log(
        `📋 PlanetArtifactsStorage: ${addresses['PlanetArtifactsStorage']}`
    );
    console.log(`📋 ArrivalStorage: ${addresses['ArrivalStorage']}`);
    console.log(
        `📋 ArtifactStateStorage: ${addresses['ArtifactStateStorage']}`
    );
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}\n`);

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    console.log('📝 Registering SponsoredFPC contract...');
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
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
    const planetUpgrade = contracts['PlanetUpgrade'];

    const globalStateStorage = contracts['GlobalStateStorage'];
    const playerStorage = contracts['PlayerStorage'];
    const planetMetaStorage = contracts['PlanetMetaStorage'];
    const planetOwnerStorage = contracts['PlanetOwnerStorage'];
    const planetCapsStorage = contracts['PlanetCapsStorage'];
    const planetResourcesStorage = contracts['PlanetResourcesStorage'];
    const planetModsStorage = contracts['PlanetModsStorage'];
    const planetEventsStorage = contracts['PlanetEventsStorage'];
    const planetCoordsStorage = contracts['PlanetCoordsStorage'];
    const planetArtifactsStorage = contracts['PlanetArtifactsStorage'];
    const arrivalStorage = contracts['ArrivalStorage'];
    const artifactStateStorage = contracts['ArtifactStateStorage'];

    if (!config || !admin) throw new Error('Config or Admin instance missing');
    if (!core) throw new Error('Core instance missing');
    if (!planetUpgrade) throw new Error('PlanetUpgrade instance missing');

    if (
        !globalStateStorage ||
        !playerStorage ||
        !planetMetaStorage ||
        !planetOwnerStorage ||
        !planetCapsStorage ||
        !planetResourcesStorage ||
        !planetModsStorage ||
        !planetEventsStorage ||
        !planetCoordsStorage ||
        !planetArtifactsStorage ||
        !arrivalStorage ||
        !artifactStateStorage
    ) {
        throw new Error('One or more storage contracts are missing');
    }

    const opts = {
        from: deployer,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

    const run = async (label: string, action: () => Promise<unknown>) => {
        console.log(`\n⚙️  ${label}`);
        await action();
        console.log(`✅ ${label}`);
    };

    console.log('\n🔍 Configuring contracts...\n');

    await run('Config.set_default_world_config()', async () => {
        const tx = await config.methods.set_default_world_config().send(opts);
        await tx.wait();
    });

    await run('Config.set_default_snark_constants()', async () => {
        const tx = await config.methods
            .set_default_snark_constants()
            .send(opts);
        await tx.wait();
    });

    await run('Config.set_default_game_config()', async () => {
        const tx = await config.methods.set_default_game_config().send(opts);
        await tx.wait();
    });

    for (const tier of [0, 1, 2, 3] as const) {
        await run(
            `Config.set_default_game_config_planet_type_weights_tier(${tier})`,
            async () => {
                const tx = await config.methods
                    .set_default_game_config_planet_type_weights_tier(tier)
                    .send(opts);
                await tx.wait();
            }
        );
    }

    await run('Config.set_default_artifacts_config()', async () => {
        const tx = await config.methods
            .set_default_artifacts_config()
            .send(opts);
        await tx.wait();
    });

    await run('Config.set_default_spaceships_config()', async () => {
        const tx = await config.methods
            .set_default_spaceships_config()
            .send(opts);
        await tx.wait();
    });

    await run('Config.set_default_space_junk_config()', async () => {
        const tx = await config.methods
            .set_default_space_junk_config()
            .send(opts);
        await tx.wait();
    });

    await run('Config.set_default_capture_zones_config()', async () => {
        const tx = await config.methods
            .set_default_capture_zones_config()
            .send(opts);
        await tx.wait();
    });

    await run('Config.set_default_upgrade_config()', async () => {
        const tx = await config.methods.set_default_upgrade_config().send(opts);
        await tx.wait();
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
            const tx = await config.methods
                .set_planet_default_stats(level, stats)
                .send(opts);
            await tx.wait();
        });
    }

    await run('Config.initializeUpgrades()', async () => {
        const tx = await config.methods.initializeUpgrades().send(opts);
        await tx.wait();
    });

    await run('Config.initialize_cumulative_rarities()', async () => {
        const tx = await config.methods
            .initialize_cumulative_rarities()
            .send(opts);
        await tx.wait();
    });

    await run('Admin system', async () => {
        await run('admin.set_config_storage_address()', async () => {
            const tx = await admin.methods
                .set_config_storage_address(config.address)
                .send(opts);
            await tx.wait();
        });

        await run('admin.set_global_state_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_global_state_storage_address(globalStateStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await globalStateStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });

        await run('admin.set_player_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_player_storage_address(playerStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await playerStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });

        await run('admin.set_planet_meta_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_planet_meta_storage_address(planetMetaStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetMetaStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });

        await run('admin.set_planet_owner_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_planet_owner_storage_address(planetOwnerStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetOwnerStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });

        await run('admin.set_planet_caps_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_planet_caps_storage_address(planetCapsStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetCapsStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });

        await run('admin.set_planet_resources_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_planet_resources_storage_address(
                    planetResourcesStorage.address
                )
                .send(opts);
            await tx1.wait();
            const tx2 = await planetResourcesStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });

        await run('admin.set_planet_mods_storage_address()', async () => {
            const tx1 = await admin.methods
                .set_planet_mods_storage_address(planetModsStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetModsStorage.methods
                .add_authorized_contract(admin.address)
                .send(opts);
            await tx2.wait();
        });
    });

    await run('PlanetUpgrade system', async () => {
        await run('planetUpgrade.set_config_storage_address()', async () => {
            const tx = await planetUpgrade.methods
                .set_config_storage_address(config.address)
                .send(opts);
            await tx.wait();
        });

        await run(
            'planetUpgrade.set_planet_owner_storage_address()',
            async () => {
                const tx = await planetUpgrade.methods
                    .set_planet_owner_storage_address(
                        planetOwnerStorage.address
                    )
                    .send(opts);
                await tx.wait();
            }
        );

        await run(
            'planetUpgrade.set_planet_caps_storage_address()',
            async () => {
                const tx1 = await planetUpgrade.methods
                    .set_planet_caps_storage_address(planetCapsStorage.address)
                    .send(opts);
                await tx1.wait();
                const tx2 = await planetCapsStorage.methods
                    .add_authorized_contract(planetUpgrade.address)
                    .send(opts);
                await tx2.wait();
            }
        );

        await run(
            'planetUpgrade.set_planet_resources_storage_address()',
            async () => {
                const tx1 = await planetUpgrade.methods
                    .set_planet_resources_storage_address(
                        planetResourcesStorage.address
                    )
                    .send(opts);
                await tx1.wait();
                const tx2 = await planetResourcesStorage.methods
                    .add_authorized_contract(planetUpgrade.address)
                    .send(opts);
                await tx2.wait();
            }
        );

        await run(
            'planetUpgrade.set_planet_events_storage_address()',
            async () => {
                const tx = await planetUpgrade.methods
                    .set_planet_events_storage_address(
                        planetEventsStorage.address
                    )
                    .send(opts);
                await tx.wait();
            }
        );

        await run(
            'planetUpgrade.set_planet_mods_storage_address()',
            async () => {
                const tx = await planetUpgrade.methods
                    .set_planet_mods_storage_address(planetModsStorage.address)
                    .send(opts);
                await tx.wait();
            }
        );
    });

    await run('Core system', async () => {
        await run('core.set_config_storage_address()', async () => {
            const tx = await core.methods
                .set_config_storage_address(config.address)
                .send(opts);
            await tx.wait();
        });

        await run('core.set_global_state_storage_address()', async () => {
            const tx1 = await core.methods
                .set_global_state_storage_address(globalStateStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await globalStateStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_player_storage_address()', async () => {
            const tx1 = await core.methods
                .set_player_storage_address(playerStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await playerStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_meta_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_meta_storage_address(planetMetaStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetMetaStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_owner_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_owner_storage_address(planetOwnerStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetOwnerStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_caps_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_caps_storage_address(planetCapsStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetCapsStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_resources_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_resources_storage_address(
                    planetResourcesStorage.address
                )
                .send(opts);
            await tx1.wait();
            const tx2 = await planetResourcesStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_mods_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_mods_storage_address(planetModsStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetModsStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_coords_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_coords_storage_address(planetCoordsStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetCoordsStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_events_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_events_storage_address(planetEventsStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await planetEventsStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_planet_artifacts_storage_address()', async () => {
            const tx1 = await core.methods
                .set_planet_artifacts_storage_address(
                    planetArtifactsStorage.address
                )
                .send(opts);
            await tx1.wait();
            const tx2 = await planetArtifactsStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_arrivals_storage_address()', async () => {
            const tx1 = await core.methods
                .set_arrivals_storage_address(arrivalStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await arrivalStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });

        await run('core.set_artifacts_storage_address()', async () => {
            const tx1 = await core.methods
                .set_artifacts_storage_address(artifactStateStorage.address)
                .send(opts);
            await tx1.wait();
            const tx2 = await artifactStateStorage.methods
                .add_authorized_contract(core.address)
                .send(opts);
            await tx2.wait();
        });
    });

    console.log('\n✅ Configure done.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
