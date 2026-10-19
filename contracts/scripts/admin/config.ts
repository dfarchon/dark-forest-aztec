/**
 * Read and print the current Config contract values.
 *
 *   pnpm admin:config
 *   pnpm admin:config --hashes
 *   pnpm admin:config --json
 *   pnpm admin:config --id <deployment-id>
 */
import { unwrapSimulateResult } from '@dfpunk/utils';

import { jsonReplacer, parseAdminArgs } from './helpers.ts';
import {
    connectContract,
    openAdminWallet,
    resolveAdminTarget,
} from './session.ts';

const USAGE =
    'Usage: pnpm admin:config [--hashes] [--json] [--id <deployment-id>]';

const HASH_LABELS = [
    'world',
    'snark',
    'game_core',
    'planet_level_thresholds',
    'planet_type_weights_tier_0',
    'planet_type_weights_tier_1',
    'planet_type_weights_tier_2',
    'planet_type_weights_tier_3',
    'artifacts',
    'spaceships',
    'space_junk',
    'capture_zones',
    'upgrade',
] as const;

function parseOptions(): { hashes: boolean; json: boolean; id?: string } {
    const parsed = parseAdminArgs(process.argv.slice(2), {
        flags: ['hashes', 'json'],
        usage: USAGE,
    });
    if (parsed.positionals.length > 0) {
        throw new Error(
            `${USAGE}\nUnexpected argument(s): ${parsed.positionals.join(', ')}`
        );
    }
    return {
        hashes: parsed.flags.has('hashes'),
        json: parsed.flags.has('json'),
        id: parsed.id,
    };
}

function printSection(title: string, value: unknown): void {
    console.log(`\n${title}:`);
    console.dir(value, { depth: null, colors: true });
}

async function main(): Promise<void> {
    const options = parseOptions();
    if (!options.json) console.log('Connecting to Aztec node...');
    const target = await resolveAdminTarget({
        id: options.id,
        contracts: ['Config'],
    });
    const { wallet, admin } = await openAdminWallet(target);
    const config = await connectContract(wallet, target.addresses, 'Config');
    const fullConfig = unwrapSimulateResult(
        await config.methods
            .get_full_config_unconstrained()
            .simulate({ from: admin })
    );
    const result: Record<string, unknown> = {
        network: target.network,
        node: target.nodeUrl,
        deployment: target.manifest.id,
        contract: config.address.toString(),
        from: admin.toString(),
        full_config: fullConfig,
    };

    if (options.hashes) {
        const hashes = unwrapSimulateResult(
            await config.methods
                .get_all_config_hashes_unconstrained()
                .simulate({ from: admin })
        ) as unknown[];
        result.hashes = Object.fromEntries(
            HASH_LABELS.map((label, index) => [label, hashes[index]])
        );
    }
    if (options.json) {
        console.log(JSON.stringify(result, jsonReplacer, 2));
        return;
    }
    console.log('\n' + '='.repeat(60));
    console.log('Network        :', result.network);
    console.log('Aztec node     :', result.node);
    console.log('Deployment     :', target.deploymentPath);
    console.log('Config contract:', result.contract);
    console.log('Simulated from :', result.from);
    console.log('='.repeat(60));
    printSection('Full config', result.full_config);
    if (result.hashes) printSection('Config hashes', result.hashes);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
