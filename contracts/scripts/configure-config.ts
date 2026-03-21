/**
 * Initialize only the Config contract (same Phase 1 as configure.ts).
 *
 * Use when storage/system addresses are already wired but Config defaults need
 * to be (re)applied — e.g. new Config deploy, or partial setup.
 *
 * Requires: .env with ACCOUNT_ADDRESS, ACCOUNT_SALT, ACCOUNT_SECRET_KEY,
 * ACCOUNT_SIGNING_KEY, CONFIG_CONTRACT_ADDRESS. `from` is always ACCOUNT_ADDRESS
 * (keys must derive the same address).
 *
 * Build: run `pnpm build-contracts` in contracts/ first so `scripts/artifacts/Config.ts` exists.
 *
 * Run:
 *   pnpm configure-config              # read snapshot then apply Phase 1 txs
 *   pnpm configure-config -- show      # read only, no txs (no account deploy, prover off)
 *   node --experimental-transform-types scripts/configure-config.ts show
 *
 * Note: Default `loadAccountFromEnv` uses ensureDeployed: false (same as update-config).
 * Proving during "Loading account" was from deployAccountIfNeeded when ensureDeployed was true
 * and the PXE had no local account — not from unconstrained reads.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

import { planetDefaultStats } from './configure-planet-default-stats.ts';
import {
    formatSimulatedValue,
    getContractInstances,
    getSponsoredPFCContract,
    loadAccountFromEnv,
    setupWallet,
    unwrapSimulateResult,
} from './utils/index.ts';

dotenv.config({
    path: path.join(import.meta.dirname, '..', '.env'),
    override: true,
});

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const isLocalSandbox =
    /^https?:\/\/localhost(:\d+)?$/i.test(AZTEC_NODE_URL) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(AZTEC_NODE_URL);
const PROVER_ENABLED =
    process.env.PROVER_ENABLED === 'true' ||
    (!isLocalSandbox && process.env.PROVER_ENABLED !== 'false');

const CONTRACT_SPECS = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
];

function getConfigAddress(): Record<string, string> {
    const v = process.env.CONFIG_CONTRACT_ADDRESS;
    if (!v)
        throw new Error(
            'Missing CONFIG_CONTRACT_ADDRESS in .env (run deploy first)'
        );
    return { Config: v };
}

const CONFIG_ARTIFACT_TS = path.join(
    import.meta.dirname,
    'artifacts',
    'Config.ts'
);

function assertConfigArtifactExists() {
    if (!fs.existsSync(CONFIG_ARTIFACT_TS)) {
        throw new Error(
            `Missing ${CONFIG_ARTIFACT_TS}\n` +
                'Run from contracts/: pnpm build-contracts\n' +
                '(compiles Noir → target/, codegen, copy-artifacts → scripts/artifacts/)'
        );
    }
}

/** Canonical `from` address: must match keys loaded by loadAccountFromEnv. */
function requireAccountAddressFromEnv(): AztecAddress {
    const raw = process.env.ACCOUNT_ADDRESS?.trim();
    if (!raw) {
        throw new Error(
            'Missing ACCOUNT_ADDRESS in .env — configure-config always uses this address as `from`'
        );
    }
    return AztecAddress.fromString(raw);
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

/** Matches configure.ts Phase 1 step count. */
const TOTAL_STEPS = 13;

function printWorldConfig(label: string, wc: Record<string, unknown>) {
    console.log(`\n  ${label} WorldConfig:`);
    console.log(`    time_factor_hundredths : ${wc.time_factor_hundredths}`);
    console.log(
        `    location_reveal_cooldown : ${wc.location_reveal_cooldown}`
    );
    console.log(`    start_paused           : ${wc.start_paused}`);
    console.log(`    spawn_rim_area         : ${wc.spawn_rim_area}`);
    console.log(`    world_radius_locked    : ${wc.world_radius_locked}`);
    console.log(`    world_radius_min       : ${wc.world_radius_min}`);
    console.log(`    silver_score_value     : ${wc.silver_score_value}`);
    console.log(`    planet_transfer_enabled: ${wc.planet_transfer_enabled}`);
    console.log(`    admin_can_add_planets  : ${wc.admin_can_add_planets}`);
}

function printArtifactsConfig(label: string, ac: Record<string, unknown>) {
    console.log(`\n  ${label} ArtifactsConfig:`);
    console.log(
        `    photoid_activation_delay  : ${ac.photoid_activation_delay}`
    );
    console.log(
        `    token_mint_end_timestamp  : ${ac.token_mint_end_timestamp}`
    );
    console.log('    artifact_point_values:');
    console.log(
        formatSimulatedValue(ac.artifact_point_values).replace(/^/gm, '      ')
    );
}

function logDeep(label: string, value: unknown) {
    console.log(`\n  ${label}`);
    console.log(formatSimulatedValue(value).replace(/^/gm, '  '));
}

/**
 * Read current Config via unconstrained simulate (no tx), same pattern as update-config.
 */
async function printCurrentConfigBeforeWrites(
    config: ContractBase,
    deployer: AztecAddress
) {
    const simOpts = { from: deployer };

    console.log(
        '\n📖 Current on-chain Config (unconstrained read, before writes)...\n'
    );

    const raw = await Promise.all([
        config.methods.get_world_config_unconstrained().simulate(simOpts),
        config.methods.get_artifacts_config_unconstrained().simulate(simOpts),
        config.methods.get_snark_config_unconstrained().simulate(simOpts),
        config.methods.get_game_config_core_unconstrained().simulate(simOpts),
        config.methods
            .get_planet_level_thresholds_unconstrained()
            .simulate(simOpts),
        config.methods.get_spaceships_config_unconstrained().simulate(simOpts),
        config.methods.get_space_junk_config_unconstrained().simulate(simOpts),
        config.methods
            .get_capture_zones_config_unconstrained()
            .simulate(simOpts),
        config.methods.get_upgrade_config_unconstrained().simulate(simOpts),
        config.methods.get_default_stats_unconstrained().simulate(simOpts),
        config.methods
            .get_planet_type_weights_tier_unconstrained(0)
            .simulate(simOpts),
        config.methods
            .get_planet_type_weights_tier_unconstrained(1)
            .simulate(simOpts),
        config.methods
            .get_planet_type_weights_tier_unconstrained(2)
            .simulate(simOpts),
        config.methods
            .get_planet_type_weights_tier_unconstrained(3)
            .simulate(simOpts),
    ]);

    const worldConfig = unwrapSimulateResult(raw[0]) as Record<string, unknown>;
    const artifactsConfig = unwrapSimulateResult(raw[1]) as Record<
        string,
        unknown
    >;
    const snarkConfig = unwrapSimulateResult(raw[2]);
    const gameConfigCore = unwrapSimulateResult(raw[3]);
    const planetLevelThresholds = unwrapSimulateResult(raw[4]);
    const spaceshipsConfig = unwrapSimulateResult(raw[5]);
    const spaceJunkConfig = unwrapSimulateResult(raw[6]);
    const captureZonesConfig = unwrapSimulateResult(raw[7]);
    const upgradeConfig = unwrapSimulateResult(raw[8]);
    const defaultStats = unwrapSimulateResult(raw[9]);
    const typeTier0 = unwrapSimulateResult(raw[10]);
    const typeTier1 = unwrapSimulateResult(raw[11]);
    const typeTier2 = unwrapSimulateResult(raw[12]);
    const typeTier3 = unwrapSimulateResult(raw[13]);

    printWorldConfig('[current]', worldConfig);
    printArtifactsConfig('[current]', artifactsConfig);

    logDeep('[current] SnarkConfig:', snarkConfig);
    logDeep('[current] GameConfigCore:', gameConfigCore);
    logDeep('[current] PlanetLevelThresholds:', planetLevelThresholds);
    logDeep('[current] SpaceshipsConfig:', spaceshipsConfig);
    logDeep('[current] SpaceJunkConfig:', spaceJunkConfig);
    logDeep('[current] CaptureZonesConfig:', captureZonesConfig);
    logDeep('[current] UpgradeConfig:', upgradeConfig);
    logDeep('[current] PlanetDefaultStats[0..9]:', defaultStats);

    logDeep('[current] PlanetTypeWeightsTier[0]:', typeTier0);
    logDeep('[current] PlanetTypeWeightsTier[1]:', typeTier1);
    logDeep('[current] PlanetTypeWeightsTier[2]:', typeTier2);
    logDeep('[current] PlanetTypeWeightsTier[3]:', typeTier3);

    const cumulativeRaw = await Promise.all(
        [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n].map((i) =>
            config.methods
                .get_cumulative_rarity_unconstrained(i)
                .simulate(simOpts)
        )
    );
    const cumulative = cumulativeRaw.map((v) => unwrapSimulateResult(v));
    logDeep('[current] cumulative_rarities[0..9]:', cumulative);
    console.log('');
}

async function main() {
    const scriptStartTime = Date.now();
    assertConfigArtifactExists();

    const readOnly =
        process.argv[2] === 'show' || process.argv.includes('--read-only');
    const proverForRun = readOnly ? false : PROVER_ENABLED;

    const addresses = getConfigAddress();

    console.log('✅ CONFIG_CONTRACT_ADDRESS present');
    console.log(`📋 Config: ${addresses['Config']}`);
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}`);
    if (readOnly) {
        console.log('📌 Mode: show (read-only, no txs; prover OFF)\n');
    } else {
        console.log(
            `⚡ Prover: ${proverForRun ? 'ON (slow)' : 'OFF (fast)'}\n`
        );
    }

    if (proverForRun && isLocalSandbox) {
        console.warn(
            '⚠️  Prover ON: configure-config will be slow. For local sandbox only, set PROVER_ENABLED=false for a fast run.\n'
        );
    }

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    console.log('📝 Registering SponsoredFPC contract...');
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: proverForRun,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const deployer = requireAccountAddressFromEnv();
    console.log(
        '👤 Loading keys from .env (using ACCOUNT_ADDRESS as `from`)...'
    );
    /** Same as update-config: avoids deployAccountIfNeeded (ClientIVC) when only simulating. */
    const loaded = await loadAccountFromEnv(wallet, aztecNode, {
        ensureDeployed: false,
    });
    if (loaded.toString() !== deployer.toString()) {
        throw new Error(
            `ACCOUNT_ADDRESS (${deployer}) does not match keys in .env (derived ${loaded}). Fix ACCOUNT_* variables.`
        );
    }
    console.log(`✅ Using account: ${deployer.toString()}\n`);

    console.log('📄 Connecting to Config...');
    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );
    const config = contracts['Config'];
    if (!config) throw new Error('Config instance missing');

    await printCurrentConfigBeforeWrites(config, deployer);

    if (readOnly) {
        console.log('✅ show done (no transactions sent).');
        return;
    }

    const opts = {
        from: deployer,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

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

    console.log(
        `\n🔍 Config initialization only (${TOTAL_STEPS} steps, same as configure.ts Phase 1)...\n`
    );

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

    const elapsedMs = Date.now() - scriptStartTime;
    console.log('\n✅ configure-config done (Config only).');
    console.log(`⏱️  Total time: ${formatElapsed(elapsedMs)} (${elapsedMs}ms)`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
