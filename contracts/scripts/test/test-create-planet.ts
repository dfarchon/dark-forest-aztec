/**
 * Fee harness: Admin.create_planet.
 *
 * Usage: pnpm exec tsx scripts/test/test-create-planet.ts
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { getTestContext } from './test-setup.ts';
import { measureCall } from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const Admin = ctx.contracts['Admin'];
    if (!Admin) throw new Error('Admin not loaded');
    const admin = ctx.accounts.admin;
    const location =
        ((30_000_000n + BigInt(Date.now() % 1_000_000)) << 200n) | (2n << 64n);

    await measureCall(
        'create_planet',
        ctx,
        Admin,
        'create_planet',
        [
            {
                location,
                perlin: 13,
                level: 1,
                planet_type: 0,
                require_valid_location_id: false,
            },
        ],
        admin,
        { refreshTimestamp: false }
    );
    console.log('✅ TEST SUCCESS — create_planet');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
