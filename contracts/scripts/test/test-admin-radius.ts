/**
 * Fee harness: Admin.admin_set_world_radius.
 *
 * Usage: pnpm exec tsx scripts/test/test-admin-radius.ts
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { getTestContext } from './test-setup.ts';
import { loadWorld, measureCall, toBigint, worldZero } from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const Admin = ctx.contracts['Admin'];
    if (!Admin) throw new Error('Admin not loaded');
    const admin = ctx.accounts.admin;
    const world = (await loadWorld(ctx)) ?? worldZero();
    const radius = toBigint(world.radius) + 1n;

    await measureCall(
        'admin_set_world_radius',
        ctx,
        Admin,
        'admin_set_world_radius',
        [radius, world],
        admin,
        { refreshTimestamp: false }
    );
    console.log('✅ TEST SUCCESS — admin_set_world_radius');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
