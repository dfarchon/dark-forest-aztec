import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import { type AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { createStore } from '@aztec/kv-store/lmdb';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { TestWallet } from '@aztec/test-wallet/server';
import * as dotenv from 'dotenv';
import path from 'path';

import { MainContract } from './artifacts/Main.ts';

// Load environment variables
dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.store');

// "simulate" = dry-run (no fee). "send" = broadcast tx (needs fee payment).
// const INTERACT_MODE: 'send' | 'simulate' =
//     process.env.INTERACT_MODE === 'send' ? 'send' : 'simulate';
const INTERACT_MODE: 'send' | 'simulate' = 'send';

async function setupWallet(aztecNode: AztecNode) {
    // Don't remove store for interaction script, we want to keep the state
    const store = await createStore('pxe', {
        dataDirectory: PXE_STORE_DIR,
        dataStoreMapSizeKb: 1e6,
    });

    const config = getPXEConfig();
    config.dataDirectory = 'pxe';
    config.proverEnabled = PROVER_ENABLED;

    return await TestWallet.create(aztecNode, config, {
        store,
        useLogSuffix: true,
    });
}

async function getSponsoredPFCContract() {
    const instance = await getContractInstanceFromInstantiationParams(
        SponsoredFPCContractArtifact,
        {
            salt: new Fr(SPONSORED_FPC_SALT),
        }
    );

    return instance;
}

async function loadAccount(wallet: TestWallet): Promise<AztecAddress> {
    if (
        !process.env.ACCOUNT_SALT ||
        !process.env.ACCOUNT_SECRET_KEY ||
        !process.env.ACCOUNT_SIGNING_KEY
    ) {
        throw new Error(
            'Account information not found in .env file. Please create an account first.'
        );
    }

    const salt = Fr.fromString(process.env.ACCOUNT_SALT);
    const secretKey = Fr.fromString(process.env.ACCOUNT_SECRET_KEY);
    const signingKey = Buffer.from(process.env.ACCOUNT_SIGNING_KEY, 'hex');

    const accountManager = await wallet.createECDSARAccount(
        secretKey,
        salt,
        signingKey
    );

    return accountManager.address;
}

async function interactWithContract() {
    if (
        !process.env.CONTRACT_ADDRESS ||
        !process.env.DEPLOYER_ADDRESS ||
        !process.env.DEPLOYMENT_SALT
    ) {
        throw new Error(
            'Contract information not found in .env file. Please create a contract first.'
        );
    }

    if (
        !process.env.ACCOUNT_SALT ||
        !process.env.ACCOUNT_SECRET_KEY ||
        !process.env.ACCOUNT_SIGNING_KEY
    ) {
        throw new Error(
            'Account information not found in .env file. Please create an account first.'
        );
    }

    console.log('✅ All required environment variables are present');
    console.log(`📋 Contract Address: ${process.env.CONTRACT_ADDRESS}`);
    console.log(`📋 Account Address: ${process.env.ACCOUNT_ADDRESS}`);
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}\n`);

    try {
        // Setup Aztec node and wallet
        console.log('🔗 Connecting to Aztec node...');
        const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
        const wallet = await setupWallet(aztecNode);

        // Register the SponsoredFPC contract (for sponsored fee payments)
        console.log('📝 Registering SponsoredFPC contract...');
        const sponsoredPFC = await getSponsoredPFCContract();
        await wallet.registerContract(
            sponsoredPFC,
            SponsoredFPCContractArtifact
        );

        // Load account
        console.log('👤 Loading account from .env...');
        const accountAddress = await loadAccount(wallet);
        console.log(`✅ Account loaded: ${accountAddress.toString()}\n`);

        // Connect to the contract
        const contractAddress = AztecAddress.fromString(
            process.env.CONTRACT_ADDRESS
        );
        console.log(
            `📄 Connecting to contract at ${contractAddress.toString()}...`
        );

        // Register the contract with the wallet
        try {
            const contractInstance =
                await getContractInstanceFromInstantiationParams(
                    MainContract.artifact,
                    {
                        constructorArgs: [
                            AztecAddress.fromString(
                                process.env.DEPLOYER_ADDRESS
                            ),
                        ],
                        salt: Fr.fromString(process.env.DEPLOYMENT_SALT),
                        deployer: AztecAddress.fromString(
                            process.env.DEPLOYER_ADDRESS
                        ),
                    }
                );
            await wallet.registerContract(
                contractInstance,
                MainContract.artifact
            );
            console.log('✅ Contract registered with wallet');
        } catch (err) {
            // Contract might already be registered, continue
            console.log(
                '⚠️  Contract registration skipped (may already be registered)'
            );
            console.log(err);
        }

        const main = MainContract.at(contractAddress, wallet);

        // Interact with the contract
        console.log('\n🔍 Interacting with contract...\n');

        // Call get_admin
        try {
            console.log('📞 Calling get_admin()...');
            const admin = await main.methods
                .get_admin()
                .simulate({ from: accountAddress });

            console.log(`✅ Admin address: ${admin.toString()}`);
            console.log(`✅ Account address: ${accountAddress.toString()}`);
            console.log(
                `✅ Match: ${admin.toString() === accountAddress.toString() ? 'Yes' : 'No'}`
            );

            if (admin.toString() !== accountAddress.toString()) {
                throw new Error('Caller is not admin; cannot set defaults');
            }

            const sendOpts = {
                from: accountAddress,
                fee: {
                    paymentMethod: new SponsoredFeePaymentMethod(
                        sponsoredPFC.address
                    ),
                },
            };

            const run = async (label: string, action: () => Promise<void>) => {
                console.log(`\n⚙️  ${INTERACT_MODE}: ${label}`);
                await action();
                console.log(`✅ ${label}`);
            };

            // ---- set defaults (split to avoid SSTORE write limit) ----
            await run('set_default_world_config()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .set_default_world_config()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .set_default_world_config()
                        .simulate({ from: accountAddress });
                }
            });

            await run('set_default_snark_constants()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .set_default_snark_constants()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .set_default_snark_constants()
                        .simulate({ from: accountAddress });
                }
            });

            await run('set_default_artifacts_config()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .set_default_artifacts_config()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .set_default_artifacts_config()
                        .simulate({ from: accountAddress });
                }
            });

            await run('set_default_spaceships_config()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .set_default_spaceships_config()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .set_default_spaceships_config()
                        .simulate({ from: accountAddress });
                }
            });

            await run('set_default_space_junk_config()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .set_default_space_junk_config()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .set_default_space_junk_config()
                        .simulate({ from: accountAddress });
                }
            });

            await run('set_default_capture_zones_config()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .set_default_capture_zones_config()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .set_default_capture_zones_config()
                        .simulate({ from: accountAddress });
                }
            });

            // Game config is split across multiple setters to stay under 63 SSTORE writes per call.
            await run(
                'set_default_game_config() (core + thresholds)',
                async () => {
                    if (INTERACT_MODE === 'send') {
                        const tx = await main.methods
                            .set_default_game_config()
                            .send(sendOpts);
                        await tx.wait();
                    } else {
                        await main.methods
                            .set_default_game_config()
                            .simulate({ from: accountAddress });
                    }
                }
            );

            for (const tier of [0, 1, 2, 3] as const) {
                await run(
                    `set_default_game_config_planet_type_weights_tier(${tier})`,
                    async () => {
                        if (INTERACT_MODE === 'send') {
                            const tx = await main.methods
                                .set_default_game_config_planet_type_weights_tier(
                                    tier
                                )
                                .send(sendOpts);
                            await tx.wait();
                        } else {
                            await main.methods
                                .set_default_game_config_planet_type_weights_tier(
                                    tier
                                )
                                .simulate({ from: accountAddress });
                        }
                    }
                );
            }

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
                    if (INTERACT_MODE === 'send') {
                        const tx = await main.methods
                            .set_planet_default_stats(level, stats)
                            .send(sendOpts);
                        await tx.wait();
                    } else {
                        await main.methods
                            .set_planet_default_stats(level, stats)
                            .simulate({ from: accountAddress });
                    }
                });
            }

            // Upgrades: 12 entries * 5 fields = 60 writes, safe to do in one call.
            await run('initializeUpgrades()', async () => {
                if (INTERACT_MODE === 'send') {
                    const tx = await main.methods
                        .initializeUpgrades()
                        .send(sendOpts);
                    await tx.wait();
                } else {
                    await main.methods
                        .initializeUpgrades()
                        .simulate({ from: accountAddress });
                }
            });

            // ---- read back initialized configs and print in DF-style format ----
            type WorldConfig = {
                start_paused: boolean;
                time_factor_hundredths: unknown;
                spawn_rim_area: unknown;
                world_radius_locked: boolean;
                world_radius_min: unknown;
                location_reveal_cooldown_s: unknown;
                silver_score_value: unknown;
                planet_transfer_enabled: boolean;
                admin_can_add_planets: boolean;
            };

            type SnarkConstants = {
                disable_zk_checks: boolean;
                planethash_key: unknown;
                spacetype_key: unknown;
                biomebase_key: unknown;
                perlin_mirror_x: boolean;
                perlin_mirror_y: boolean;
                perlin_length_scale: unknown;
            };

            type GameConfigCore = {
                max_natural_planet_level: unknown;
                perlin_threshold_1: unknown;
                perlin_threshold_2: unknown;
                perlin_threshold_3: unknown;
                init_perlin_min: unknown;
                init_perlin_max: unknown;
                biome_threshold_1: unknown;
                biome_threshold_2: unknown;
                planet_rarity: unknown;
            };

            type PlanetLevelThresholds = { thresholds: unknown[] };
            type PlanetTypeWeightsTier = { weights: unknown[][] };

            type ArtifactsConfig = {
                token_mint_end_timestamp_ms: unknown;
                artifact_point_values: unknown[];
                photoid_activation_delay_s: unknown;
            };

            type SpaceshipsConfig = {
                gear: boolean;
                mothership: boolean;
                titan: boolean;
                crescent: boolean;
                whale: boolean;
            };

            type SpaceJunkConfig = {
                space_junk_enabled: boolean;
                space_junk_limit: unknown;
                planet_level_junk: unknown[];
                abandon_speed_change_percent: unknown;
                abandon_range_change_percent: unknown;
            };

            type CaptureZonesConfig = {
                capture_zones_enabled: boolean;
                capture_zone_change_block_interval: unknown;
                capture_zone_radius: unknown;
                capture_zone_planet_level_score: unknown[];
                capture_zone_hold_blocks_required: unknown;
                capture_zones_per_5000_world_radius: unknown;
            };

            const fmtBool = (b: boolean) => (b ? 'true' : 'false');

            const fmtU = (v: unknown) => {
                if (typeof v === 'bigint') return v.toString();
                if (typeof v === 'number') return Math.trunc(v).toString();
                if (typeof v === 'string') return v;
                return String(v);
            };

            const fmtUWithUnderscores = (v: unknown) => {
                const s = fmtU(v).replace(/_/g, '');
                const m = s.match(/^(-?)(\d+)$/);
                if (!m) return s;
                const sign = m[1];
                const digits = m[2];
                const withUnderscores = digits.replace(
                    /\B(?=(\d{3})+(?!\d))/g,
                    '_'
                );
                return `${sign}${withUnderscores}`;
            };

            const fmtArr = (
                arr: unknown[],
                indent: string,
                mapFn: (x: unknown) => string
            ) => `[\n${arr.map((x) => `${indent}${mapFn(x)},`).join('\n')}\n]`;

            console.log('\n\n=== Readback: contract configs ===\n');

            const world: WorldConfig = await main.methods
                .get_world_config()
                .simulate({ from: accountAddress });
            const snark: SnarkConstants = await main.methods
                .get_snark_constants()
                .simulate({ from: accountAddress });
            const gameCore: GameConfigCore = await main.methods
                .get_game_config_core()
                .simulate({ from: accountAddress });
            const thresholds: PlanetLevelThresholds = await main.methods
                .get_planet_level_thresholds()
                .simulate({ from: accountAddress });

            const tiers: PlanetTypeWeightsTier[] = await Promise.all(
                ([0, 1, 2, 3] as const).map((t) =>
                    main.methods
                        .get_planet_type_weights_tier(t)
                        .simulate({ from: accountAddress })
                )
            );

            const artifacts: ArtifactsConfig = await main.methods
                .get_artifacts_config()
                .simulate({ from: accountAddress });
            const ships: SpaceshipsConfig = await main.methods
                .get_spaceships_config()
                .simulate({ from: accountAddress });
            const junk: SpaceJunkConfig = await main.methods
                .get_space_junk_config()
                .simulate({ from: accountAddress });
            const cz: CaptureZonesConfig = await main.methods
                .get_capture_zones_config()
                .simulate({ from: accountAddress });

            const tokenMintEndMs = BigInt(
                fmtU(artifacts.token_mint_end_timestamp_ms)
            );
            const tokenMintIso = new Date(Number(tokenMintEndMs)).toISOString();

            const planetLevelThresholdsPretty = fmtArr(
                thresholds.thresholds,
                '',
                (x) => fmtUWithUnderscores(x)
            );

            const planetTypeWeightsPretty = `[\n${tiers
                .map((tier) => {
                    const rows = tier.weights
                        .map((row) => {
                            const rowVals = row.map((n) => fmtU(n)).join(', ');
                            return `        [${rowVals}],`;
                        })
                        .join('\n');
                    return `    [\n${rows}\n    ],`;
                })
                .join('\n')}\n]`;

            const captureZoneScoresPretty = fmtArr(
                cz.capture_zone_planet_level_score,
                '',
                (x) => fmtUWithUnderscores(x)
            );

            console.log(
                `# World

START_PAUSED = ${fmtBool(world.start_paused)}
TIME_FACTOR_HUNDREDTHS = ${fmtU(world.time_factor_hundredths)} # speedup/slowdown game
SPAWN_RIM_AREA = ${fmtU(world.spawn_rim_area)}
WORLD_RADIUS_LOCKED = ${fmtBool(world.world_radius_locked)}
WORLD_RADIUS_MIN = ${fmtU(world.world_radius_min)}

LOCATION_REVEAL_COOLDOWN = ${fmtU(world.location_reveal_cooldown_s)} # seconds
SILVER_SCORE_VALUE = ${fmtU(world.silver_score_value)}
PLANET_TRANSFER_ENABLED = ${fmtBool(world.planet_transfer_enabled)}
ADMIN_CAN_ADD_PLANETS = ${fmtBool(world.admin_can_add_planets)}

# SNARK keys & Perlin parameters

DISABLE_ZK_CHECKS = ${fmtBool(snark.disable_zk_checks)}
PLANETHASH_KEY = ${fmtU(snark.planethash_key)}
SPACETYPE_KEY = ${fmtU(snark.spacetype_key)}
BIOMEBASE_KEY = ${fmtU(snark.biomebase_key)}
PERLIN_MIRROR_X = ${fmtBool(snark.perlin_mirror_x)}
PERLIN_MIRROR_Y = ${fmtBool(snark.perlin_mirror_y)}
PERLIN_LENGTH_SCALE = ${fmtU(snark.perlin_length_scale)} # must be a power of two no greater than 16384

# Planets

# Game configuration

MAX_NATURAL_PLANET_LEVEL = ${fmtU(gameCore.max_natural_planet_level)}
PERLIN_THRESHOLD_1 = ${fmtU(gameCore.perlin_threshold_1)}
PERLIN_THRESHOLD_2 = ${fmtU(gameCore.perlin_threshold_2)}
PERLIN_THRESHOLD_3 = ${fmtU(gameCore.perlin_threshold_3)}
INIT_PERLIN_MIN = ${fmtU(gameCore.init_perlin_min)}
INIT_PERLIN_MAX = ${fmtU(gameCore.init_perlin_max)}
BIOME_THRESHOLD_1 = ${fmtU(gameCore.biome_threshold_1)}
BIOME_THRESHOLD_2 = ${fmtU(gameCore.biome_threshold_2)}

PLANET_LEVEL_THRESHOLDS = ${planetLevelThresholdsPretty}
PLANET_RARITY = ${fmtU(gameCore.planet_rarity)}

# (100 is 100%)

PLANET_TYPE_WEIGHTS = ${planetTypeWeightsPretty}

# Artifacts

TOKEN_MINT_END_TIMESTAMP = ${tokenMintIso} # from ms=${fmtU(artifacts.token_mint_end_timestamp_ms)}
ARTIFACT_POINT_VALUES = ${fmtArr(artifacts.artifact_point_values, '', (x) =>
                    fmtUWithUnderscores(x)
                )}
PHOTOID_ACTIVATION_DELAY = ${fmtU(artifacts.photoid_activation_delay_s)} # seconds

# Spaceships

GEAR = ${fmtBool(ships.gear)}
MOTHERSHIP = ${fmtBool(ships.mothership)}
TITAN = ${fmtBool(ships.titan)}
CRESCENT = ${fmtBool(ships.crescent)}
WHALE = ${fmtBool(ships.whale)}

# Space junk

SPACE_JUNK_ENABLED = ${fmtBool(junk.space_junk_enabled)}
SPACE_JUNK_LIMIT = ${fmtU(junk.space_junk_limit)}
PLANET_LEVEL_JUNK = [${junk.planet_level_junk.map((x) => fmtU(x)).join(', ')}]
ABANDON_SPEED_CHANGE_PERCENT = ${fmtU(junk.abandon_speed_change_percent)}
ABANDON_RANGE_CHANGE_PERCENT = ${fmtU(junk.abandon_range_change_percent)}

# Capture zones

CAPTURE_ZONES_ENABLED = ${fmtBool(cz.capture_zones_enabled)}
CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL = ${fmtU(cz.capture_zone_change_block_interval)}
CAPTURE_ZONE_RADIUS = ${fmtU(cz.capture_zone_radius)}
CAPTURE_ZONE_PLANET_LEVEL_SCORE = ${captureZoneScoresPretty}
CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED = ${fmtU(cz.capture_zone_hold_blocks_required)}
CAPTURE_ZONES_PER_5000_WORLD_RADIUS = ${fmtU(cz.capture_zones_per_5000_world_radius)}
`
            );

            // Read default planets state
            // NOTE: getters should be simulated (no fee / no tx).
            type UnknownRecord = Record<string, unknown>;

            const fmtScalar = (v: unknown) =>
                typeof v === 'bigint' ? v.toString() : String(v);

            const printKeyValues = (record: UnknownRecord, indent = '  ') => {
                const entries = Object.entries(record).sort(([a], [b]) =>
                    a.localeCompare(b)
                );
                const pad = Math.max(0, ...entries.map(([k]) => k.length));
                for (const [k, v] of entries) {
                    console.log(
                        `${indent}${k.toUpperCase().padEnd(pad)} = ${fmtScalar(v)}`
                    );
                }
            };

            const DEFAULT_PLANET_MAX_LEVEL = 9;
            const defaultPlanetLevels = Array.from(
                { length: DEFAULT_PLANET_MAX_LEVEL + 1 },
                (_, i) => i
            );
            const defaultPlanetsStates = await Promise.all(
                defaultPlanetLevels.map(async (level) => {
                    const stats = (await main.methods
                        .get_planet_default_stats(level)
                        .simulate({ from: accountAddress })) as UnknownRecord;
                    return { level, stats };
                })
            );

            console.log('\n# Default Planets Stats');
            for (const { level, stats } of defaultPlanetsStates) {
                console.log(`\n## Level ${level}`);
                printKeyValues(stats);
            }

            // Read upgrades
            // 3 branches (0,1,2) x 4 levels (0~3) => keys 0-3, 10-13, 20-23
            const UPGRADE_BRANCHES = 3;
            const UPGRADE_LEVELS_PER_BRANCH = 4;

            console.log('\n# Upgrades');
            for (let branch = 0; branch < UPGRADE_BRANCHES; branch++) {
                console.log(`\n## Branch ${branch}`);
                for (
                    let level = 0;
                    level < UPGRADE_LEVELS_PER_BRANCH;
                    level++
                ) {
                    const key = BigInt(branch * 10 + level);
                    const upgrade = (await main.methods
                        .get_upgrade(key)
                        .simulate({ from: accountAddress })) as UnknownRecord;

                    console.log(`\n### Level ${level} (key=${key.toString()})`);
                    printKeyValues(upgrade);
                }
            }
        } catch (err) {
            console.error('❌ Failed to call get_admin():', err);
            throw err;
        }

        console.log('\n✅ Contract interaction completed successfully!');
    } catch (error) {
        console.error('\n❌ Error interacting with contract:', error);
        process.exit(1);
    }
}

// Run the interaction
interactWithContract()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

export { interactWithContract };
