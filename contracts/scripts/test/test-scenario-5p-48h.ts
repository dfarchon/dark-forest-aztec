/**
 * Compressed 5-player multi-action scenario skeleton.
 *
 * Simulates a long multiplayer session (product intent ~48h of play) on a local
 * network without waiting wall-clock 48h: applies the `fast` config preset, then
 * drives bootstrap → expand → contend → artifacts → admin → invariants.
 *
 * Prerequisites:
 * - Local net + `pnpm deploy:run` + `pnpm bootstrap`
 * - `TEST_USER_COUNT=5` (set by `pnpm test:scenario-5p`)
 *
 * Expected wall time: minutes to tens of minutes on local net, not 48h.
 *
 * Usage (from contracts/):
 *   TEST_USER_COUNT=5 pnpm exec tsx scripts/test/test-scenario-5p-48h.ts
 *   pnpm test:scenario-5p
 */
import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { getPublicEvents } from '@aztec-labs/aztec.js/events';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';

import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { unwrapSimulateResult } from '../utils/index.ts';
import {
    runSettleAndContestedMoves,
    runUpgradePlanetHarness,
    runWithdrawSilverHarness,
} from './scenarioHeavyGameplay.ts';
import {
    ensureZkDisabled,
    getTestContext,
    sendTimestampRefreshTx,
    type TestContext,
} from './test-setup.ts';
import {
    advanceChainTime,
    AZTEC_ZERO,
    getL2BlockTimestamp,
    homeLocationId,
    isPlanetRevealed,
    isPlayerInitialized,
    loadPlanet,
    loadPlanetArtifacts,
    loadPlanetFromStorage,
    loadPlayer,
    loadStateEvent,
    loadWorld,
    measureCall,
    otherUserIndex,
    planetArtifactsZero,
    toBigint,
    worldZero,
} from './testHelpers.ts';

/** Wired player-facing methods we aim to touch in this scenario. */
const PLAYER_COVERAGE_TARGETS = [
    'initializePlayer',
    'revealLocation',
    'move',
    'upgradePlanet',
    'withdrawSilver',
    'buyHat',
    'transferPlanet',
    'prospectPlanet',
    'findArtifact',
    'activateArtifact',
    'deactivateArtifact',
    'depositArtifact',
    'withdrawArtifact',
    'giveSpaceShips',
] as const;

type CoverageName = (typeof PLAYER_COVERAGE_TARGETS)[number] | string;

type ScenarioState = {
    ctx: TestContext;
    covered: Set<string>;
    skipped: Map<string, string>;
    transferredPlanetLocation: bigint | null;
    transferredPlanetOwner: AztecAddress | null;
};

function mark(
    state: ScenarioState,
    name: CoverageName,
    status: 'ok' | 'skip' = 'ok',
    reason?: string
): void {
    if (status === 'ok') {
        state.covered.add(name);
        return;
    }
    state.skipped.set(name, reason ?? 'skipped');
}

async function runPhase(name: string, fn: () => Promise<void>): Promise<void> {
    console.log(`\nSCENARIO phase=${name} start`);
    try {
        await fn();
        console.log(`SCENARIO phase=${name} ok`);
    } catch (err) {
        console.error(`SCENARIO phase=${name} fail`);
        throw err;
    }
}

