/**
 * Test script for Core.initialize_player (private).
 *
 * gasMainRound2 API: the home planet is created on an empty slot, so the call takes
 * planet_state (must be Planet::zero()), player_state and world only. It has no
 * planet_events / planet_artifacts / arrivals / artifacts arguments.
 *
 * Prerequisites:
 * - `pnpm deploy:run` and `pnpm bootstrap` completed on the active network
 *   (networks/<AZTEC_NETWORK>.env with FEE_PAYMENT_MODE and ACCOUNT_*; see test-setup.ts).
 * - World must be "initialized" (not World::zero()). If the chain still has the default
 *   World::zero(), this script calls Admin.admin_set_world_radius(53001, worldZero) once,
 *   then runs initialize_player.
 *
 * Usage (from contracts/ directory):
 *   pnpm exec tsx scripts/test/test-core-initialize-player.ts [userIndex]
 *
 * userIndex: 0..N-1 (default 0). Use different indexes for multiple runs so each
 * account initializes once (e.g. first run no arg → user1, second run "1" → user2).
 */
import { getPublicEvents } from '@aztec-labs/aztec.js/events';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';
import { Gas } from '@aztec-labs/stdlib/gas';
import { getGasLimits } from '@aztec-labs/wallet-sdk/base-wallet';

import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { unwrapSimulateResult } from '../utils/index.ts';
import { logFeeMeasure } from './feeMeasureLog.ts';
import {
    ensureZkDisabled,
    getTestContext,
    sendTimestampRefreshTx,
    type TestContext,
} from './test-setup.ts';
import { otherUserIndex, parseUserIndex } from './testHelpers.ts';

// World shape (types/storage/world.nr)
function worldZero(): {
    paused: boolean;
    radius: bigint;
    misc_nonce: bigint;
    next_change_block: number;
} {
    return {
        paused: false,
        radius: 53_000n,
        misc_nonce: 0n,
        next_change_block: 0,
    };
}

function worldWithRadius(world: ReturnType<typeof worldZero>, radius: bigint) {
    return { ...world, radius };
}

// Player::zero() (types/storage/player.nr) — init_timestamp 0 means "not initialized"
function playerZero(): {
    init_timestamp: number | bigint;
    home_planet_id: bigint;
    last_reveal_timestamp: number | bigint;
    score: bigint;
    space_junk: bigint;
    space_junk_limit: bigint;
    claimed_ships: boolean;
    last_updated: number | bigint;
} {
    return {
        init_timestamp: 0,
        home_planet_id: 0n,
        last_reveal_timestamp: 0,
        score: 0n,
        space_junk: 0n,
        space_junk_limit: 0n,
        claimed_ships: false,
        last_updated: 0,
    };
}

// Planet::zero() (types/storage/planet.nr) — used when creating a new home planet
function planetZero(aztecZero: string): Record<string, unknown> {
    return {
        perlin: 0,
        created_at: 0,
        owner: aztecZero,
        planet_level: 0,
        planet_type: 0,
        space_type: 0,
        is_home_planet: false,
        is_initialized: false,
        destroyed: false,
        invader: aztecZero,
        capturer: aztecZero,
        invade_start_block: 0,
        population_cap: 0n,
        population_growth: 0n,
        range: 0n,
        speed: 0n,
        defense: 0n,
        silver_cap: 0n,
        silver_growth: 0n,
        population: 0n,
        silver: 0n,
        upgrade_state_0: 0,
        upgrade_state_1: 0,
        upgrade_state_2: 0,
        last_updated: 0,
        pausers: 0n,
        energy_gro_doublers: 0n,
        silver_gro_doublers: 0n,
        hat_level: 0n,
        space_junk: 0n,
        has_tried_finding_artifact: false,
        prospected_block_number: 0,
    };
}

