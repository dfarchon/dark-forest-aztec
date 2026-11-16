/**
 * Fee harness: Admin.pause + Admin.unpause.
 *
 * Usage: pnpm exec tsx scripts/test/test-pause-unpause.ts
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { getTestContext } from './test-setup.ts';
import { loadWorld, measureCall, worldZero } from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const Admin = ctx.contracts['Admin'];
    if (!Admin) throw new Error('Admin not loaded');
    const admin = ctx.accounts.admin;

    let world = (await loadWorld(ctx)) ?? worldZero();
    if (world.paused) {
        await measureCall('unpause', ctx, Admin, 'unpause', [world], admin, {
            refreshTimestamp: false,
        });
        world = (await loadWorld(ctx)) ?? worldZero();
    }

    await measureCall('pause', ctx, Admin, 'pause', [world], admin, {
        refreshTimestamp: false,
    });
    world = (await loadWorld(ctx)) ?? worldZero();
    await measureCall('unpause', ctx, Admin, 'unpause', [world], admin, {
        refreshTimestamp: false,
    });
    console.log('✅ TEST SUCCESS — pause / unpause');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