function playerZero() {
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

function planetZero(): Record<string, unknown> {
    return {
        perlin: 0,
        created_at: 0,
        owner: AZTEC_ZERO,
        planet_level: 0,
        planet_type: 0,
        space_type: 0,
        is_home_planet: false,
        is_initialized: false,
        destroyed: false,
        invader: AZTEC_ZERO,
        capturer: AZTEC_ZERO,
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

function planetEventsZero() {
    return { events: Array(20).fill({ id: 0 }), count: 0, last_updated: 0 };
}

function arrivalZero() {
    return {
        id: 0,
        player: AZTEC_ZERO,
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

function artifactZero() {
    return {
        planet_discovered_on: 0n,
        rarity: 0,
        planet_biome: 0,
        minted_at_timestamp: 0,
        discoverer: AZTEC_ZERO,
        artifact_type: 0,
        activations: 0n,
        last_activated: 0,
        last_deactivated: 0,
        wormhole_to: 0n,
        owner: AZTEC_ZERO,
        controller: AZTEC_ZERO,
        last_updated: 0,
    };
}

function artifactLocationZero() {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

function emptyArrivals() {
    return Array.from({ length: 20 }, () => arrivalZero());
}
function emptyArtifacts() {
    return Array.from({ length: 20 }, () => artifactZero());
}
function emptyArtifactLocations() {
    return Array.from({ length: 20 }, () => artifactLocationZero());
}

function revealedCoordsZero() {
    return {
        location_id: 0n,
        x: 0n,
        y: 0n,
        revealer: AZTEC_ZERO,
        last_updated: 0,
    };
}

async function waitPlanet(
    ctx: TestContext,
    location: bigint
): Promise<Record<string, unknown>> {
    for (let i = 0; i < 20; i++) {
        const latestBlock = Number(await ctx.node.getBlockNumber());
        const from = Math.max(0, latestBlock - 15);
        const mod = await import('../artifacts/PlanetStorage.ts');
        const raw = await getPublicEvents(
            ctx.node,
            mod.PlanetStorageContract.events.PlanetUpdate,
            {
                fromBlock: BlockNumber(from),
                toBlock: BlockNumber(latestBlock + 1),
                contractAddress: ctx.contracts['PlanetStorage']?.address,
            }
        );
        const state = raw.events
            .map(
                (e) =>
                    e.event as {
                        id: unknown;
                        state?: Record<string, unknown>;
                    }
            )
            .filter((e) => BigInt(String(e.id)) === location)
            .pop()?.state;
        if (state) return state;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`PlanetUpdate missing for ${location}`);
}

async function loadPlanetEvents(
    ctx: TestContext,
    location: bigint
): Promise<Record<string, unknown>> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 30);
    const mod = await import('../artifacts/PlanetEventsStorage.ts');
    const raw = await getPublicEvents(
        ctx.node,
        mod.PlanetEventsStorageContract.events.PlanetEventsUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(latestBlock + 1),
            contractAddress: ctx.contracts['PlanetEventsStorage']?.address,
        }
    );
    const state = raw.events
        .map((e) => e.event as { id: unknown; state?: Record<string, unknown> })
        .filter((e) => BigInt(String(e.id)) === location)
        .pop()?.state;
    return state ?? planetEventsZero();
}

async function loadArtifact(
    ctx: TestContext,
    id: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 30);
    const mod = await import('../artifacts/ArtifactStorage.ts');
    const raw = await getPublicEvents(
        ctx.node,
        mod.ArtifactStorageContract.events.ArtifactUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(latestBlock + 1),
            contractAddress: ctx.contracts['ArtifactStorage']?.address,
        }
    );
    return (
        raw.events
            .map(
                (e) =>
                    e.event as {
                        id: unknown;
                        state?: Record<string, unknown>;
                    }
            )
            .filter((e) => BigInt(String(e.id)) === id)
            .pop()?.state ?? null
    );
}

async function loadArtifactLocation(
    ctx: TestContext,
    id: bigint
): Promise<Record<string, unknown>> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 30);
    const mod = await import('../artifacts/ArtifactLocationStorage.ts');
    const raw = await getPublicEvents(
        ctx.node,
        mod.ArtifactLocationStorageContract.events.ArtifactLocationUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(latestBlock + 1),
            contractAddress: ctx.contracts['ArtifactLocationStorage']?.address,
        }
    );
    return (
        raw.events
            .map(
                (e) =>
                    e.event as {
                        id: unknown;
                        state?: Record<string, unknown>;
                    }
            )
            .filter((e) => BigInt(String(e.id)) === id)
            .pop()?.state ?? artifactLocationZero()
    );
}

async function createOwnedPlanet(
    ctx: TestContext,
    location: bigint,
    planetType: number,
    level: number,
    owner: AztecAddress
): Promise<Record<string, unknown>> {
    const Admin = ctx.contracts['Admin']!;
    const admin = ctx.accounts.admin;
    await Admin.methods
        .create_planet({
            location,
            perlin: 13,
            level,
            planet_type: planetType,
            require_valid_location_id: false,
        })
        .send(ctx.sendOpts(admin));
    let planet = await waitPlanet(ctx, location);
    await Admin.methods
        .set_owner(location, planet, owner)
        .send(ctx.sendOpts(admin));
    planet = await waitPlanet(ctx, location);
    return planet;
}

