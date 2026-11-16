/**
 * Fee harness: Core.transfer_planet (owner → other user).
 * Creates a disposable planet via Admin, assigns owner, then transfers.
 *
 * Usage: pnpm exec tsx scripts/test/test-transfer-planet.ts [userIndex]
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { getTestContext } from './test-setup.ts';
import {
    getL2BlockTimestamp,
    loadPlanetFromStorage,
    loadWorld,
    measureCall,
    otherUserIndex,
    parseUserIndex,
    worldZero,
} from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);
    const Core = ctx.contracts['Core'];
    const Admin = ctx.contracts['Admin'];
    if (!Core || !Admin) throw new Error('Core/Admin not loaded');

    const user = ctx.accounts.users[userIndex]!;
    const other =
        ctx.accounts.users[
            otherUserIndex(userIndex, ctx.accounts.users.length)
        ]!;
    const admin = ctx.accounts.admin;
    const runTag = BigInt(Number(await ctx.node.getBlockNumber()) % 1_000_000);
    const location =
        ((25_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
        (255n << 64n);

    console.log('Creating disposable planet for transfer...');
    console.log(`   location=${location}`);
    await Admin.methods
        .create_planet({
            location,
            perlin: 13,
            level: 1,
            planet_type: 0,
            require_valid_location_id: false,
        })
        .send(ctx.sendOpts(admin));

    // Confirm on-chain hash exists (public view) before scanning logs.
    const PlanetStorage = ctx.contracts['PlanetStorage']!;
    let initialized = false;
    for (let i = 0; i < 20; i++) {
        initialized = Boolean(
            await PlanetStorage.methods
                .is_initialized(location)
                .simulate({ from: admin })
        );
        if (initialized) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!initialized) {
        throw new Error(
            `create_planet did not set state_roots for location=${location}`
        );
    }

    // Direct log scan matching upgrade harness (known-good path).
    const { getPublicEvents } = await import('@aztec-labs/aztec.js/events');
    const { BlockNumber } =
        await import('@aztec-labs/foundation/branded-types');
    const mod = await import('../artifacts/PlanetStorage.ts');
    let planet: Record<string, unknown> | null = null;
    for (let i = 0; i < 20; i++) {
        const latestBlock = Number(await ctx.node.getBlockNumber());
        const from = Math.max(0, latestBlock - 15);
        const raw = await getPublicEvents(
            ctx.node,
            mod.PlanetStorageContract.events.PlanetUpdate,
            {
                fromBlock: BlockNumber(from),
                toBlock: BlockNumber(latestBlock + 1),
                contractAddress: ctx.contracts['PlanetStorage']?.address,
            }
        );
        const events = raw.events.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        planet =
            events.filter((e) => BigInt(String(e.id)) === location).pop()
                ?.state ?? null;
        if (planet) break;
        if (i === 0) {
            console.log(
                `   scanned ${events.length} PlanetUpdates; sample ids:`,
                events.slice(-3).map((e) => String(e.id))
            );
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!planet) {
        throw new Error(
            `create_planet did not emit PlanetUpdate for location=${location}`
        );
    }
    await Admin.methods
        .set_owner(location, planet, user)
        .send(ctx.sendOpts(admin));
    planet = null;
    for (let i = 0; i < 12; i++) {
        planet = await loadPlanetFromStorage(ctx, location);
        if (
            planet &&
            String(planet.owner).toLowerCase() === user.toString().toLowerCase()
        )
            break;
        await new Promise((r) => setTimeout(r, 750));
    }
    if (!planet) throw new Error('set_owner missing planet');

    const world = (await loadWorld(ctx)) ?? worldZero();
    const timestamp = await getL2BlockTimestamp(ctx);

    await measureCall(
        'transfer_planet',
        ctx,
        Core,
        'transfer_planet',
        [location, timestamp, planet, other, world],
        user
    );
    console.log('✅ TEST SUCCESS — transfer_planet');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