const aztecZero =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Load latest World state for id=0 from WorldStorage.WorldUpdate events, or return null. */
async function loadWorldFromEvents(
    ctx: TestContext
): Promise<ReturnType<typeof worldZero> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = 0;
    const limit = latestBlock - from + 1;

    // Dynamic import so we don't require artifacts at parse time
    const mod = await import('../artifacts/WorldStorage.ts');
    // Use only the exported WorldStorageContract; do not fallback to mod.WorldStorage (fix TS error)
    const WorldStorageContract = mod.WorldStorageContract;
    if (!WorldStorageContract?.events?.WorldUpdate) {
        console.warn(
            '   WorldStorageContract artifact or WorldUpdate event not found; using worldZero().'
        );
        return null;
    }

    const raw = await getPublicEvents(
        ctx.node,
        WorldStorageContract.events.WorldUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(from + limit),
            contractAddress: ctx.contracts['WorldStorage']?.address,
        }
    );
    const events = raw.events.map((e) => e.event) as {
        id: unknown;
        block_number?: number;
        state?: Record<string, unknown>;
    }[];

    const forId0 = events.filter((e) => String(e?.id) === '0' && e?.state);
    if (forId0.length === 0) return null;
    const last = forId0[forId0.length - 1];
    const s = last?.state;
    if (!s) return null;

    const toBigint = (v: unknown): bigint =>
        typeof v === 'bigint'
            ? v
            : typeof v === 'number'
              ? BigInt(v)
              : BigInt(String(v ?? 0));
    return {
        paused: Boolean(s.paused),
        radius: toBigint(s.radius),
        misc_nonce: toBigint(s.misc_nonce),
        next_change_block: Number(s.next_change_block ?? 0),
    };
}

/**
 * Get the L2 block timestamp — this is exactly what context.timestamp() returns
 * in public functions during simulation.
 *
 * In this sandbox the L1 (Anvil) time is warped ahead of system clock, and
 * L2 block time follows L1 (slightly behind). context.timestamp() = L2 block
 * header.globalVariables.timestamp. Using this directly satisfies:
 *   timestamp <= actual_timestamp  AND  actual_timestamp - timestamp <= 300.
 */
async function getTimestampForContract(ctx: TestContext): Promise<bigint> {
    try {
        const block = await (
            ctx.node as unknown as {
                getBlock: (n: number | 'latest') => Promise<
                    | {
                          header?: {
                              globalVariables?: { timestamp?: unknown };
                          };
                          timestamp?: number;
                      }
                    | undefined
                >;
            }
        ).getBlock('latest');

        let ts: bigint | undefined;
        if (block?.header?.globalVariables?.timestamp != null) {
            const raw = block.header.globalVariables.timestamp;
            ts =
                typeof raw === 'bigint'
                    ? raw
                    : BigInt(String(raw).replace(/n$/, ''));
        } else if (block?.timestamp != null) {
            ts = BigInt(Number(block.timestamp));
        }

        if (ts != null) {
            console.log(
                `   [timestamp] L2 block timestamp = ${ts} (${new Date(Number(ts) * 1000).toISOString()})`
            );
            return ts;
        }
    } catch {
        /* ignore */
    }

    // Fallback (should not happen if node is running)
    const nowSec = Math.floor(Date.now() / 1000);
    console.log(`   [timestamp] Fallback system clock: ${nowSec}`);
    return BigInt(nowSec);
}

function toBig(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (
        v != null &&
        typeof (v as { toBigInt?: () => bigint }).toBigInt === 'function'
    )
        return (v as { toBigInt: () => bigint }).toBigInt();
    return BigInt(String(v ?? 0));
}

type GameConfigCoreLike = { init_perlin_min: unknown };