async function phaseFastPreset(state: ScenarioState): Promise<void> {
    const { ctx } = state;
    const Config = ctx.contracts['Config']!;
    const admin = ctx.accounts.admin;
    const worldConfig = unwrapSimulateResult(
        await Config.methods
            .get_world_config_unconstrained()
            .simulate({ from: admin })
    ) as Record<string, unknown>;
    const artifactsConfig = unwrapSimulateResult(
        await Config.methods
            .get_artifacts_config_unconstrained()
            .simulate({ from: admin })
    ) as Record<string, unknown>;

    const updatedWorld = {
        ...worldConfig,
        time_factor_hundredths: 1000,
        location_reveal_cooldown: 60n,
    };
    const updatedArtifacts = {
        ...artifactsConfig,
        photoid_activation_delay: 60n,
    };

    console.log('   Applying fast preset (10x time factor, 60s cooldowns)...');
    await measureCall(
        'set_world_config',
        ctx,
        Config,
        'set_world_config',
        [updatedWorld],
        admin,
        { refreshTimestamp: false }
    );
    mark(state, 'setWorldConfig');
    await Config.methods
        .set_artifacts_config(updatedArtifacts)
        .send(ctx.sendOpts(admin));
}

async function initializePlayer(
    state: ScenarioState,
    userIndex: number
): Promise<void> {
    const { ctx } = state;
    const Core = ctx.contracts['Core']!;
    const Config = ctx.contracts['Config']!;
    const Admin = ctx.contracts['Admin'];
    const user = ctx.accounts.users[userIndex]!;
    const admin = ctx.accounts.admin;

    if (await isPlayerInitialized(ctx, user)) {
        console.log(`   user${userIndex + 1} already initialized; skipping`);
        mark(state, 'initializePlayer');
        return;
    }

    await ensureZkDisabled(ctx);

    const snarkConfig = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: user })
    );
    const level = 0;
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
    const planetLevelThresholds = unwrapSimulateResult(
        await Config.methods
            .get_planet_level_thresholds()
            .simulate({ from: user })
    );
    const spaceJunkConfig = unwrapSimulateResult(
        await Config.methods.get_space_junk_config().simulate({ from: user })
    );
    const tiers = [];
    for (let t = 0; t < 4; t++) {
        tiers.push(
            unwrapSimulateResult(
                await Config.methods
                    .get_planet_type_weights_tier(t)
                    .simulate({ from: user })
            )
        );
    }

    let world = (await loadWorld(ctx)) ?? worldZero();
    const ZERO_RADIUS = 53_000n;
    if (toBigint(world.radius) === ZERO_RADIUS && Admin) {
        await Admin.methods
            .admin_set_world_radius(53001n, world)
            .send(ctx.sendOpts(admin));
        world = { ...world, radius: 53001n };
        mark(state, 'adminSetWorldRadius');
    }

    const locationId = homeLocationId(userIndex);
    const perlin = Number(gameConfigCore.init_perlin_min ?? 13);
    await sendTimestampRefreshTx(ctx);
    const timestamp = await getL2BlockTimestamp(ctx);

    try {
        await measureCall(
            'initialize_player',
            ctx,
            Core,
            'initialize_player',
            [
                0n,
                0n,
                toBigint(world.radius),
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
                tiers[0],
                tiers[1],
                tiers[2],
                tiers[3],
                planetZero(),
                playerZero(),
                world,
            ],
            user
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
            msg.includes('Player already initialized') &&
            (await isPlayerInitialized(ctx, user))
        ) {
            console.log(
                `   user${userIndex + 1} already initialized (race); skipping`
            );
            mark(state, 'initializePlayer');
            return;
        }
        throw err;
    }
    mark(state, 'initializePlayer');
}

async function phaseInit(state: ScenarioState): Promise<void> {
    await ensureZkDisabled(state.ctx);
    for (let i = 0; i < state.ctx.accounts.users.length; i++) {
        console.log(`   Initializing user${i + 1}...`);
        await initializePlayer(state, i);
    }
}

async function giveSpaceships(
    state: ScenarioState,
    userIndex: number
): Promise<void> {
    const { ctx } = state;
    const Vault = ctx.contracts['ArtifactVault']!;
    const Config = ctx.contracts['Config']!;
    const user = ctx.accounts.users[userIndex]!;
    const locationId = homeLocationId(userIndex);
    const planet =
        (await loadPlanetFromStorage(ctx, locationId)) ??
        (await loadPlanet(ctx, locationId));
    const player = await loadPlayer(ctx, user.toString());
    if (!planet || !player) {
        throw new Error(
            `Home missing for user${userIndex + 1} (planet=${!!planet} player=${!!player}; paged event scan found nothing)`
        );
    }
    if (player.claimed_ships) {
        console.log(
            `   user${userIndex + 1} already claimed ships; skipping give_spaceships`
        );
        mark(state, 'giveSpaceShips');
        return;
    }
    const planetEvents =
        (await loadStateEvent(
            ctx,
            '../artifacts/PlanetEventsStorage.ts',
            'PlanetEventsStorageContract',
            'PlanetEventsUpdate',
            'PlanetEventsStorage',
            String(locationId)
        )) ?? planetEventsZero();
    const planetArtifacts =
        (await loadPlanetArtifacts(ctx, locationId)) ?? planetArtifactsZero();
    const spaceshipsConfig = unwrapSimulateResult(
        await Config.methods.get_spaceships_config().simulate({ from: user })
    );
    const timestamp = await getL2BlockTimestamp(ctx);
    await measureCall(
        'give_spaceships',
        ctx,
        Vault,
        'give_spaceships',
        [
            locationId,
            timestamp,
            planet,
            planetArtifacts,
            planetEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            player,
            spaceshipsConfig,
        ],
        user
    );
    mark(state, 'giveSpaceShips');
}

