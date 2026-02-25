/**
 * Test script for Core.withdraw_silver (private).
 *
 * Prerequisites:
 * - deploy + configure have been run.
 * - Run initialize-player first for this user:
 *   node --experimental-transform-types contracts/scripts/test-core-initialize-player.ts 0
 *
 * Usage:
 *   node --experimental-transform-types contracts/scripts/test-withdraw.ts [userIndex]
 * userIndex: 0 = user1, 1 = user2 (default 0)
 */
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { getGasLimits } from '@aztec/aztec.js/contracts';
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

const aztecZero =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

/**
 * Get the L2 block timestamp — this is exactly what context.timestamp() returns
 * in public functions during simulation.
 */
async function getL2BlockTimestamp(ctx: TestContext): Promise<bigint> {
    const block = await (
        ctx.node as unknown as {
            getBlock: (n: number | 'latest') => Promise<
                | {
                      header?: { globalVariables?: { timestamp?: unknown } };
                      timestamp?: number;
                  }
                | undefined
            >;
        }
    ).getBlock('latest');

    let ts: bigint | undefined;
    if (block?.header?.globalVariables?.timestamp != null) {
        ts = toBigint(block.header.globalVariables.timestamp);
    } else if (block?.timestamp != null) {
        ts = BigInt(Number(block.timestamp));
    }

    if (ts == null) {
        throw new Error(
            'Could not read L2 block timestamp from getBlock("latest"). Cannot proceed.'
        );
    }

    console.log(
        `   [timestamp] L2 block timestamp = ${ts} (${new Date(Number(ts) * 1000).toISOString()})`
    );
    return ts;
}

async function loadWorldFromEvents(
    ctx: TestContext
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 200);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/WorldStorage.ts');
        const W = mod.WorldStorageContract;
        if (!W?.events?.WorldUpdate) return null;
        const raw = await getPublicEvents(ctx.node, W.events.WorldUpdate, {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(from + limit),
        });
        const events = raw.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events.filter((e) => String(e?.id) === '0').pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

/** Load latest Planet state for location_id from PlanetStorage.PlanetUpdate events. */
async function loadPlanetFromEvents(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 200);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/PlanetStorage.ts');
        const P = mod.PlanetStorageContract;
        if (!P?.events?.PlanetUpdate) return null;
        const raw = await getPublicEvents(ctx.node, P.events.PlanetUpdate, {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(from + limit),
            contractAddress: ctx.contracts['PlanetStorage']?.address,
        });
        const events = raw.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events
            .filter((e) => String(e?.id) === String(locationId))
            .pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

/** Load latest Player state for playerAddress from PlayerStorage.PlayerUpdate events. */
async function loadPlayerFromEvents(
    ctx: TestContext,
    playerAddress: string
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 200);
    const limit = latestBlock - from + 1;
    const normalized = playerAddress.toLowerCase();

    try {
        const mod = await import('./artifacts/PlayerStorage.ts');
        const P = mod.PlayerStorageContract;
        if (!P?.events?.PlayerUpdate) return null;
        const raw = await getPublicEvents(ctx.node, P.events.PlayerUpdate, {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(from + limit),
            contractAddress: ctx.contracts['PlayerStorage']?.address,
        });
        const events = raw.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events
            .filter((e) => String(e?.id).toLowerCase() === normalized)
            .pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

/** Load latest PlanetEvents for location_id from PlanetEventsStorage events. */
async function loadPlanetEventsFromEvents(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 200);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/PlanetEventsStorage.ts');
        const PE = mod.PlanetEventsStorageContract;
        if (!PE?.events?.PlanetEventsUpdate) return null;
        const raw = await getPublicEvents(
            ctx.node,
            PE.events.PlanetEventsUpdate,
            {
                fromBlock: BlockNumber(from),
                toBlock: BlockNumber(from + limit),
                contractAddress: ctx.contracts['PlanetEventsStorage']?.address,
            }
        );
        const events = raw.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events
            .filter((e) => String(e?.id) === String(locationId))
            .pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

/** Load latest PlanetArtifacts for location_id from PlanetArtifactsStorage events. */
async function loadPlanetArtifactsFromEvents(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 200);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/PlanetArtifactsStorage.ts');
        const PA = mod.PlanetArtifactsStorageContract;
        if (!PA?.events?.PlanetArtifactsUpdate) return null;
        const raw = await getPublicEvents(
            ctx.node,
            PA.events.PlanetArtifactsUpdate,
            {
                fromBlock: BlockNumber(from),
                toBlock: BlockNumber(from + limit),
                contractAddress:
                    ctx.contracts['PlanetArtifactsStorage']?.address,
            }
        );
        const events = raw.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events
            .filter((e) => String(e?.id) === String(locationId))
            .pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

function planetEventsZero(): Record<string, unknown> {
    return { events: Array(20).fill({ id: 0 }), count: 0, last_updated: 0 };
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
        controller: aztecZero,
        last_updated: 0,
    };
}

