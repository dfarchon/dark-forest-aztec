/**
 * Fee harness: Core.buy_hat after initialize_player.
 *
 * Usage: pnpm exec tsx scripts/test/test-buy-hat.ts [userIndex]
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { getTestContext } from './test-setup.ts';
import {
    getL2BlockTimestamp,
    homeLocationId,
    loadPlanet,
    loadWorld,
    measureCall,
    parseUserIndex,
    worldZero,
} from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);
    const Core = ctx.contracts['Core'];
    if (!Core) throw new Error('Core not loaded');

    const user = ctx.accounts.users[userIndex]!;
    const locationId = homeLocationId(userIndex);
    const planet = await loadPlanet(ctx, locationId);
    const world = (await loadWorld(ctx)) ?? worldZero();
    if (!planet) {
        throw new Error('Home planet missing. Run initialize_player first.');
    }

    const timestamp = await getL2BlockTimestamp(ctx);
    await measureCall(
        'buy_hat',
        ctx,
        Core,
        'buy_hat',
        [locationId, timestamp, planet, world],
        user
    );
    console.log('✅ TEST SUCCESS — buy_hat');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