async function revealHome(
    state: ScenarioState,
    userIndex: number
): Promise<void> {
    const { ctx } = state;
    const Core = ctx.contracts['Core']!;
    const Config = ctx.contracts['Config']!;
    const user = ctx.accounts.users[userIndex]!;
    const locationId = homeLocationId(userIndex);
    const level = 0;

    if (await isPlanetRevealed(ctx, locationId)) {
        console.log(
            `   user${userIndex + 1} home already revealed; skipping reveal_location`
        );
        mark(state, 'revealLocation');
        return;
    }

    const planet =
        (await loadPlanetFromStorage(ctx, locationId)) ??
        (await loadPlanet(ctx, locationId));
    const player = await loadPlayer(ctx, user.toString());
    const world = (await loadWorld(ctx)) ?? worldZero();
    if (!planet || !player) {
        throw new Error(
            `Home missing for reveal user${userIndex + 1} (planet=${!!planet} player=${!!player})`
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
    const tiers = [];
    for (let t = 0; t < 4; t++) {
        tiers.push(
            unwrapSimulateResult(
                await Config.methods
                    .get_planet_type_weights_tier(t)
                    .simulate({ from: user })
            )
        );
    }
    const timestamp = await getL2BlockTimestamp(ctx);
    try {
        await measureCall(
            'reveal_location',
            ctx,
            Core,
            'reveal_location',
            [
                locationId,
                perlin,
                level,
                0n,
                0n,
                timestamp,
                false,
                snarkConfig,
                planetDefaultStats,
                worldConfig,
                gameConfigCore,
                planetLevelThresholds,
                spaceJunkConfig,
                tiers[0],
                tiers[1],
                tiers[2],
                tiers[3],
                planet,
                revealedCoordsZero(),
                player,
                world,
            ],
            user
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
            msg.includes('Planet already revealed') &&
            (await isPlanetRevealed(ctx, locationId))
        ) {
            console.log(
                `   user${userIndex + 1} home already revealed (race); skipping`
            );
            mark(state, 'revealLocation');
            return;
        }
        throw err;
    }
    mark(state, 'revealLocation');
}

async function buyHat(state: ScenarioState, userIndex: number): Promise<void> {
    const { ctx } = state;
    const Core = ctx.contracts['Core']!;
    const user = ctx.accounts.users[userIndex]!;
    const locationId = homeLocationId(userIndex);
    const planet =
        (await loadPlanetFromStorage(ctx, locationId)) ??
        (await loadPlanet(ctx, locationId));
    const world = (await loadWorld(ctx)) ?? worldZero();
    if (!planet)
        throw new Error(`Home missing for buy_hat user${userIndex + 1}`);
    const timestamp = await getL2BlockTimestamp(ctx);
    await measureCall(
        'buy_hat',
        ctx,
        Core,
        'buy_hat',
        [locationId, timestamp, planet, world],
        user
    );
    mark(state, 'buyHat');
}

async function phaseExpand(state: ScenarioState): Promise<void> {
    const { ctx } = state;
    const Admin = ctx.contracts['Admin']!;
    const n = ctx.accounts.users.length;

    for (let i = 0; i < n; i++) {
        console.log(`   expand user${i + 1}: give_spaceships + reveal`);
        await giveSpaceships(state, i);
        await revealHome(state, i);
    }

    // Disposable admin planet (ownership for later contend/transfer).
    const runTag = BigInt(Number(await ctx.node.getBlockNumber()) % 1_000_000);
    const location = ((70_000_000n + runTag) << 216n) | (255n << 64n);
    console.log(`   create_planet location=${location}`);
    await Admin.methods
        .create_planet({
            location,
            perlin: 13,
            level: 1,
            planet_type: 0,
            require_valid_location_id: false,
        })
        .send(ctx.sendOpts(ctx.accounts.admin));
    await waitPlanet(ctx, location);
    mark(state, 'createPlanet');

    // buy_hat on first two players
    for (let i = 0; i < Math.min(2, n); i++) {
        await buyHat(state, i);
    }

    // Proven heavy paths (unique runTag locations inside harnesses).
    console.log('   upgradePlanet via test-upgrade.ts (user0)...');
    await runUpgradePlanetHarness(0);
    mark(state, 'upgradePlanet');

    console.log('   withdrawSilver via test-withdraw.ts (user1)...');
    await runWithdrawSilverHarness(1);
    mark(state, 'withdrawSilver');

    await advanceChainTime(ctx, 5n);
}

async function phaseContend(state: ScenarioState): Promise<void> {
    const { ctx } = state;
    const Core = ctx.contracts['Core']!;
    const Admin = ctx.contracts['Admin']!;
    const Config = ctx.contracts['Config']!;
    const userIndex = 0;
    const user = ctx.accounts.users[userIndex]!;
    const other =
        ctx.accounts.users[
            otherUserIndex(userIndex, ctx.accounts.users.length)
        ]!;
    const admin = ctx.accounts.admin;
    const runTag = BigInt(Number(await ctx.node.getBlockNumber()) % 1_000_000);

    // transfer_planet: admin planet → user → other
    const transferLoc = ((71_000_000n + runTag) << 216n) | (255n << 64n);
    console.log(`   transfer_planet via disposable planet ${transferLoc}`);
    const planet = await createOwnedPlanet(ctx, transferLoc, 0, 1, user);
    const world = (await loadWorld(ctx)) ?? worldZero();
    let timestamp = await getL2BlockTimestamp(ctx);
    await measureCall(
        'transfer_planet',
        ctx,
        Core,
        'transfer_planet',
        [transferLoc, timestamp, planet, other, world],
        user
    );
    mark(state, 'transferPlanet');
    state.transferredPlanetLocation = transferLoc;
    state.transferredPlanetOwner = other;

    // safe_set_owner on another planet (admin → other)
    const safeLoc = ((72_000_000n + runTag) << 216n) | (255n << 64n);
    const existing = await createOwnedPlanet(ctx, safeLoc, 0, 1, user);
    const level = Number(existing.planet_level ?? 1);
    const snarkConfig = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: admin })
    );
    const planetDefaultStats = unwrapSimulateResult(
        await Config.methods
            .get_planet_default_stats(level)
            .simulate({ from: admin })
    );
    const worldConfig = unwrapSimulateResult(
        await Config.methods.get_world_config().simulate({ from: admin })
    );
    const gameConfigCore = unwrapSimulateResult(
        await Config.methods.get_game_config_core().simulate({ from: admin })
    );
    const planetLevelThresholds = unwrapSimulateResult(
        await Config.methods
            .get_planet_level_thresholds()
            .simulate({ from: admin })
    );
    const spaceJunkConfig = unwrapSimulateResult(
        await Config.methods.get_space_junk_config().simulate({ from: admin })
    );
    const tiers = [];
    for (let t = 0; t < 4; t++) {
        tiers.push(
            unwrapSimulateResult(
                await Config.methods
                    .get_planet_type_weights_tier(t)
                    .simulate({ from: admin })
            )
        );
    }
    const world2 = (await loadWorld(ctx)) ?? worldZero();
    timestamp = await getL2BlockTimestamp(ctx);
    await measureCall(
        'safe_set_owner',
        ctx,
        Admin,
        'safe_set_owner',
        [
            0n,
            0n,
            safeLoc,
            Number(existing.perlin ?? 13),
            level,
            other,
            timestamp,
            snarkConfig,
            planetDefaultStats,
            worldConfig,
            gameConfigCore,
            planetLevelThresholds,
            spaceJunkConfig,
            tiers[0],
            tiers[1],
            tiers[2],
            tiers[3],
            world2,
            existing,
        ],
        admin
    );
    mark(state, 'safeSetOwner');

    console.log(
        '   settle + contested moves (user1 → empty + user2 planet)...'
    );
    await runSettleAndContestedMoves(ctx, 0, 1);
    mark(state, 'move');
}

