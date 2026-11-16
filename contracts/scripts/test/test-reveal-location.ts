/**
 * Fee harness: Core.reveal_location for an owned home planet (ZK disabled).
 *
 * Usage: pnpm exec tsx scripts/test/test-reveal-location.ts [userIndex]
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { unwrapSimulateResult } from '../utils/index.ts';
import { ensureZkDisabled, getTestContext } from './test-setup.ts';
import {
    AZTEC_ZERO,
    getL2BlockTimestamp,
    homeLocationId,
    loadPlanet,
    loadPlayer,
    loadWorld,
    measureCall,
    parseUserIndex,
    worldZero,
} from './testHelpers.ts';

function revealedCoordsZero() {
    return {
        location_id: 0n,
        x: 0n,
        y: 0n,
        revealer: AZTEC_ZERO,
        last_updated: 0,
    };
}

async function main() {
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);
    const Core = ctx.contracts['Core'];
    const Config = ctx.contracts['Config'];
    if (!Core || !Config) throw new Error('Core/Config not loaded');

    await ensureZkDisabled(ctx);

    const user = ctx.accounts.users[userIndex]!;
    const locationId = homeLocationId(userIndex);
    // Matches test-core-initialize-player fixed home coords when ZK is off.
    const x = 0n;
    const y = 0n;
    const level = 0;

    const planet = await loadPlanet(ctx, locationId);
    const player = await loadPlayer(ctx, user.toString());
    const world = (await loadWorld(ctx)) ?? worldZero();
    if (!planet || !player) {
        throw new Error(
            'Home planet/player missing. Run initialize_player first.'
        );
    }

    const snarkConfig = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: user })
    );
    const planetDefaultStats = unwrapSimulateResult(
        await Config.methods
            .get_planet_default_stats(level)
            .simulate({ from: user })
    );
    const worldConfig = unwrapSimulateResult(
        await Config.methods.get_world_config().simulate({ from: user })
    );
    const gameConfigCore = unwrapSimulateResult(
        await Config.methods.get_game_config_core().simulate({ from: user })
    ) as Record<string, unknown>;
    const perlin = Number(gameConfigCore.init_perlin_min ?? 13);
    const planetLevelThresholds = unwrapSimulateResult(
        await Config.methods
            .get_planet_level_thresholds()
            .simulate({ from: user })
    );
    const spaceJunkConfig = unwrapSimulateResult(
        await Config.methods.get_space_junk_config().simulate({ from: user })
    );
    const tier0 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(0)
            .simulate({ from: user })
    );
    const tier1 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(1)
            .simulate({ from: user })
    );
    const tier2 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(2)
            .simulate({ from: user })
    );
    const tier3 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(3)
            .simulate({ from: user })
    );

    const timestamp = await getL2BlockTimestamp(ctx);
    const args = [
        locationId,
        perlin,
        level,
        x,
        y,
        timestamp,
        false, // owner reveal (is_admin=true requires sender == Core admin)
        snarkConfig,
        planetDefaultStats,
        worldConfig,
        gameConfigCore,
        planetLevelThresholds,
        spaceJunkConfig,
        tier0,
        tier1,
        tier2,
        tier3,
        planet,
        revealedCoordsZero(),
        player,
        world,
    ] as const;

    await measureCall(
        'reveal_location',
        ctx,
        Core,
        'reveal_location',
        args,
        user
    );
    console.log('✅ TEST SUCCESS — reveal_location');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
