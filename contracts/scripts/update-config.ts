/**
 * Update game config values on a running Aztec network.
 *
 * Usage:
 *   pnpm update-config show              # read-only: print current config
 *   pnpm update-config fast              # 1-min cooldowns, 10x game speed
 *   pnpm update-config medium            # 10-min cooldowns, 3x game speed
 *   pnpm update-config default           # restore production defaults
 *
 * Requires: .env with ACCOUNT_*, CONFIG_CONTRACT_ADDRESS (run deploy first).
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

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface ConfigPreset {
    label: string;
    world: {
        time_factor_hundredths?: number;
        location_reveal_cooldown?: bigint;
    };
    artifacts: {
        photoid_activation_delay?: bigint;
    };
}

const PRESETS: Record<string, ConfigPreset> = {
    fast: {
        label: 'Fast testing (1-min cooldowns, 10x speed)',
        world: {
            time_factor_hundredths: 1000,
            location_reveal_cooldown: 60n,
        },
        artifacts: {
            photoid_activation_delay: 60n,
        },
    },
    medium: {
        label: 'Medium testing (10-min cooldowns, 3x speed)',
        world: {
            time_factor_hundredths: 300,
            location_reveal_cooldown: 600n,
        },
        artifacts: {
            photoid_activation_delay: 600n,
        },
    },
    default: {
        label: 'Production defaults',
        world: {
            time_factor_hundredths: 100,
            location_reveal_cooldown: 86_400n,
        },
        artifacts: {
            photoid_activation_delay: 14_400n,
        },
    },
};

const VALID_COMMANDS = ['show', ...Object.keys(PRESETS)];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    console.log(`    artifact_point_values    : ${ac.artifact_point_values}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const command = process.argv[2];
    if (!command || !VALID_COMMANDS.includes(command)) {
        console.log('Usage: pnpm update-config <command>\n');
        console.log('Commands:');
        console.log('  show      Print current config values (read-only)');
        for (const [name, preset] of Object.entries(PRESETS)) {
            console.log(`  ${name.padEnd(9)} ${preset.label}`);
        }
        process.exit(1);
    }

    const addresses = getConfigAddress();
    console.log(`Config contract: ${addresses['Config']}`);
    console.log(`Aztec Node URL : ${AZTEC_NODE_URL}\n`);

    console.log('Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: false,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const deployer = await loadAccountFromEnv(wallet, aztecNode, {
        ensureDeployed: false,
    });
    console.log(`Account loaded : ${deployer.toString()}\n`);

    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );
    const config = contracts['Config']!;

    const simOpts = { from: deployer };
    const sendOpts = {
        from: deployer,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

    // Read current configs (unconstrained = no tx, faster than public simulate)
    const worldConfig = (await config.methods
        .get_world_config_unconstrained()
        .simulate(simOpts)) as Record<string, unknown>;
    const artifactsConfig = (await config.methods
        .get_artifacts_config_unconstrained()
        .simulate(simOpts)) as Record<string, unknown>;

    if (command === 'show') {
        console.log('Current on-chain config:');
        printWorldConfig('[current]', worldConfig);
        printArtifactsConfig('[current]', artifactsConfig);
        console.log('');
        return;
    }

    // Apply preset
    const preset = PRESETS[command]!;
    console.log(`Applying preset: ${preset.label}\n`);

    printWorldConfig('[before]', worldConfig);
    printArtifactsConfig('[before]', artifactsConfig);

    const newWorldConfig = { ...worldConfig };
    if (preset.world.time_factor_hundredths !== undefined)
        newWorldConfig.time_factor_hundredths =
            preset.world.time_factor_hundredths;
    if (preset.world.location_reveal_cooldown !== undefined)
        newWorldConfig.location_reveal_cooldown =
            preset.world.location_reveal_cooldown;

    const newArtifactsConfig = { ...artifactsConfig };
    if (preset.artifacts.photoid_activation_delay !== undefined)
        newArtifactsConfig.photoid_activation_delay =
            preset.artifacts.photoid_activation_delay;

    console.log('\nSending set_world_config tx...');
    const t1 = Date.now();
    await config.methods.set_world_config(newWorldConfig).send(sendOpts);
    console.log(`  done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    console.log('Sending set_artifacts_config tx...');
    const t2 = Date.now();
    await config.methods
        .set_artifacts_config(newArtifactsConfig)
        .send(sendOpts);
    console.log(`  done (${((Date.now() - t2) / 1000).toFixed(1)}s)`);

    printWorldConfig('[after]', newWorldConfig);
    printArtifactsConfig('[after]', newArtifactsConfig);
    console.log('\nConfig updated successfully.');
}

main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
