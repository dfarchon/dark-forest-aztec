/**
 * Test script for Move.move (private).
 *
 * Prerequisites:
 * - deploy + configure (including Move: set MOVE_CONTRACT_ADDRESS and wire storage in configure).
 * - At least one player initialized (run test-core-initialize-player.ts so a player has a home planet).
 * - World already initialized (e.g. after one initialize_player).
 *
 * Move: from source planet (player's home) to target (uninitialized = settle, or admin-created = attack).
 * This script uses an uninitialized target so no admin step is required.
 *
 * Usage:
 *   node --experimental-transform-types scripts/test-move.ts [userIndex]
 * userIndex: 0 = user1, 1 = user2 (default 0). Player must already be initialized.
 */
import { getGasLimits } from '@aztec/aztec.js/contracts';
import { getPublicEvents } from '@aztec/aztec.js/events';
import { BlockNumber } from '@aztec/foundation/branded-types';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { unwrapSimulateResult } from '../../client/src/utils/unwrapSimulateResult.ts';
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
 *
 * In this Aztec sandbox the L1 (Anvil) time is warped ahead of system clock,
 * and L2 block time follows L1 (slightly behind it). So:
 *   system_clock << L2_block_time < L1_block_time
 * context.timestamp() = L2 block header.globalVariables.timestamp.
 *
 * We must satisfy:
 *   timestamp >= source_planet.last_updated   (private)
 *   timestamp <= actual_timestamp (= L2 time) (public)
 *   actual_timestamp - timestamp <= 300       (public)
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
            contractAddress: ctx.contracts['WorldStorage']?.address,
        });
        const events = raw.events.map((e) => e.event) as {
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
        const events = raw.events.map((e) => e.event) as {
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
        const events = raw.events.map((e) => e.event) as {
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
        const events = raw.events.map((e) => e.event) as {
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
        owner: aztecZero,
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
        const events = raw.events.map((e) => e.event) as {
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
            // TODO: if arrival has carried_artifact_id != 0, load actual artifact & artifact location
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

async function main() {
    const userIndex = process.argv[2] === '1' ? 1 : 0;
    const userLabel = userIndex === 0 ? 'user1' : 'user2';

    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    const Move = ctx.contracts['Move'];
    const Config = ctx.contracts['Config'];
    if (!Move || !Config) {
        throw new Error(
            'Move or Config not loaded. Set MOVE_CONTRACT_ADDRESS in .env and run configure for Move.'
        );
    }

    const { users } = ctx.accounts;
    const user = users[userIndex];
    const sendOpts = ctx.sendOpts;

    const sourceLoc =
        ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
    const targetLoc = (10_000_002n << 216n) | (255n << 64n);

    console.log('✅ Move at:', Move.address.toString());
    console.log('✅ Player (' + userLabel + '):', user.toString());
    console.log('   source_loc (home):', String(sourceLoc));
    console.log('   target_loc (uninitialized):', String(targetLoc));

    const world = await loadWorldFromEvents(ctx);
    if (!world)
        throw new Error(
            'Could not load World from events. Run test-core-initialize-player first.'
        );

    console.log('\n📥 Loading config...');
    const snarkConfig = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: user })
    );
    const planetDefaultStats = unwrapSimulateResult(
        await Config.methods
            .get_planet_default_stats(0)
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
    const artifactsConfig = unwrapSimulateResult(
        await Config.methods.get_artifacts_config().simulate({ from: user })
    );

    const sourcePlanet = await loadPlanetFromEvents(ctx, sourceLoc);
    if (!sourcePlanet)
        throw new Error(
            'Could not load source planet from events. Run test-core-initialize-player first so the player has a home planet.'
        );

    const population = toBigint(sourcePlanet.population);
    const populationCap = toBigint(sourcePlanet.population_cap);
    const range = toBigint(sourcePlanet.range);
    const speed = toBigint(sourcePlanet.speed);
    const defense = toBigint(sourcePlanet.defense);
    const owner = String(sourcePlanet.owner ?? '');
    const destroyed = Boolean(sourcePlanet.destroyed);

    console.log('\n📊 Source planet state:');
    console.log(
        `   population=${population}, cap=${populationCap}, range=${range}, speed=${speed}, defense=${defense}`
    );
    console.log(`   owner=${owner}`);
    console.log(
        `   destroyed=${destroyed}, last_updated=${toBigint(sourcePlanet.last_updated)}`
    );
    console.log(`   sender (user)=${user.toString()}`);

    // Check #10: owner == sender
    if (
        owner !==
            '0x0000000000000000000000000000000000000000000000000000000000000000' &&
        owner.toLowerCase() !== user.toString().toLowerCase()
    ) {
        console.error(
            `   ⚠️  WARNING: source planet owner (${owner}) != sender (${user.toString()}). "Only owner" assert will fail!`
        );
    }
    // Check #9: not destroyed
    if (destroyed) {
        throw new Error(
            'Source planet is destroyed. Cannot move from a destroyed planet.'
        );
    }

    const maxDist = 50n; // distance between source and target planets (see x1,y1,x2,y2 below)

    // Piecewise linear decay estimation (matches contract move/src/main.nr)
    function estimatePopArriving(popMoved: bigint): bigint {
        const percent =
            populationCap > 0n ? (popMoved * 100n) / populationCap : 0n;
        const dMaxPercent =
            percent <= 25n
                ? percent * 2n
                : percent <= 50n
                  ? 25n + percent
                  : (100n + percent) / 2n;
        // d_factor = range * 432 * dMaxPercent, dist_scaled = dist * 100 * 100
        const dFactor = range * 432n * dMaxPercent;
        const distScaled = maxDist * 100n * 100n;
        if (dFactor === 0n || distScaled >= dFactor) return 0n;
        return (popMoved * (dFactor - distScaled)) / dFactor;
    }

    console.log('\n📊 Move parameters:');
    console.log(`   maxDist=${maxDist}, range=${range}`);

    // Find minimum popMoved that yields pop_arriving > 0 (binary search)
    let minPopForArrival = 1n;
    {
        let lo = 1n;
        let hi = populationCap;
        while (lo < hi) {
            const mid = (lo + hi) / 2n;
            if (estimatePopArriving(mid) > 0n) hi = mid;
            else lo = mid + 1n;
        }
        minPopForArrival = lo;
    }
    console.log(`   minPopForArrival=${minPopForArrival}`);

    const popMoved =
        population > minPopForArrival
            ? population > minPopForArrival + 10000n
                ? minPopForArrival + 10000n
                : population - 1n
            : population > 1n
              ? population - 1n
              : 0n;
    if (popMoved === 0n)
        throw new Error(
            'Source planet has no population to move. Run initialize_player first.'
        );
    if (population < minPopForArrival)
        throw new Error(
            `Source planet population ${population} is below minimum for arrival (need > ${minPopForArrival}). Wait for population growth or use a planet with smaller cap.`
        );

    // Estimate pop_arriving for diagnostic
    const estPopArriving = estimatePopArriving(popMoved);
    console.log(`   popMoved=${popMoved}, estPopArriving=${estPopArriving}`);
    if (estPopArriving === 0n) {
        console.error(
            '   ⚠️  pop_arriving will be 0! "Not enough forces to make move" will fail.'
        );
    }
    // Check #8: population > pop_moved (strict)
    console.log(
        `   population(${population}) > popMoved(${popMoved}) ? ${population > popMoved ? '✓' : '✗ WILL FAIL'}`
    );

    // Load source planet events & artifacts from on-chain events (must match stored hashes).
    const sourcePlanetEvents =
        (await loadPlanetEventsFromEvents(ctx, sourceLoc)) ??
        planetEventsZero();
    const sourcePlanetArtifacts =
        (await loadPlanetArtifactsFromEvents(ctx, sourceLoc)) ??
        planetArtifactsZero();
    console.log(
        `   sourcePlanetEvents.count=${sourcePlanetEvents.count}, last_updated=${sourcePlanetEvents.last_updated}`
    );
    console.log(
        `   sourcePlanetArtifacts.count=${sourcePlanetArtifacts.count}, last_updated=${sourcePlanetArtifacts.last_updated}`
    );

    // Load actual arrivals, artifacts, artifact locations from on-chain events
    // (previously hardcoded to zeros — that fails on second move when arrivals exist).
    console.log('   Loading source arrivals from on-chain events...');
    const sourceArrivalData = await loadArrivalsForPlanetEvents(
        ctx,
        sourcePlanetEvents
    );
    const sourceArrivals = sourceArrivalData.arrivals;
    const sourceArtifacts = sourceArrivalData.artifacts;
    const sourceArtifactLocations = sourceArrivalData.artifactLocations;

    // Target planet is uninitialized — load from events in case it was written before, else use zeros.
    const targetPlanet =
        (await loadPlanetFromEvents(ctx, targetLoc)) ?? planetZero();
    const targetPlanetEvents =
        (await loadPlanetEventsFromEvents(ctx, targetLoc)) ??
        planetEventsZero();
    const targetPlanetArtifacts =
        (await loadPlanetArtifactsFromEvents(ctx, targetLoc)) ??
        planetArtifactsZero();
    console.log('   Loading target arrivals from on-chain events...');
    const targetArrivalData = await loadArrivalsForPlanetEvents(
        ctx,
        targetPlanetEvents
    );
    const targetArrivals = targetArrivalData.arrivals;
    const targetArtifacts = targetArrivalData.artifacts;
    const targetArtifactLocations = targetArrivalData.artifactLocations;
    const movedArtifact = artifactZero();
    const sourceActivatedArtifact = artifactZero();
    const targetActivatedArtifact = artifactZero();

    const targetPerlin = 13;
    const targetLevel = 0;
    // Coordinates: (x1,y1) source, (x2,y2) target. max_dist must be the actual distance (used for decay & travel time).
    const x1 = 0n;
    const y1 = 0n;
    const x2 = maxDist;
    const y2 = 0n;
    const silverMoved = 0n;
    const movedArtifactId = 0n;
    const sourceActivatedArtifactId = 0n;
    const targetActivatedArtifactId = 0n;
    const isAbandoning = false;

    // Send a no-op tx to refresh block timestamp before the main test tx.
    console.log('\n🔄 Refreshing block timestamp...');
    await sendTimestampRefreshTx(ctx);

    const timestamp = await getL2BlockTimestamp(ctx);

    const moveArgs = [
        sourceLoc,
        targetLoc,
        targetPerlin,
        targetLevel,
        maxDist,
        x1,
        y1,
        x2,
        y2,
        popMoved,
        silverMoved,
        movedArtifactId,
        sourceActivatedArtifactId,
        targetActivatedArtifactId,
        isAbandoning,
        timestamp,
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
        artifactsConfig,
        sourcePlanet,
        sourcePlanetArtifacts,
        sourcePlanetEvents,
        sourceArrivals,
        sourceArtifacts,
        sourceArtifactLocations,
        targetPlanet,
        targetPlanetArtifacts,
        targetPlanetEvents,
        targetArrivals,
        targetArtifacts,
        targetArtifactLocations,
        world,
        movedArtifact,
        sourceActivatedArtifact,
        targetActivatedArtifact,
    ] as const;

    console.log('\n🎮 Calling Move.move() (private)...');
    console.log('   pop_moved:', String(popMoved), 'silver_moved: 0');

    try {
        const movePayload = await Move.methods
            .move(...moveArgs)
            .request(sendOpts(user));
        const txSimResult = await Move.wallet.simulateTx(movePayload, {
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

    try {
        const receipt = await Move.methods
            .move(...moveArgs)
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
        console.log('✅ TEST SUCCESS — move committed');
        console.log('='.repeat(60));
        console.log('  Transaction:', txHash ?? '(n/a)');
        console.log('  Block number:', blockNumber ?? '(unknown)');
        console.log('  From (source_loc):', String(sourceLoc));
        console.log('  To (target_loc):', String(targetLoc));
        if (blockNumber !== undefined) {
            console.log('\n  To inspect state changes, run:');
            console.log(
                '    node --experimental-transform-types scripts/read-move-state.ts',
                blockNumber,
                String(sourceLoc),
                String(targetLoc)
            );
        }
        console.log('\n' + '='.repeat(60));
    } catch (err) {
        console.error('Error calling Move.move():', err);
        throw err;
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