async function phaseArtifacts(state: ScenarioState): Promise<void> {
    const { ctx } = state;
    const Config = ctx.contracts['Config']!;
    const Prospect = ctx.contracts['ArtifactProspect']!;
    const Find = ctx.contracts['ArtifactFind']!;
    const Action = ctx.contracts['ArtifactAction']!;
    const Vault = ctx.contracts['ArtifactVault']!;
    const admin = ctx.accounts.admin;

    // Disable gear requirement so prospect/find don't need ShipGear.
    const ships = unwrapSimulateResult(
        await Config.methods.get_spaceships_config().simulate({ from: admin })
    ) as Record<string, unknown>;
    if (ships.gear) {
        await Config.methods
            .set_spaceships_config({ ...ships, gear: false })
            .send(ctx.sendOpts(admin));
    }
    const spaceshipsConfig = unwrapSimulateResult(
        await Config.methods.get_spaceships_config().simulate({ from: admin })
    );

    const playersToRun = Math.min(2, ctx.accounts.users.length);
    for (let userIndex = 0; userIndex < playersToRun; userIndex++) {
        const user = ctx.accounts.users[userIndex]!;
        const runTag = BigInt(
            (Number(await ctx.node.getBlockNumber()) + userIndex * 17) %
                1_000_000
        );
        const ruinsLoc =
            ((80_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
            (255n << 64n);
        const postLoc =
            ((81_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
            (255n << 64n);

        console.log(`   artifacts for user${userIndex + 1}`);
        let ruins = await createOwnedPlanet(ctx, ruinsLoc, 2, 3, user);
        let ruinsEvents = await loadPlanetEvents(ctx, ruinsLoc);
        let ruinsArts =
            (await loadPlanetArtifacts(ctx, ruinsLoc)) ?? planetArtifactsZero();
        let world = (await loadWorld(ctx)) ?? worldZero();
        let timestamp = await getL2BlockTimestamp(ctx);

        await measureCall(
            'prospect_planet',
            ctx,
            Prospect,
            'prospect_planet',
            [
                ruinsLoc,
                timestamp,
                ruins,
                ruinsEvents,
                emptyArrivals(),
                emptyArtifacts(),
                emptyArtifactLocations(),
                ruinsArts,
                emptyArtifacts(),
                emptyArtifactLocations(),
                world,
                spaceshipsConfig,
            ],
            user
        );
        mark(state, 'prospectPlanet');

        await sendTimestampRefreshTx(ctx);
        ruins = await waitPlanet(ctx, ruinsLoc);
        ruinsEvents = await loadPlanetEvents(ctx, ruinsLoc);
        ruinsArts =
            (await loadPlanetArtifacts(ctx, ruinsLoc)) ?? planetArtifactsZero();
        world = (await loadWorld(ctx)) ?? worldZero();
        const player = await loadPlayer(ctx, user.toString());
        if (!player || toBigint(player.init_timestamp) === 0n) {
            throw new Error(`Player user${userIndex + 1} not initialized`);
        }

        const snarkConfig = unwrapSimulateResult(
            await Config.methods.get_snark_config().simulate({ from: user })
        );
        const gameConfigCore = unwrapSimulateResult(
            await Config.methods.get_game_config_core().simulate({ from: user })
        );
        const worldConfig = unwrapSimulateResult(
            await Config.methods.get_world_config().simulate({ from: user })
        );
        const artifactsConfig = unwrapSimulateResult(
            await Config.methods.get_artifacts_config().simulate({ from: user })
        );
        timestamp = await getL2BlockTimestamp(ctx);

        await measureCall(
            'find_artifact',
            ctx,
            Find,
            'find_artifact',
            [
                ruinsLoc,
                0n,
                0n,
                0,
                timestamp,
                snarkConfig,
                gameConfigCore,
                worldConfig,
                artifactsConfig,
                spaceshipsConfig,
                player,
                ruins,
                ruinsEvents,
                emptyArrivals(),
                emptyArtifacts(),
                emptyArtifactLocations(),
                ruinsArts,
                emptyArtifacts(),
                emptyArtifactLocations(),
                world,
            ],
            user
        );
        mark(state, 'findArtifact');

        let post = await createOwnedPlanet(ctx, postLoc, 3, 3, user);
        let postArts =
            (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
        const monolithId = Fr.random().toBigInt();
        await Vault.methods
            .admin_give_artifact(
                {
                    id: monolithId,
                    discoverer: user,
                    planet_id: postLoc,
                    rarity: 0,
                    biome: 1,
                    artifact_type: 1,
                    controller: user,
                },
                postArts
            )
            .send(ctx.sendOpts(admin));
        mark(state, 'adminGiveArtifact');

        for (let i = 0; i < 15; i++) {
            postArts =
                (await loadPlanetArtifacts(ctx, postLoc)) ??
                planetArtifactsZero();
            if (Number(postArts.count ?? 0) > 0) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        post = await waitPlanet(ctx, postLoc);
        let postEvents = await loadPlanetEvents(ctx, postLoc);
        let artifact = await loadArtifact(ctx, monolithId);
        if (!artifact) throw new Error('Monolith ArtifactUpdate missing');
        let artifactLoc = await loadArtifactLocation(ctx, monolithId);
        world = (await loadWorld(ctx)) ?? world;
        const planetDefaultStats = unwrapSimulateResult(
            await Config.methods
                .get_planet_default_stats(3)
                .simulate({ from: user })
        );
        timestamp = await getL2BlockTimestamp(ctx);
        const planetArtifactsArr = emptyArtifacts();
        planetArtifactsArr[0] = artifact;

        await measureCall(
            'activate_artifact',
            ctx,
            Action,
            'activate_artifact',
            [
                postLoc,
                monolithId,
                0n,
                timestamp,
                post,
                postEvents,
                emptyArrivals(),
                emptyArtifacts(),
                emptyArtifactLocations(),
                postArts,
                artifact,
                artifactLoc,
                world,
                worldConfig,
                planetDefaultStats,
                planetArtifactsArr,
                planetZero(),
            ],
            user
        );
        mark(state, 'activateArtifact');

        post = await waitPlanet(ctx, postLoc);
        postEvents = await loadPlanetEvents(ctx, postLoc);
        postArts =
            (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
        artifact = (await loadArtifact(ctx, monolithId))!;
        artifactLoc = await loadArtifactLocation(ctx, monolithId);
        timestamp = await getL2BlockTimestamp(ctx);

        await measureCall(
            'deactivate_artifact',
            ctx,
            Action,
            'deactivate_artifact',
            [
                postLoc,
                monolithId,
                timestamp,
                post,
                postEvents,
                emptyArrivals(),
                emptyArtifacts(),
                emptyArtifactLocations(),
                postArts,
                artifact,
                artifactLoc,
                world,
            ],
            user
        );
        mark(state, 'deactivateArtifact');

        post = await waitPlanet(ctx, postLoc);
        postEvents = await loadPlanetEvents(ctx, postLoc);
        postArts =
            (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
        artifact = (await loadArtifact(ctx, monolithId))!;
        artifactLoc = await loadArtifactLocation(ctx, monolithId);
        timestamp = await getL2BlockTimestamp(ctx);

        await measureCall(
            'withdraw_artifact',
            ctx,
            Vault,
            'withdraw_artifact',
            [
                postLoc,
                monolithId,
                timestamp,
                post,
                postArts,
                postEvents,
                emptyArrivals(),
                emptyArtifacts(),
                emptyArtifactLocations(),
                artifact,
                artifactLoc,
                world,
            ],
            user
        );
        mark(state, 'withdrawArtifact');

        post = await waitPlanet(ctx, postLoc);
        postEvents = await loadPlanetEvents(ctx, postLoc);
        postArts =
            (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
        artifact = (await loadArtifact(ctx, monolithId))!;
        artifactLoc = await loadArtifactLocation(ctx, monolithId);
        timestamp = await getL2BlockTimestamp(ctx);

        await measureCall(
            'deposit_artifact',
            ctx,
            Vault,
            'deposit_artifact',
            [
                postLoc,
                monolithId,
                timestamp,
                post,
                postArts,
                postEvents,
                emptyArrivals(),
                emptyArtifacts(),
                emptyArtifactLocations(),
                artifact,
                artifactLoc,
                world,
            ],
            user
        );
        mark(state, 'depositArtifact');
    }
}

async function phaseAdmin(state: ScenarioState): Promise<void> {
    const { ctx } = state;
    const Admin = ctx.contracts['Admin']!;
    const Config = ctx.contracts['Config']!;
    const Core = ctx.contracts['Core']!;
    const admin = ctx.accounts.admin;
    const user = ctx.accounts.users[0]!;

    let world = (await loadWorld(ctx)) ?? worldZero();
    const radius = toBigint(world.radius) + 1n;
    await measureCall(
        'admin_set_world_radius',
        ctx,
        Admin,
        'admin_set_world_radius',
        [radius, world],
        admin,
        { refreshTimestamp: false }
    );
    mark(state, 'adminSetWorldRadius');

    const worldConfig = unwrapSimulateResult(
        await Config.methods
            .get_world_config_unconstrained()
            .simulate({ from: admin })
    ) as Record<string, unknown>;
    // Keep fast time factor; only touch a non-critical field if present.
    const tweaked = {
        ...worldConfig,
        time_factor_hundredths: worldConfig.time_factor_hundredths ?? 1000,
    };
    await measureCall(
        'set_world_config',
        ctx,
        Config,
        'set_world_config',
        [tweaked],
        admin,
        { refreshTimestamp: false }
    );
    mark(state, 'setWorldConfig');

    world = (await loadWorld(ctx)) ?? worldZero();
    if (world.paused) {
        await measureCall('unpause', ctx, Admin, 'unpause', [world], admin, {
            refreshTimestamp: false,
        });
        world = (await loadWorld(ctx)) ?? worldZero();
    }
    await measureCall('pause', ctx, Admin, 'pause', [world], admin, {
        refreshTimestamp: false,
    });
    mark(state, 'pauseGame');
    world = (await loadWorld(ctx)) ?? worldZero();

    // Assert a player write fails while paused.
    const locationId = homeLocationId(0);
    const planet = await loadPlanet(ctx, locationId);
    if (planet) {
        const timestamp = await getL2BlockTimestamp(ctx);
        let failed = false;
        try {
            await Core.methods
                .buy_hat(locationId, timestamp, planet, world)
                .send(ctx.sendOpts(user));
        } catch {
            failed = true;
        }
        if (!failed) {
            throw new Error('Expected buy_hat to fail while world is paused');
        }
        console.log('   pause correctly blocked buy_hat');
    }

    world = (await loadWorld(ctx)) ?? worldZero();
    await measureCall('unpause', ctx, Admin, 'unpause', [world], admin, {
        refreshTimestamp: false,
    });
    mark(state, 'unpauseGame');
}

async function phaseInvariants(state: ScenarioState): Promise<void> {
    const { ctx } = state;
    for (let i = 0; i < ctx.accounts.users.length; i++) {
        const user = ctx.accounts.users[i]!;
        if (!(await isPlayerInitialized(ctx, user))) {
            throw new Error(`Invariant: user${i + 1} not initialized`);
        }
    }

    if (
        state.transferredPlanetLocation != null &&
        state.transferredPlanetOwner != null
    ) {
        const planet = await loadPlanetFromStorage(
            ctx,
            state.transferredPlanetLocation
        );
        if (!planet) {
            throw new Error('Invariant: transferred planet missing');
        }
        const owner = String(planet.owner).toLowerCase();
        const expected = state.transferredPlanetOwner.toString().toLowerCase();
        if (owner !== expected) {
            throw new Error(
                `Invariant: transferred planet owner ${owner} != ${expected}`
            );
        }
    }

    const world = (await loadWorld(ctx)) ?? worldZero();
    if (world.paused) {
        throw new Error('Invariant: world left paused');
    }

    console.log('\nSCENARIO coverage checklist:');
    for (const name of PLAYER_COVERAGE_TARGETS) {
        if (state.covered.has(name)) {
            console.log(`  [ok]   ${name}`);
        } else if (state.skipped.has(name)) {
            console.log(`  [skip] ${name} — ${state.skipped.get(name)}`);
        } else {
            console.log(`  [miss] ${name}`);
        }
    }
    for (const [name, reason] of state.skipped) {
        if (!(PLAYER_COVERAGE_TARGETS as readonly string[]).includes(name)) {
            console.log(`  [skip] ${name} — ${reason}`);
        }
    }
}

async function main(): Promise<void> {
    console.log('🔗 5-player compressed scenario (not wall-clock 48h)...\n');
    const ctx = await getTestContext();
    if (ctx.accounts.users.length < 5) {
        throw new Error(
            `Need at least 5 users (got ${ctx.accounts.users.length}). Set TEST_USER_COUNT=5.`
        );
    }
    console.log(
        `✅ Network ${ctx.network}; users=${ctx.accounts.users.length}; fee=${ctx.feeMode}`
    );

    const state: ScenarioState = {
        ctx,
        covered: new Set(),
        skipped: new Map(),
        transferredPlanetLocation: null,
        transferredPlanetOwner: null,
    };

    await runPhase('fast_preset', () => phaseFastPreset(state));
    await runPhase('init', () => phaseInit(state));
    await runPhase('expand', () => phaseExpand(state));
    await runPhase('contend', () => phaseContend(state));
    await runPhase('artifacts', () => phaseArtifacts(state));
    await runPhase('admin', () => phaseAdmin(state));
    await runPhase('invariants', () => phaseInvariants(state));

    console.log('\n✅ SCENARIO SUCCESS — 5p compressed harness finished');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