function artifactLocationZero(): Record<string, unknown> {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

/** Load a specific Arrival by its event id from ArrivalStorage.ArrivalUpdate events. */
async function loadArrivalFromEvents(
    ctx: TestContext,
    arrivalId: bigint | number | string
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 200);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/ArrivalStorage.ts');
        const A = mod.ArrivalStorageContract;
        if (!A?.events?.ArrivalUpdate) return null;
        const raw = await getPublicEvents(ctx.node, A.events.ArrivalUpdate, {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(from + limit),
            contractAddress: ctx.contracts['ArrivalStorage']?.address,
        });
        const events = raw.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events
            .filter((e) => String(e?.id) === String(arrivalId))
            .pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

/** Load arrivals, artifacts, and artifact locations for a planet's active events.
 *  Returns arrays of length 20, padded with zeros for unused slots. */
async function loadArrivalsForPlanetEvents(
    ctx: TestContext,
    planetEvents: Record<string, unknown>
): Promise<{
    arrivals: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
    artifactLocations: Record<string, unknown>[];
}> {
    const count = Number(planetEvents.count ?? 0);
    const events = (planetEvents.events ?? []) as Array<{ id?: unknown }>;

    const arrivals: Record<string, unknown>[] = [];
    const artifacts: Record<string, unknown>[] = [];
    const artifactLocations: Record<string, unknown>[] = [];

    for (let i = 0; i < 20; i++) {
        if (
            i < count &&
            events[i]?.id != null &&
            String(events[i].id) !== '0'
        ) {
            const arrivalData = await loadArrivalFromEvents(
                ctx,
                String(events[i].id)
            );
            arrivals.push(arrivalData ?? arrivalZero());
            artifacts.push(artifactZero());
            artifactLocations.push(artifactLocationZero());
        } else {
            arrivals.push(arrivalZero());
            artifacts.push(artifactZero());
            artifactLocations.push(artifactLocationZero());
        }
    }

    return { arrivals, artifacts, artifactLocations };
}

function planetArtifactsZero(): Record<string, unknown> {
    return { ids: Array(20).fill(0n), count: 0, last_updated: 0 };
}

function planetZero(): Record<string, unknown> {
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

async function loadPlanetCoreInputs(
    ctx: TestContext,
    location: bigint
): Promise<{
    planet: Record<string, unknown>;
    planetEvents: Record<string, unknown>;
    arrivals: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
    artifactLocations: Record<string, unknown>[];
    planetArtifacts: Record<string, unknown>;
}> {
    const planet = (await loadPlanetFromEvents(ctx, location)) ?? planetZero();
    const planetEvents =
        (await loadPlanetEventsFromEvents(ctx, location)) ?? planetEventsZero();
    const planetArtifacts =
        (await loadPlanetArtifactsFromEvents(ctx, location)) ??
        planetArtifactsZero();
    const arrivalData = await loadArrivalsForPlanetEvents(ctx, planetEvents);
    return {
        planet,
        planetEvents,
        arrivals: arrivalData.arrivals,
        artifacts: arrivalData.artifacts,
        artifactLocations: arrivalData.artifactLocations,
        planetArtifacts,
    };
}

async function advanceChainTime(
    ctx: TestContext,
    minAdvanceSeconds: bigint
): Promise<void> {
    const start = await getL2BlockTimestamp(ctx);
    let now = start;
    while (now - start < minAdvanceSeconds) {
        await sendTimestampRefreshTx(ctx);
        now = await getL2BlockTimestamp(ctx);
    }
    console.log(
        `   [timestamp] advanced by ${now - start}s (target ${minAdvanceSeconds}s)`
    );
}

async function refreshPlanetPrivateOnce(
    ctx: TestContext,
    location: bigint,
    user: AztecAddress
): Promise<Record<string, unknown>> {
    const Core = ctx.contracts['Core'];
    if (!Core) throw new Error('Core contract not loaded');

    const state = await loadPlanetCoreInputs(ctx, location);
    await sendTimestampRefreshTx(ctx);
    const timestamp = await getL2BlockTimestamp(ctx);

    await Core.methods
        .refresh_planet_private(
            location,
            state.planet,
            state.planetEvents,
            state.arrivals,
            state.artifacts,
            state.artifactLocations,
            state.planetArtifacts,
            timestamp
        )
        .send(ctx.sendOpts(user));

    const updated = await loadPlanetFromEvents(ctx, location);
    if (!updated) {
        throw new Error('Could not reload planet state after refresh_planet');
    }
    return updated;
}

async function main() {
    const userIndex = process.argv[2] === '1' ? 1 : 0;
    const userLabel = userIndex === 0 ? 'user1' : 'user2';

    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    const Core = ctx.contracts['Core'];
    const Config = ctx.contracts['Config'];
    const Admin = ctx.contracts['Admin'];
    if (!Core || !Config || !Admin) {
        throw new Error('Core, Config, or Admin contract not loaded');
    }

    const { admin, users } = ctx.accounts;
    const user = users[userIndex];
    const sendOpts = ctx.sendOpts;

    const location = (30_000_000n << 216n) | (255n << 64n);

    console.log('✅ Core at:', Core.address.toString());
    console.log('✅ Config at:', Config.address.toString());
    console.log('✅ Admin at:', Admin.address.toString());
    console.log('✅ Player (' + userLabel + '):', user.toString());
    console.log('   location:', String(location));

    const world = await loadWorldFromEvents(ctx);
    if (world != null) {
        console.log(
            `   world radius=${toBigint(world.radius)}, paused=${Boolean(world.paused)}`
        );
    }

    console.log('\n🏪 Creating level 1 TradingPost (planet_type=3)...');
    await Admin.methods
        .create_planet({
            location,
            perlin: 13,
            level: 1,
            planet_type: 3,
            require_valid_location_id: false,
        })
        .send(sendOpts(admin));

    let planet = await loadPlanetFromEvents(ctx, location);
    if (!planet) {
        throw new Error('Could not load created trading post from events');
    }
    console.log(
        `   owner(before set_owner)=${String(planet.owner)} silver=${toBigint(planet.silver)}`
    );

    console.log('\n👤 Setting planet owner to test user...');
    await Admin.methods.set_owner(location, planet, user).send(sendOpts(admin));

    planet = await loadPlanetFromEvents(ctx, location);
    if (!planet) {
        throw new Error('Could not load trading post after set_owner');
    }
    console.log(`   owner(after set_owner)=${String(planet.owner)}`);

    console.log('\n⏱️ Advancing chain time to accumulate silver...');
    await advanceChainTime(ctx, 5n);

    console.log('🔄 Calling Core.refresh_planet_private...');
    planet = await refreshPlanetPrivateOnce(ctx, location, user);
    let silver = toBigint(planet.silver);
    console.log(`   silver(after refresh #1)=${silver}`);

    if (silver === 0n) {
        console.log(
            '   silver is still 0; advancing more time and refreshing again...'
        );
        await advanceChainTime(ctx, 20n);
        planet = await refreshPlanetPrivateOnce(ctx, location, user);
        silver = toBigint(planet.silver);
        console.log(`   silver(after refresh #2)=${silver}`);
    }

    if (silver <= 0n) {
        throw new Error(
            'Trading post silver is still 0 after refresh attempts. Cannot test withdraw_silver.'
        );
    }

    console.log('\n📥 Loading world config and player state...');
    const worldConfig = await Config.methods
        .get_world_config()
        .simulate({ from: user });
    const playerState = await loadPlayerFromEvents(ctx, user.toString());
    if (!playerState) {
        throw new Error(
            `Could not load player state for ${user.toString()}. Run test-core-initialize-player.ts ${userIndex} first.`
        );
    }
    console.log(
        `   player score(before)=${toBigint(playerState.score)} silver_score_value=${toBigint(worldConfig.silver_score_value)}`
    );

    const state = await loadPlanetCoreInputs(ctx, location);
    const silverAvailable = toBigint(state.planet.silver);
    if (silverAvailable <= 0n) {
        throw new Error('No silver available to withdraw');
    }

    const silverToWithdraw = silverAvailable;
    const estimatedScoreDelta =
        ((silverToWithdraw / 1000n) *
            toBigint(worldConfig.silver_score_value)) /
        100n;
    console.log(
        `   silver available=${silverAvailable}, silver_to_withdraw=${silverToWithdraw}, est_score_delta=${estimatedScoreDelta}`
    );

    console.log('\n🔄 Refreshing timestamp before withdraw...');
    await sendTimestampRefreshTx(ctx);
    const timestamp = await getL2BlockTimestamp(ctx);

    const withdrawArgs = [
        location,
        silverToWithdraw,
        timestamp,
        worldConfig,
        state.planet,
        state.planetEvents,
        state.arrivals,
        state.artifacts,
        state.artifactLocations,
        state.planetArtifacts,
        playerState,
    ] as const;

    console.log('\n🎮 Calling Core.withdraw_silver() (private)...');
    console.log(
        `   silver_to_withdraw=${silverToWithdraw}, timestamp=${timestamp}`
    );

    try {
        const payload = await Core.methods
            .withdraw_silver(...withdrawArgs)
            .request(sendOpts(user));
        const txSimResult = await Core.wallet.simulateTx(payload, {
            from: user,
        });
        console.log('   ✅ Simulate passed.');

        const gasUsed = txSimResult.gasUsed;
        const suggestedLimits = getGasLimits(txSimResult, 0.1);

        console.log('\n⛽ Gas used:');
        console.log(
            `   totalGas:  DA=${gasUsed.totalGas.daGas}  L2=${gasUsed.totalGas.l2Gas}`
        );
        console.log(
            `   teardown:  DA=${gasUsed.teardownGas.daGas}  L2=${gasUsed.teardownGas.l2Gas}`
        );
        console.log(
            `   publicGas: DA=${gasUsed.publicGas.daGas}  L2=${gasUsed.publicGas.l2Gas}`
        );
        console.log(
            `   billedGas: DA=${gasUsed.billedGas.daGas}  L2=${gasUsed.billedGas.l2Gas}`
        );
        console.log('\n⛽ Suggested gas limits (10% pad):');
        console.log(
            `   gasLimits:         DA=${suggestedLimits.gasLimits.daGas}  L2=${suggestedLimits.gasLimits.l2Gas}`
        );
        console.log(
            `   teardownGasLimits: DA=${suggestedLimits.teardownGasLimits.daGas}  L2=${suggestedLimits.teardownGasLimits.l2Gas}`
        );
    } catch (e: unknown) {
        console.error(
            '   ❌ Simulate failed:',
            e instanceof Error ? e.message : e
        );
        process.exit(1);
    }

    const beforeSilver = toBigint(state.planet.silver);
    const beforeScore = toBigint(playerState.score);

    const receipt = await Core.methods
        .withdraw_silver(...withdrawArgs)
        .send(sendOpts(user));

    const blockNumber =
        receipt &&
        typeof (receipt as { blockNumber?: number }).blockNumber !== 'undefined'
            ? Number((receipt as { blockNumber: number }).blockNumber)
            : undefined;
    const txHash =
        receipt && (receipt as unknown as { txHash?: unknown }).txHash != null
            ? String((receipt as unknown as { txHash: unknown }).txHash)
            : undefined;

    const updatedPlanet = await loadPlanetFromEvents(ctx, location);
    const updatedPlayer = await loadPlayerFromEvents(ctx, user.toString());
    if (!updatedPlanet || !updatedPlayer) {
        throw new Error(
            'Withdraw tx sent but could not reload updated planet/player state'
        );
    }
    const afterSilver = toBigint(updatedPlanet.silver);
    const afterScore = toBigint(updatedPlayer.score);

    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST SUCCESS — withdraw_silver committed');
    console.log('='.repeat(60));
    console.log('  Transaction:', txHash ?? '(n/a)');
    console.log('  Block number:', blockNumber ?? '(unknown)');
    console.log('  location:', String(location));
    console.log(`  planet silver: ${beforeSilver} -> ${afterSilver}`);
    console.log(`  player score: ${beforeScore} -> ${afterScore}`);
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
