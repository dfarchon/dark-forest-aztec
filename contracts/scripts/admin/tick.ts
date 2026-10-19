/**
 * Periodically send a no-op admin transaction so a local chain keeps
 * producing blocks and advancing timestamps.
 *
 *   pnpm admin:tick
 *   pnpm admin:tick 30
 *   pnpm admin:tick 30 --id <deployment-id>
 */
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

const USAGE = 'Usage: pnpm admin:tick [intervalSeconds] [--id <deployment-id>]';

function parseOptions(): { intervalSeconds: number; id?: string } {
    const parsed = parseAdminArgs(process.argv.slice(2), { usage: USAGE });
    if (parsed.positionals.length > 1) throw new Error(USAGE);
    const intervalText = parsed.positionals[0] ?? '120';
    if (!/^\d+$/.test(intervalText)) throw new Error(USAGE);
    const intervalSeconds = Number(intervalText);
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds <= 0) {
        throw new Error('intervalSeconds must be a positive integer.');
    }
    return { intervalSeconds, id: parsed.id };
}

async function main(): Promise<void> {
    const options = parseOptions();
    const target = await resolveAdminTarget({
        id: options.id,
        contracts: ['Admin'],
    });
    const walletContext = await openAdminWallet(target, {
        commandHint:
            `pnpm admin:tick ${options.intervalSeconds}` +
            (options.id ? ` --id ${options.id}` : ''),
    });
    if (!walletContext.feeCtx) {
        throw new Error('Fee payment context was not initialized.');
    }
    const adminContract = await connectContract(
        walletContext.wallet,
        target.addresses,
        'Admin'
    );
    const sendOptions = buildSendOpts(
        walletContext.admin,
        walletContext.feeCtx
    );

    console.log(
        `Timestamp ticker: sending a no-op transaction every ${options.intervalSeconds}s`
    );
    console.log(`Admin contract : ${adminContract.address.toString()}`);
    console.log(`Admin account  : ${walletContext.admin.toString()}`);
    console.log(`Deployment     : ${target.deploymentPath}`);
    console.log(`Aztec node     : ${target.nodeUrl}\n`);

    let count = 0;
    const run = async (): Promise<void> => {
        count += 1;
        const blockBefore = await target.aztecNode.getBlockNumber();
        try {
            await adminContract.methods
                .transfer_admin(walletContext.admin)
                .send(sendOptions);
            const blockAfter = await target.aztecNode.getBlockNumber();
            console.log(
                `[${new Date().toISOString()}] #${count} tx sent — block ${blockBefore} → ${blockAfter}`
            );
        } catch (err) {
            console.error(
                `[${new Date().toISOString()}] #${count} failed:`,
                err instanceof Error ? err.message : err
            );
        } finally {
            setTimeout(run, options.intervalSeconds * 1000);
        }
    };

    await run();
}

main().catch((err) => {
    if (exitIfAccountFundingRequired(err)) return;
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