async function main() {
    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);

    const Core = ctx.contracts['Core'];
    const Config = ctx.contracts['Config'];
    const Admin = ctx.contracts['Admin'];
    if (!Core || !Config) {
        throw new Error('Core or Config contract not loaded');
    }

    const { admin, users } = ctx.accounts;
    const sendOpts = ctx.sendOpts;
    const user = users[userIndex]!;
    const userLabel = `user${userIndex + 1}`;

    console.log('✅ Core at:', Core.address.toString());
    console.log('✅ Config at:', Config.address.toString());
    console.log(
        '✅ Player (' + userLabel + ', index ' + userIndex + '):',
        user.toString()
    );

    const level = 0;

    console.log('\n🔒 Ensuring ZK checks are disabled for local test...');
    await ensureZkDisabled(ctx);

    console.log('\n📥 Loading config from Config contract...');
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
    );
    const planetLevelThresholds = unwrapSimulateResult(
        await Config.methods
            .get_planet_level_thresholds()
            .simulate({ from: user })
    );
    const spaceJunkConfig = unwrapSimulateResult(
        await Config.methods.get_space_junk_config().simulate({ from: user })
    );
    const planetTypeWeightsTier0 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(0)
            .simulate({ from: user })
    );
    const planetTypeWeightsTier1 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(1)
            .simulate({ from: user })
    );
    const planetTypeWeightsTier2 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(2)
            .simulate({ from: user })
    );
    const planetTypeWeightsTier3 = unwrapSimulateResult(
        await Config.methods
            .get_planet_type_weights_tier(3)
            .simulate({ from: user })
    );

    console.log('📥 Resolving World state...');
    let world = await loadWorldFromEvents(ctx);
    if (!world) {
        world = worldZero();
    }

    // Core asserts world != World::zero(). World::zero() has radius 53000. So we need a world with different radius.
    const ZERO_RADIUS = 53_000n;
    if (world.radius === ZERO_RADIUS && Admin) {
        console.log(
            '   World is default (radius 53000); calling Admin.admin_set_world_radius(53001, world)...'
        );
        await Admin.methods
            .admin_set_world_radius(53001n, world)
            .send(sendOpts(admin));
        world = worldWithRadius(world, 53001n);
        console.log('   ✅ World updated to radius 53001.');
    } else if (world.radius === ZERO_RADIUS) {
        throw new Error(
            'World is still World::zero() (radius 53000). Core.initialize_player requires world != World::zero(). ' +
                'Run Admin.admin_set_world_radius(53001, worldZero) first, or ensure Admin contract is loaded.'
        );
    }

    const playerState = playerZero();
    const planetState = planetZero(aztecZero);

    const radius = toBig(world.radius);

    // ZK checks are disabled on-chain (ensured above), so the init proof asserts
    // (coords -> hash/perlin, rim range) are skipped. Use a fixed deterministic home
    // location instead of searching for a valid spawn. Its level byte falls in the
    // level-0 range and (space_type 0 / tier-0 weights [1,0,0,0,0]) derives planet_type 0,
    // satisfying the home-planet asserts in check_player_init; perlin is passed as
    // init_perlin_min so the perlin band assert passes. This location also matches the
    // home/source location used by test-move / test-upgrade / test-withdraw.
    const locationId =
        ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
    const perlin = Number(
        (gameConfigCore as GameConfigCoreLike).init_perlin_min
    );
    const x = 0n;
    const y = 0n;
    console.log(
        '\n⚡ Using fixed home location (ZK checks disabled, no spawn search).'
    );
    console.log(`   location_id=${locationId}, perlin=${perlin}, x=0, y=0`);

    // Send a no-op tx to refresh block timestamp before the main test tx.
    console.log('\n🔄 Refreshing block timestamp...');
    await sendTimestampRefreshTx(ctx);

    // Timestamp: contract requires timestamp <= block time and block_time - timestamp <= 300.
    // Use chain block time when available so we stay within the 5-minute window.
    const timestamp = await getTimestampForContract(ctx);

    console.log('\n🎮 Calling Core.initialize_player() (private)...');
    console.log(
        '   x =',
        String(x),
        ', y =',
        String(y),
        ', location_id =',
        String(locationId),
        ', perlin =',
        perlin,
        ', level =',
        level,
        ', radius =',
        String(radius),
        ', timestamp =',
        String(timestamp)
    );

    const initPlayerArgs = [
        x,
        y,
        radius,
        locationId,
        perlin,
        level,
        timestamp,
        snarkConfig,
        planetDefaultStats,
        worldConfig,
        gameConfigCore,
        planetLevelThresholds,
        spaceJunkConfig,
        planetTypeWeightsTier0,
        planetTypeWeightsTier1,
        planetTypeWeightsTier2,
        planetTypeWeightsTier3,
        planetState,
        playerState,
        world,
    ] as const;

    console.log('   Simulating...');
    let initGasUsed:
        | Awaited<ReturnType<typeof Core.wallet.simulateTx>>['gasUsed']
        | null = null;
    try {
        const initPayload = await Core.methods
            .initialize_player(...initPlayerArgs)
            .request(sendOpts(user));
        const txSimResult = await Core.wallet.simulateTx(initPayload, {
            from: user,
        });
        initGasUsed = txSimResult.gasUsed;
        const { txsLimits } = await ctx.node.getNodeInfo();
        const suggestedLimits = getGasLimits(
            initGasUsed,
            Gas.from(txsLimits.gas),
            0.1
        );
        console.log('   ✅ Simulate passed.');
        console.log('\n⛽ Gas used:');
        console.log(
            `   totalGas:  DA=${initGasUsed.totalGas.daGas}  L2=${initGasUsed.totalGas.l2Gas}`
        );
        console.log(
            `   teardown:  DA=${initGasUsed.teardownGas.daGas}  L2=${initGasUsed.teardownGas.l2Gas}`
        );
        console.log(
            `   publicGas: DA=${initGasUsed.publicGas.daGas}  L2=${initGasUsed.publicGas.l2Gas}`
        );
        console.log(
            `   billedGas: DA=${initGasUsed.billedGas.daGas}  L2=${initGasUsed.billedGas.l2Gas}`
        );
        console.log('\n⛽ Suggested gas limits (10% pad):');
        console.log(
            `   gasLimits:         DA=${suggestedLimits.gasLimits.daGas}  L2=${suggestedLimits.gasLimits.l2Gas}`
        );
        console.log(
            `   teardownGasLimits: DA=${suggestedLimits.teardownGasLimits.daGas}  L2=${suggestedLimits.teardownGasLimits.l2Gas}`
        );
    } catch (simErr: unknown) {
        const msg = simErr instanceof Error ? simErr.message : String(simErr);
        console.error('   ❌ Simulate failed:', msg);
        if (simErr instanceof Error && simErr.stack)
            console.error(simErr.stack);
        process.exit(1);
    }

    console.log('   Sending transaction...');
    try {
        const { receipt } = await Core.methods
            .initialize_player(...initPlayerArgs)
            .send(sendOpts(user));
        logFeeMeasure('initialize_player', initGasUsed, receipt);
        const blockNumber =
            receipt &&
            typeof (receipt as { blockNumber?: number }).blockNumber !==
                'undefined'
                ? Number((receipt as { blockNumber: number }).blockNumber)
                : undefined;
        const txHash =
            receipt &&
            (receipt as unknown as { txHash?: unknown }).txHash != null
                ? String((receipt as unknown as { txHash: unknown }).txHash)
                : undefined;

        console.log('\n' + '='.repeat(60));
        console.log('✅ TEST SUCCESS — initialize_player committed');
        console.log('='.repeat(60));
        console.log('  Transaction:', txHash ?? '(tx hash not in receipt)');
        console.log('  Block number:', blockNumber ?? '(unknown)');
        console.log('  Player (' + userLabel + '):', user.toString());
        console.log('  Home planet location_id:', String(locationId));
        const otherIndex = otherUserIndex(userIndex, ctx.accounts.users.length);
        const otherLabel = `user${otherIndex + 1}`;
        console.log(
            '\n  Next run (' +
                otherLabel +
                '): pnpm exec tsx scripts/test/test-core-initialize-player.ts',
            otherIndex
        );
        console.log('\n' + '='.repeat(60));
    } catch (err) {
        console.error('Error calling Core.initialize_player():', err);
        throw err;
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
