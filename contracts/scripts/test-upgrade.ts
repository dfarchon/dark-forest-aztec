/**
 * Test script for Core.upgrade_planet (private).
 *
 * Prerequisites:
 * - deploy + configure have been run.
 * - Core/Admin/Config addresses are set in contracts/.env.
 *
 * Usage:
 *   node --experimental-transform-types contracts/scripts/test-upgrade.ts [userIndex]
 * userIndex: 0 = user1, 1 = user2 (default 0)
 */
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
 *
 * We must satisfy:
 *   timestamp >= planet.last_updated   (private)
 *   timestamp <= actual_timestamp      (public)
 *   actual_timestamp - timestamp <= 300 (public)
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
    const from = 0;
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
    const from = 0;
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

function playerZero(): Record<string, unknown> {
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

async function main() {
    const userIndex = process.argv[2] === '1' ? 1 : 0;
    const userLabel = userIndex === 0 ? 'user1' : 'user2';

    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    const Core = ctx.contracts['Core'];
    const Move = ctx.contracts['Move'];
    const Config = ctx.contracts['Config'];
    const Admin = ctx.contracts['Admin'];
    if (!Core || !Move || !Config || !Admin) {
        throw new Error('Core, Move, Config, or Admin contract not loaded');
    }

    const { admin, users } = ctx.accounts;
    const user = users[userIndex];
    const sendOpts = ctx.sendOpts;
    const runTag = BigInt(Number(await ctx.node.getBlockNumber()) % 1_000_000);

    const silverMineLocation =
        ((40_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
        (255n << 64n);
    const location =
        ((20_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
        (255n << 64n);
    const branch = 0; // Defense

    console.log('✅ Core at:', Core.address.toString());
    console.log('✅ Move at:', Move.address.toString());
    console.log('✅ Config at:', Config.address.toString());
    console.log('✅ Admin at:', Admin.address.toString());
    console.log('✅ Player (' + userLabel + '):', user.toString());
    console.log('   silver_mine_location:', String(silverMineLocation));
    console.log('   location:', String(location));

    let world = (await loadWorldFromEvents(ctx)) ?? {
        paused: false,
        planet_events_count: 0n,
        radius: 53_000n,
        misc_nonce: 0n,
        planet_ids_count: 0n,
        revealed_planet_ids_count: 0n,
        player_ids_count: 0n,
        next_change_block: 0,
    };
    const worldRadiusBeforeInit = toBigint(world.radius);
    if (worldRadiusBeforeInit === 53_000n) {
        console.log(
            '   world is default radius 53000; calling Admin.admin_set_world_radius(53001)...'
        );
        await Admin.methods
            .admin_set_world_radius(53_001n, world)
            .send(sendOpts(admin));
        world = { ...world, radius: 53_001n };
    }
    const worldRadius = toBigint(world.radius);
    console.log(
        `   world radius=${worldRadius}, paused=${Boolean(world.paused)}`
    );

    console.log('\n📥 Loading move configs...');
    const snarkConfig = await Config.methods
        .get_snark_config()
        .simulate({ from: user });
    const planetDefaultStats = await Config.methods
        .get_planet_default_stats(1)
        .simulate({ from: user });
    const planetDefaultStatsLevel0 = await Config.methods
        .get_planet_default_stats(0)
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
    const tier0 = await Config.methods
        .get_planet_type_weights_tier(0)
        .simulate({ from: user });
    const tier1 = await Config.methods
        .get_planet_type_weights_tier(1)
        .simulate({ from: user });
    const tier2 = await Config.methods
        .get_planet_type_weights_tier(2)
        .simulate({ from: user });
    const tier3 = await Config.methods
        .get_planet_type_weights_tier(3)
        .simulate({ from: user });

    let playerState = await loadPlayerFromEvents(ctx, user.toString());
    if (!playerState || toBigint(playerState.init_timestamp) === 0n) {
        console.log('\n🧭 Initializing player state for this user...');
        const level = 0;
        const radius = 0n;
        const locationId =
            ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
        const perlin = 13;
        const x = 0n;
        const y = 0n;
        const initPlanetState = planetZero();
        const initPlayerState = playerZero();

        await sendTimestampRefreshTx(ctx);
        const initTimestamp = await getL2BlockTimestamp(ctx);

        // Use snark config with ZK checks disabled so init_proof is skipped (radius=0, x=0, y=0
        // would otherwise fail the annulus constraint dist_sq < r_sq in the init circuit).
        const initSnarkConfig = {
            ...snarkConfig,
            disable_zk_checks: true,
        };

        const initArgs = [
            x,
            y,
            radius,
            locationId,
            perlin,
            level,
            initTimestamp,
            initSnarkConfig,
            planetDefaultStatsLevel0,
            worldConfig,
            gameConfigCore,
            planetLevelThresholds,
            spaceJunkConfig,
            tier0,
            tier1,
            tier2,
            tier3,
            initPlanetState,
            initPlayerState,
            world,
        ] as const;

        try {
            await Core.methods
                .initialize_player(...initArgs)
                .simulate(sendOpts(user));
            await Core.methods
                .initialize_player(...initArgs)
                .send(sendOpts(user));
            playerState = await loadPlayerFromEvents(ctx, user.toString());
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (
                msg.includes('already initialized') ||
                msg.includes('init_timestamp')
            ) {
                playerState = await loadPlayerFromEvents(ctx, user.toString());
            } else {
                throw e;
            }
        }
    }
    if (!playerState || toBigint(playerState.init_timestamp) === 0n) {
        throw new Error(
            `Player state for ${user.toString()} is still uninitialized after auto-initialize`
        );
    }
    console.log(
        `   player init_timestamp=${toBigint(playerState.init_timestamp)}`
    );

    console.log('\n⛏️ Creating level 1 SilverMine (planet_type=1)...');
    await Admin.methods
        .create_planet({
            location: silverMineLocation,
            perlin: 13,
            level: 1,
            planet_type: 1,
            require_valid_location_id: false,
        })
        .send(sendOpts(admin));

    let silverMine = await loadPlanetFromEvents(ctx, silverMineLocation);
    if (!silverMine) {
        throw new Error('Could not load created SilverMine from events');
    }
    console.log(
        `   owner(before set_owner)=${String(silverMine.owner)} silver=${toBigint(silverMine.silver)}`
    );

    console.log('\n👤 Setting SilverMine owner to test user...');
    await Admin.methods
        .set_owner(silverMineLocation, silverMine, user)
        .send(sendOpts(admin));

    silverMine = await loadPlanetFromEvents(ctx, silverMineLocation);
    if (!silverMine) {
        throw new Error('Could not load SilverMine after set_owner');
    }
    console.log(`   owner(after set_owner)=${String(silverMine.owner)}`);

    console.log('\n🪐 Creating level 1 regular planet (planet_type=0)...');
    await Admin.methods
        .create_planet({
            location,
            perlin: 13,
            level: 1,
            planet_type: 0,
            require_valid_location_id: false,
        })
        .send(sendOpts(admin));

    let planet = await loadPlanetFromEvents(ctx, location);
    if (!planet) {
        throw new Error('Could not load created target planet from events');
    }
    console.log(
        `   owner(before set_owner)=${String(planet.owner)} silver=${toBigint(planet.silver)}`
    );

    console.log('\n👤 Setting target planet owner to test user...');
    await Admin.methods.set_owner(location, planet, user).send(sendOpts(admin));

    planet = await loadPlanetFromEvents(ctx, location);
    if (!planet) {
        throw new Error('Could not load target planet after set_owner');
    }
    console.log(`   owner(after set_owner)=${String(planet.owner)}`);

    console.log('\n⏱️ Advancing chain time so SilverMine can grow...');
    await advanceChainTime(ctx, 30n);

    console.log('📥 Loading current SilverMine + target states...');

    console.log('\n🚚 Moving silver from SilverMine -> target planet...');
    const sourceState = await loadPlanetCoreInputs(ctx, silverMineLocation);
    const targetState = await loadPlanetCoreInputs(ctx, location);
    const worldForMove = (await loadWorldFromEvents(ctx)) ?? world;

    const population = toBigint(sourceState.planet.population);
    const populationGrowth = toBigint(sourceState.planet.population_growth);
    const populationCap = toBigint(sourceState.planet.population_cap);
    const silver = toBigint(sourceState.planet.silver);
    const silverGrowth = toBigint(sourceState.planet.silver_growth);
    const silverCap = toBigint(sourceState.planet.silver_cap);
    const sourceLastUpdated = toBigint(sourceState.planet.last_updated);
    const range = toBigint(sourceState.planet.range);
    const maxDist = 1n;
    const effectiveDistTimesHundred = maxDist * 100n;
    const decayRangeTimesHundred = range * 455n;
    const distanceRatio =
        decayRangeTimesHundred === 0n ||
        effectiveDistTimesHundred >= decayRangeTimesHundred
            ? 100n
            : (effectiveDistTimesHundred * 100n) / decayRangeTimesHundred;
    const remainingRatio = distanceRatio >= 100n ? 0n : 100n - distanceRatio;
    const debuff = populationCap / 20n;
    const minPopForArrival =
        remainingRatio > 0n ? (debuff * 100n) / remainingRatio + 1n : 0n;

    await sendTimestampRefreshTx(ctx);
    let moveTimestamp = await getL2BlockTimestamp(ctx);
    let elapsedSeconds =
        moveTimestamp > sourceLastUpdated
            ? moveTimestamp - sourceLastUpdated
            : 0n;
    let projectedPopulation =
        population + populationGrowth * elapsedSeconds > populationCap
            ? populationCap
            : population + populationGrowth * elapsedSeconds;
    let projectedSilver =
        silver + silverGrowth * elapsedSeconds > silverCap
            ? silverCap
            : silver + silverGrowth * elapsedSeconds;

    if (projectedPopulation <= minPopForArrival) {
        if (populationGrowth === 0n) {
            throw new Error(
                `SilverMine population ${projectedPopulation} is below minimum required ${minPopForArrival} and cannot grow`
            );
        }
        const neededGrowth = minPopForArrival + 1n - projectedPopulation;
        const extraSeconds =
            (neededGrowth + populationGrowth - 1n) / populationGrowth;
        console.log(
            `   population too low (${projectedPopulation}); advancing +${extraSeconds + 1n}s to reach move threshold`
        );
        await advanceChainTime(ctx, extraSeconds + 1n);
        await sendTimestampRefreshTx(ctx);
        moveTimestamp = await getL2BlockTimestamp(ctx);
        elapsedSeconds =
            moveTimestamp > sourceLastUpdated
                ? moveTimestamp - sourceLastUpdated
                : 0n;
        projectedPopulation =
            population + populationGrowth * elapsedSeconds > populationCap
                ? populationCap
                : population + populationGrowth * elapsedSeconds;
        projectedSilver =
            silver + silverGrowth * elapsedSeconds > silverCap
                ? silverCap
                : silver + silverGrowth * elapsedSeconds;
    }

    if (projectedPopulation <= minPopForArrival) {
        throw new Error(
            `SilverMine population ${projectedPopulation} is below minimum required ${minPopForArrival} for a successful move`
        );
    }

    const popMoved =
        projectedPopulation > minPopForArrival
            ? projectedPopulation > minPopForArrival + 10_000n
                ? minPopForArrival + 10_000n
                : projectedPopulation - 1n
            : 0n;
    if (popMoved === 0n) {
        throw new Error('SilverMine has no population to move');
    }

    const silverMoved = projectedSilver;
    if (silverMoved === 0n) {
        throw new Error('SilverMine has no silver to move');
    }
    console.log(`   pop_moved=${popMoved}, silver_moved=${silverMoved}`);

    const targetPerlin = 13;
    const targetLevel = 1;
    const targetRadius = toBigint(worldForMove.radius);
    const x1 = 0n;
    const y1 = 0n;
    const x2 = maxDist;
    const y2 = 0n;
    const movedArtifactId = 0n;
    const activatedArtifactId = 0n;
    const isAbandoning = false;
    const movedArtifact = artifactZero();
    const movedArtifactLocation = artifactLocationZero();
    const activatedArtifact = artifactZero();

    const buildMoveArgs = (timestamp: bigint) =>
        [
            silverMineLocation,
            location,
            targetPerlin,
            targetLevel,
            targetRadius,
            maxDist,
            x1,
            y1,
            x2,
            y2,
            popMoved,
            silverMoved,
            movedArtifactId,
            activatedArtifactId,
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
            sourceState.planet,
            sourceState.planetEvents,
            sourceState.arrivals,
            sourceState.artifacts,
            sourceState.artifactLocations,
            sourceState.planetArtifacts,
            targetState.planet,
            targetState.planetEvents,
            targetState.arrivals,
            targetState.artifacts,
            targetState.artifactLocations,
            targetState.planetArtifacts,
            worldForMove,
            movedArtifact,
            movedArtifactLocation,
            activatedArtifact,
        ] as const;

    let moveCompleted = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const moveArgs = buildMoveArgs(moveTimestamp);
        try {
            const movePayload = await Move.methods
                .move(...moveArgs)
                .request(sendOpts(user));
            await Move.wallet.simulateTx(movePayload, { from: user });
            console.log(`   ✅ Move.simulate passed (attempt ${attempt}).`);
            await Move.methods.move(...moveArgs).send(sendOpts(user));
            moveCompleted = true;
            break;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('Timestamp too old') && attempt < 3) {
                console.warn(
                    `   ⚠️ Move failed with stale timestamp — retrying (attempt ${attempt + 1})...`
                );
                await sendTimestampRefreshTx(ctx);
                moveTimestamp = await getL2BlockTimestamp(ctx);
                continue;
            }
            console.error('   ❌ Move failed:', msg);
            process.exit(1);
        }
    }
    if (!moveCompleted) {
        throw new Error('Failed to execute move after retries');
    }

    console.log('⏱️ Advancing chain time past arrival...');
    await advanceChainTime(ctx, 2n);

    console.log('\n📥 Loading upgrade config...');
    const upgradeConfig = await Config.methods
        .get_upgrade_config()
        .simulate({ from: user });
    const upgrade = await Config.methods
        .get_upgrade_by_branch_level(0, 0)
        .simulate({ from: user });
    console.log(
        `   max_branch_level=${toBigint(upgradeConfig.max_branch_level)}, silver_cost_percent=${toBigint(upgradeConfig.silver_cost_percent)}`
    );

    console.log('\n🎮 Calling Core.upgrade_planet() (private)...');

    let state: Awaited<ReturnType<typeof loadPlanetCoreInputs>> | null = null;
    let txSimResult: Awaited<ReturnType<typeof Core.wallet.simulateTx>> | null =
        null;
    let receipt: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        state = await loadPlanetCoreInputs(ctx, location);

        console.log('\n🔄 Refreshing timestamp before upgrade...');
        await sendTimestampRefreshTx(ctx);
        const timestamp = await getL2BlockTimestamp(ctx);

        const upgradeArgs = [
            location,
            branch,
            timestamp,
            upgradeConfig,
            upgrade,
            state.planet,
            state.planetEvents,
            state.arrivals,
            state.artifacts,
            state.artifactLocations,
            state.planetArtifacts,
        ] as const;

        console.log(
            `   branch=${branch}, timestamp=${timestamp}, attempt=${attempt}`
        );

        try {
            const payload = await Core.methods
                .upgrade_planet(...upgradeArgs)
                .request(sendOpts(user));
            txSimResult = await Core.wallet.simulateTx(payload, {
                from: user,
            });
            console.log('   ✅ Simulate passed.');

            receipt = await Core.methods
                .upgrade_planet(...upgradeArgs)
                .send(sendOpts(user));
            break;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('Timestamp too old') && attempt < 3) {
                console.warn(`   ⚠️ ${msg} — retrying with fresh timestamp...`);
                continue;
            }
            console.error('   ❌ upgrade_planet failed:', msg);
            process.exit(1);
        }
    }

    if (!state || !txSimResult || !receipt) {
        throw new Error('Failed to execute upgrade_planet after retries');
    }

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

    const beforeSilver = toBigint(state.planet.silver);
    const beforeUpgrade0 = toBigint(state.planet.upgrade_state_0);

    const blockNumber =
        receipt &&
        typeof (receipt as { blockNumber?: number }).blockNumber !== 'undefined'
            ? Number((receipt as { blockNumber: number }).blockNumber)
            : undefined;
    const txHash =
        receipt && (receipt as unknown as { txHash?: unknown }).txHash != null
            ? String((receipt as unknown as { txHash: unknown }).txHash)
            : undefined;

    const upgradedPlanet = await loadPlanetFromEvents(ctx, location);
    if (!upgradedPlanet) {
        throw new Error('Upgrade tx sent but could not reload updated planet');
    }
    const afterSilver = toBigint(upgradedPlanet.silver);
    const afterUpgrade0 = toBigint(upgradedPlanet.upgrade_state_0);

    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST SUCCESS — upgrade_planet committed');
    console.log('='.repeat(60));
    console.log('  Transaction:', txHash ?? '(n/a)');
    console.log('  Block number:', blockNumber ?? '(unknown)');
    console.log('  location:', String(location));
    console.log(
        `  upgrade_state_0: ${beforeUpgrade0} -> ${afterUpgrade0} (branch=${branch})`
    );
    console.log(`  silver: ${beforeSilver} -> ${afterSilver}`);
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
