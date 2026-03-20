/**
 * Test script for Core.initialize_player (private).
 *
 * Prerequisites:
 * - deploy + configure have been run (Config, Admin, Core, WorldStorage, PlayerStorage set up).
 * - .env contains contract addresses and ACCOUNT_* (see test-setup.ts / deploy).
 * - World must be "initialized" (not World::zero()). If the chain still has the default
 *   World::zero(), this script calls Admin.admin_set_world_radius(53001, worldZero) once,
 *   then runs initialize_player.
 *
 * Usage (from contracts/ directory):
 *   node --experimental-transform-types scripts/test-core-initialize-player.ts [userIndex]
 *
 * userIndex: 0 = user1, 1 = user2 (default 0). Use different indexes for multiple runs so each
 * account initializes once (e.g. first run no arg → user1, second run "1" → user2).
 *
 * Or with tsx: pnpm exec tsx scripts/test-core-initialize-player.ts [userIndex]
 */
import { getPublicEvents } from '@aztec/aztec.js/events';
import { BlockNumber } from '@aztec/foundation/branded-types';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    getTestContext,
    sendTimestampRefreshTx,
    type TestContext,
} from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

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

function planetEventsZero(): Record<string, unknown> {
    return { events: Array(20).fill({ id: 0 }), count: 0, last_updated: 0 };
}

function planetArtifactsZero(): Record<string, unknown> {
    return { ids: Array(20).fill(0n), count: 0, last_updated: 0 };
}

function arrivalZero(): Record<string, unknown> {
    return {
        id: 0,
        player: aztecZero,
        from_planet: 0n,
        to_planet: 0n,
        pop_arriving: 0n,
        silver_moved: 0n,
        departure_time: 0,
        arrival_time: 0,
        arrival_type: 0,
        carried_artifact_id: 0n,
        distance: 0n,
    };
}

function artifactZero(): Record<string, unknown> {
    return {
        planet_discovered_on: 0n,
        rarity: 0,
        planet_biome: 0,
        minted_at_timestamp: 0,
        discoverer: aztecZero,
        artifact_type: 0,
        activations: 0n,
        last_activated: 0,
        last_deactivated: 0,
        wormhole_to: 0n,
        owner: aztecZero,
        controller: aztecZero,
        last_updated: 0,
    };
}

function artifactLocationZero(): Record<string, unknown> {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

/** Load latest World state for id=0 from WorldStorage.WorldUpdate events, or return null. */
async function loadWorldFromEvents(
    ctx: TestContext
): Promise<ReturnType<typeof worldZero> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = 0;
    const limit = latestBlock - from + 1;

    // Dynamic import so we don't require artifacts at parse time
    const mod = await import('./artifacts/WorldStorage.ts');
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

async function main() {
    const userIndex = (() => {
        const arg = process.argv[2];
        if (arg === undefined) return 0;
        const n = parseInt(arg, 10);
        if (n === 0 || n === 1) return n;
        return 0;
    })();

    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    const Core = ctx.contracts['Core'];
    const Config = ctx.contracts['Config'];
    const Admin = ctx.contracts['Admin'];
    if (!Core || !Config) {
        throw new Error('Core or Config contract not loaded');
    }

    const { admin, users } = ctx.accounts;
    const sendOpts = ctx.sendOpts;
    const user = users[userIndex];
    const userLabel = userIndex === 0 ? 'user1' : 'user2';

    console.log('✅ Core at:', Core.address.toString());
    console.log('✅ Config at:', Config.address.toString());
    console.log(
        '✅ Player (' + userLabel + ', index ' + userIndex + '):',
        user.toString()
    );

    const level = 0;
    const radius = 0n;

    // location_id for level 0: bytes 4–6 (BE) in [thresholds[1], thresholds[0]) = [4_194_292, 16_777_216).
    // Use a different location_id per user so each test account has its own home planet.
    const locationId =
        ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
    const perlin = 13;

    console.log('\n📥 Loading config from Config contract...');
    const snarkConfig = await Config.methods
        .get_snark_config()
        .simulate({ from: user });
    const planetDefaultStats = await Config.methods
        .get_planet_default_stats(level)
        .simulate({ from: user });
    const worldConfig = await Config.methods
        .get_world_config()
        .simulate({ from: user });
    const gameConfigCore = await Config.methods
        .get_game_config_core()
        .simulate({ from: user });
    const planetLevelThresholds = await Config.methods
        .get_planet_level_thresholds()
        .simulate({ from: user });
    const spaceJunkConfig = await Config.methods
        .get_space_junk_config()
        .simulate({ from: user });
    const planetTypeWeightsTier0 = await Config.methods
        .get_planet_type_weights_tier(0)
        .simulate({ from: user });
    const planetTypeWeightsTier1 = await Config.methods
        .get_planet_type_weights_tier(1)
        .simulate({ from: user });
    const planetTypeWeightsTier2 = await Config.methods
        .get_planet_type_weights_tier(2)
        .simulate({ from: user });
    const planetTypeWeightsTier3 = await Config.methods
        .get_planet_type_weights_tier(3)
        .simulate({ from: user });

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

    // Send a no-op tx to refresh block timestamp before the main test tx.
    console.log('\n🔄 Refreshing block timestamp...');
    await sendTimestampRefreshTx(ctx);

    // Timestamp: contract requires timestamp <= block time and block_time - timestamp <= 300.
    // Use chain block time when available so we stay within the 5-minute window.
    const timestamp = await getTimestampForContract(ctx);

    const x = 0n;
    const y = 0n;

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
        planetEventsZero(),
        planetArtifactsZero(),
        Array.from({ length: 20 }, () => arrivalZero()),
        Array.from({ length: 20 }, () => artifactZero()),
        Array.from({ length: 20 }, () => artifactLocationZero()),
        playerState,
        world,
    ] as const;

    console.log('   Simulating...');
    try {
        await Core.methods
            .initialize_player(...initPlayerArgs)
            .simulate(sendOpts(user));
        console.log('   ✅ Simulate passed.');
    } catch (simErr: unknown) {
        const msg = simErr instanceof Error ? simErr.message : String(simErr);
        console.error('   ❌ Simulate failed:', msg);
        if (simErr instanceof Error && simErr.stack)
            console.error(simErr.stack);
        process.exit(1);
    }

    console.log('   Sending transaction...');
    try {
        const receipt = await Core.methods
            .initialize_player(...initPlayerArgs)
            .send(sendOpts(user));
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
        if (blockNumber !== undefined) {
            console.log('\n  To inspect on-chain state changes, run:');
            console.log(
                '    node --experimental-transform-types scripts/read-initialize-player-state.ts',
                blockNumber,
                user.toString(),
                String(locationId)
            );
        }
        const otherIndex = 1 - userIndex;
        const otherLabel = otherIndex === 0 ? 'user1' : 'user2';
        console.log(
            '\n  Next run (' +
                otherLabel +
                '): node --experimental-transform-types scripts/test-core-initialize-player.ts',
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
        console.error(err);
        process.exit(1);
    });
