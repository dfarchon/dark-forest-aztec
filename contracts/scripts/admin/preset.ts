/**
 * Inspect or apply a game configuration preset.
 *
 *   pnpm admin:preset show
 *   pnpm admin:preset fast
 *   pnpm admin:preset medium
 *   pnpm admin:preset default
 */
import { unwrapSimulateResult } from '@dfpunk/utils';

import {
    buildSendOpts,
    exitIfAccountFundingRequired,
} from '../utils/feePayment.ts';
import { parseAdminArgs } from './helpers.ts';
import {
    connectContract,
    openAdminWallet,
    resolveAdminTarget,
} from './session.ts';

type ConfigPreset = {
    label: string;
    world: {
        time_factor_hundredths: number;
        location_reveal_cooldown: bigint;
    };
    artifacts: {
        photoid_activation_delay: bigint;
    };
};

const PRESETS: Record<string, ConfigPreset> = {
    fast: {
        label: 'Fast testing (1-min cooldowns, 10x speed)',
        world: {
            time_factor_hundredths: 1000,
            location_reveal_cooldown: 60n,
        },
        artifacts: { photoid_activation_delay: 60n },
    },
    medium: {
        label: 'Medium testing (10-min cooldowns, 3x speed)',
        world: {
            time_factor_hundredths: 300,
            location_reveal_cooldown: 600n,
        },
        artifacts: { photoid_activation_delay: 600n },
    },
    default: {
        label: 'Production defaults',
        world: {
            time_factor_hundredths: 100,
            location_reveal_cooldown: 86_400n,
        },
        artifacts: { photoid_activation_delay: 14_400n },
    },
};

const COMMANDS = ['show', ...Object.keys(PRESETS)];
const USAGE =
    'Usage: pnpm admin:preset <show|fast|medium|default> [--id <deployment-id>]';

function parseOptions(): { command: string; id?: string } {
    const parsed = parseAdminArgs(process.argv.slice(2), { usage: USAGE });
    const command = parsed.positionals[0];
    if (
        !command ||
        !COMMANDS.includes(command) ||
        parsed.positionals.length !== 1
    ) {
        throw new Error(USAGE);
    }
    return { command, id: parsed.id };
}

function printWorldConfig(
    label: string,
    config: Record<string, unknown>
): void {
    console.log(`\n${label} WorldConfig:`);
    console.log(
        `  time_factor_hundredths   : ${config.time_factor_hundredths}`
    );
    console.log(
        `  location_reveal_cooldown : ${config.location_reveal_cooldown}`
    );
    console.log(`  start_paused             : ${config.start_paused}`);
    console.log(`  spawn_rim_area           : ${config.spawn_rim_area}`);
    console.log(`  world_radius_locked      : ${config.world_radius_locked}`);
    console.log(`  world_radius_min         : ${config.world_radius_min}`);
    console.log(`  silver_score_value       : ${config.silver_score_value}`);
    console.log(
        `  planet_transfer_enabled  : ${config.planet_transfer_enabled}`
    );
    console.log(`  admin_can_add_planets    : ${config.admin_can_add_planets}`);
}

function printArtifactsConfig(
    label: string,
    config: Record<string, unknown>
): void {
    console.log(`\n${label} ArtifactsConfig:`);
    console.log(
        `  photoid_activation_delay : ${config.photoid_activation_delay}`
    );
    console.log(
        `  token_mint_end_timestamp : ${config.token_mint_end_timestamp}`
    );
    console.log(`  artifact_point_values    : ${config.artifact_point_values}`);
}

async function main(): Promise<void> {
    const options = parseOptions();
    const target = await resolveAdminTarget({
        id: options.id,
        contracts: ['Config'],
    });
    console.log(`Config contract: ${target.addresses.Config}`);
    console.log(`Deployment     : ${target.deploymentPath}`);
    console.log(`Aztec node     : ${target.nodeUrl}\n`);

    const walletContext =
        options.command === 'show'
            ? await openAdminWallet(target)
            : await openAdminWallet(target, {
                  commandHint:
                      `pnpm admin:preset ${options.command}` +
                      (options.id ? ` --id ${options.id}` : ''),
              });
    const config = await connectContract(
        walletContext.wallet,
        target.addresses,
        'Config'
    );
    const simulateOptions = { from: walletContext.admin };
    const worldConfig = unwrapSimulateResult(
        await config.methods
            .get_world_config_unconstrained()
            .simulate(simulateOptions)
    ) as Record<string, unknown>;
    const artifactsConfig = unwrapSimulateResult(
        await config.methods
            .get_artifacts_config_unconstrained()
            .simulate(simulateOptions)
    ) as Record<string, unknown>;

    if (options.command === 'show') {
        printWorldConfig('Current', worldConfig);
        printArtifactsConfig('Current', artifactsConfig);
        return;
    }
    if (!walletContext.feeCtx) {
        throw new Error('Fee payment context was not initialized.');
    }

    const preset = PRESETS[options.command]!;
    const updatedWorld = { ...worldConfig, ...preset.world };
    const updatedArtifacts = { ...artifactsConfig, ...preset.artifacts };
    const sendOptions = buildSendOpts(
        walletContext.admin,
        walletContext.feeCtx
    );

    console.log(`Applying preset: ${preset.label}`);
    printWorldConfig('Before', worldConfig);
    printArtifactsConfig('Before', artifactsConfig);
    console.log('\nSending set_world_config...');
    await config.methods.set_world_config(updatedWorld).send(sendOptions);
    console.log('Sending set_artifacts_config...');
    await config.methods
        .set_artifacts_config(updatedArtifacts)
        .send(sendOptions);
    printWorldConfig('After', updatedWorld);
    printArtifactsConfig('After', updatedArtifacts);
    console.log('\nConfig preset applied.');
}

main().catch((err) => {
    if (exitIfAccountFundingRequired(err)) return;
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
