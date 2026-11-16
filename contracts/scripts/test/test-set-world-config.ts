/**
 * Fee harness: Config.set_world_config (admin).
 *
 * Usage: pnpm exec tsx scripts/test/test-set-world-config.ts
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { unwrapSimulateResult } from '../utils/index.ts';
import { getTestContext } from './test-setup.ts';
import { measureCall } from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const Config = ctx.contracts['Config'];
    if (!Config) throw new Error('Config not loaded');
    const admin = ctx.accounts.admin;

    const current = unwrapSimulateResult(
        await Config.methods.get_world_config().simulate({ from: admin })
    ) as Record<string, unknown>;

    // No-op write of the same config — measures gas without changing game rules.
    await measureCall(
        'set_world_config',
        ctx,
        Config,
        'set_world_config',
        [current],
        admin,
        { refreshTimestamp: false }
    );
    console.log('✅ TEST SUCCESS — set_world_config');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
