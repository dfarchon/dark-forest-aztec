/**
 * Inspect or change whether gameplay ZK proof checks are enforced.
 *
 *   pnpm admin:zk-checks show
 *   pnpm admin:zk-checks skip
 *   pnpm admin:zk-checks enforce
 *   pnpm admin:zk-checks show --id <deployment-id>
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

const COMMANDS = ['show', 'skip', 'enforce'] as const;
type Command = (typeof COMMANDS)[number];
const USAGE =
    'Usage: pnpm admin:zk-checks <show|skip|enforce> [--id <deployment-id>]';

function parseOptions(): { command: Command; id?: string } {
    const parsed = parseAdminArgs(process.argv.slice(2), { usage: USAGE });
    const command = parsed.positionals[0] as Command | undefined;
    if (
        !command ||
        !COMMANDS.includes(command) ||
        parsed.positionals.length !== 1
    ) {
        throw new Error(USAGE);
    }
    return { command, id: parsed.id };
}

function printSnarkConfig(
    label: string,
    config: Record<string, unknown>
): void {
    console.log(`\n${label} SnarkConfig:`);
    console.log(`  disable_zk_checks   : ${config.disable_zk_checks}`);
    console.log(`  planethash_key      : ${config.planethash_key}`);
    console.log(`  spacetype_key       : ${config.spacetype_key}`);
    console.log(`  biomebase_key       : ${config.biomebase_key}`);
    console.log(`  perlin_mirror_x     : ${config.perlin_mirror_x}`);
    console.log(`  perlin_mirror_y     : ${config.perlin_mirror_y}`);
    console.log(`  perlin_length_scale : ${config.perlin_length_scale}`);
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
                      `pnpm admin:zk-checks ${options.command}` +
                      (options.id ? ` --id ${options.id}` : ''),
              });
    const config = await connectContract(
        walletContext.wallet,
        target.addresses,
        'Config'
    );
    const current = unwrapSimulateResult(
        await config.methods
            .get_snark_config_unconstrained()
            .simulate({ from: walletContext.admin })
    ) as Record<string, unknown>;

    if (options.command === 'show') {
        printSnarkConfig('Current', current);
        return;
    }

    const disableChecks = options.command === 'skip';
    if (Boolean(current.disable_zk_checks) === disableChecks) {
        console.log(
            `ZK checks are already ${disableChecks ? 'skipped' : 'enforced'}. Nothing to do.`
        );
        printSnarkConfig('Current', current);
        return;
    }
    if (!walletContext.feeCtx) {
        throw new Error('Fee payment context was not initialized.');
    }

    const updated = { ...current, disable_zk_checks: disableChecks };
    printSnarkConfig('Before', current);
    console.log(
        `\nSending set_snark_config (${disableChecks ? 'skip' : 'enforce'} ZK checks)...`
    );
    await config.methods
        .set_snark_config(updated)
        .send(buildSendOpts(walletContext.admin, walletContext.feeCtx));
    printSnarkConfig('After', updated);
    console.log(
        `\nZK proof checks are now ${disableChecks ? 'skipped' : 'enforced'}.`
    );
}

main().catch((err) => {
    if (exitIfAccountFundingRequired(err)) return;
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
