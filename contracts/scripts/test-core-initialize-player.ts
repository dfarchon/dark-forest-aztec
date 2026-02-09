/**
 * Script for testing Core.initialize_player (private).
 * Prerequisites: deploy, configure, and create at least one planet (e.g. run test-admin-create-planet.ts).
 * After commit, reads planet and player state from storage events.
 *
 * Run: pnpm exec tsx scripts/test-core-initialize-player.ts
 */
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { GlobalStateStorageContract } from './artifacts/GlobalStateStorage.ts';
import { PlanetCapsStorageContract } from './artifacts/PlanetCapsStorage.ts';
import { PlanetMetaStorageContract } from './artifacts/PlanetMetaStorage.ts';
import { PlanetModsStorageContract } from './artifacts/PlanetModsStorage.ts';
import { PlanetOwnerStorageContract } from './artifacts/PlanetOwnerStorage.ts';
import { PlanetResourcesStorageContract } from './artifacts/PlanetResourcesStorage.ts';
import { PlayerStorageContract } from './artifacts/PlayerStorage.ts';
import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import { getTestContext, type TestContext } from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

type GlobalStateShape = {
    paused: boolean;
    planet_events_count: bigint | number;
    world_radius: bigint | number;
    misc_nonce: bigint | number;
    planet_ids_count: bigint | number;
    revealed_planet_ids_count: bigint | number;
    player_ids_count: bigint | number;
    next_change_block: bigint | number;
};

async function loadGlobalState(ctx: TestContext): Promise<GlobalStateShape> {
    const GlobalStateStorage = ctx.contracts['GlobalStateStorage'];
    if (!GlobalStateStorage) throw new Error('GlobalStateStorage contract not loaded');

    const latestBlock = Number(await ctx.node.getBlockNumber());
    try {
        const events = await getDecodedPublicEvents(
            ctx.node,
            GlobalStateStorageContract.events.GlobalStateUpdated,
            0,
            latestBlock + 1
        );
        if (events.length > 0) {
            const last = events[events.length - 1] as { state?: GlobalStateShape };
            if (last.state) return last.state;
        }
    } catch (err) {
        console.warn('[loadGlobalState] failed to decode events:', err);
    }

    const defaultState = await GlobalStateStorage.methods
        .get_default_global_state_unconstrained()
        .simulate({ from: ctx.accounts.admin });
    return defaultState as GlobalStateShape;
}

// ----- Helpers to read planet/player from events (same pattern as test-admin-create-planet) -----
type Planet = {
    location_id: string;
    perlin: number;
    created_at: string | number;
    owner: string;
    planet_level: number;
    planet_type: number;
    space_type: number;
    is_home_planet: boolean;
    is_initialized: boolean;
    destroyed: boolean;
    invader: string;
    capturer: string;
    invade_start_block: number;
    population_cap: string | number;
    population_growth: string | number;
    range: string | number;
    speed: string | number;
    defense: string | number;
    silver_cap: string | number;
    silver_growth: string | number;
    population: string | number;
    silver: string | number;
    upgrade_state_0: number;
    upgrade_state_1: number;
    upgrade_state_2: number;
    last_updated: string | number;
    pausers: string | number;
    energy_gro_doublers: string | number;
    silver_gro_doublers: string | number;
    hat_level: string | number;
    space_junk: string | number;
    has_tried_finding_artifact: boolean;
    prospected_block_number: number;
};

function toStr(v: unknown): string {
    if (typeof v === 'bigint') return String(v);
    if (v === undefined || v === null) return '';
    return String(v);
}
function toNum(v: unknown): number {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'bigint') return Number(v);
    return Number(v);
}

function mergeToPlanet(
    locationId: bigint,
    meta: { location_id: unknown; perlin: unknown; created_at: unknown } | undefined,
    owner: Record<string, unknown> | undefined,
    caps: Record<string, unknown> | undefined,
    resources: Record<string, unknown> | undefined,
    mods: Record<string, unknown> | undefined
): Planet {
    return {
        location_id: toStr(locationId),
        perlin: meta ? toNum(meta.perlin) : 0,
        created_at: meta ? toStr(meta.created_at) || 0 : 0,
        owner: owner ? toStr(owner.owner) : '',
        planet_level: owner ? toNum(owner.planet_level) : 0,
        planet_type: owner ? toNum(owner.planet_type) : 0,
        space_type: owner ? toNum(owner.space_type) : 0,
        is_home_planet: owner ? Boolean(owner.is_home_planet) : false,
        is_initialized: owner ? Boolean(owner.is_initialized) : false,
        destroyed: owner ? Boolean(owner.destroyed) : false,
        invader: owner ? toStr(owner.invader) : '',
        capturer: owner ? toStr(owner.capturer) : '',
        invade_start_block: owner ? toNum(owner.invade_start_block) : 0,
        population_cap: caps ? toStr(caps.population_cap) || 0 : 0,
        population_growth: caps ? toStr(caps.population_growth) || 0 : 0,
        range: caps ? toStr(caps.range) || 0 : 0,
        speed: caps ? toStr(caps.speed) || 0 : 0,
        defense: caps ? toStr(caps.defense) || 0 : 0,
        silver_cap: caps ? toStr(caps.silver_cap) || 0 : 0,
        silver_growth: caps ? toStr(caps.silver_growth) || 0 : 0,
        population: resources ? toStr(resources.population) || 0 : 0,
        silver: resources ? toStr(resources.silver) || 0 : 0,
        upgrade_state_0: resources ? toNum(resources.upgrade_state_0) : 0,
        upgrade_state_1: resources ? toNum(resources.upgrade_state_1) : 0,
        upgrade_state_2: resources ? toNum(resources.upgrade_state_2) : 0,
        last_updated: resources ? toStr(resources.last_updated) || 0 : 0,
        pausers: mods ? toStr(mods.pausers) || 0 : 0,
        energy_gro_doublers: mods ? toStr(mods.energy_gro_doublers) || 0 : 0,
        silver_gro_doublers: mods ? toStr(mods.silver_gro_doublers) || 0 : 0,
        hat_level: mods ? toStr(mods.hat_level) || 0 : 0,
        space_junk: mods ? toStr(mods.space_junk) || 0 : 0,
        has_tried_finding_artifact: mods ? Boolean(mods.has_tried_finding_artifact) : false,
        prospected_block_number: mods ? toNum(mods.prospected_block_number) : 0,
    };
}

/** Player state shape (from events / types/storage/player.nr). */
type PlayerFromEvents = {
    is_initialized: boolean;
    player: string;
    init_timestamp: string | number;
    home_planet_id: string;
    last_reveal_timestamp: string | number;
    score: string | number;
    space_junk: string | number;
    space_junk_limit: string | number;
    claimed_ships: boolean;
};

/** Read player from PlayerStorage.PlayerUpdated events in the given block and print as JSON. */
async function readPlayerFromEvents(
    ctx: TestContext,
    blockNumber: number,
    user: AztecAddress
): Promise<void> {
    const from = blockNumber;
    const limit = 1;
    const userStr = user.toString();

    const events = await getDecodedPublicEvents<{
        player: unknown;
        block_number: unknown;
        state: Record<string, unknown>;
    }>(ctx.node, PlayerStorageContract.events.PlayerUpdated, from, limit);

    const ev = events.filter((e) => toStr(e.player) === userStr).pop();
    if (!ev?.state) {
        console.log('\n⚠️ No PlayerUpdated event for', userStr, 'in block', blockNumber);
        return;
    }
    const s = ev.state;
    const player: PlayerFromEvents = {
        is_initialized: Boolean(s.is_initialized),
        player: toStr(s.player),
        init_timestamp: toStr(s.init_timestamp) || 0,
        home_planet_id: toStr(s.home_planet_id ?? 0),
        last_reveal_timestamp: toStr(s.last_reveal_timestamp) || 0,
        score: toStr(s.score) || 0,
        space_junk: toStr(s.space_junk) || 0,
        space_junk_limit: toStr(s.space_junk_limit) || 0,
        claimed_ships: Boolean(s.claimed_ships),
    };
    console.log('\n👤 Player (from events, address =', userStr, ', block =', blockNumber, ')');
    console.log(JSON.stringify(player, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2));
}

/** Read planet from storage events in the given block and print as JSON. */
async function readPlanetFromEvents(
    ctx: TestContext,
    blockNumber: number,
    locationId: bigint
): Promise<void> {
    const from = blockNumber;
    const limit = 1;

    const meta = (await getDecodedPublicEvents<{ id: unknown; state: { location_id: unknown; perlin: unknown; created_at: unknown } }>(ctx.node, PlanetMetaStorageContract.events.PlanetMetaUpdated, from, limit))
        .filter((e) => String(e.id) === String(locationId))
        .pop()?.state;
    const owner = (await getDecodedPublicEvents<{ id: unknown; state: Record<string, unknown> }>(ctx.node, PlanetOwnerStorageContract.events.PlanetOwnerUpdated, from, limit))
        .filter((e) => String(e.id) === String(locationId))
        .pop()?.state;
    const caps = (await getDecodedPublicEvents<{ id: unknown; state: Record<string, unknown> }>(ctx.node, PlanetCapsStorageContract.events.PlanetCapsUpdated, from, limit))
        .filter((e) => String(e.id) === String(locationId))
        .pop()?.state;
    const resources = (await getDecodedPublicEvents<{ id: unknown; state: Record<string, unknown> }>(ctx.node, PlanetResourcesStorageContract.events.PlanetResourcesUpdated, from, limit))
        .filter((e) => String(e.id) === String(locationId))
        .pop()?.state;
    const mods = (await getDecodedPublicEvents<{ id: unknown; state: Record<string, unknown> }>(ctx.node, PlanetModsStorageContract.events.PlanetModsUpdated, from, limit))
        .filter((e) => String(e.id) === String(locationId))
        .pop()?.state;

    const planet = mergeToPlanet(locationId, meta, owner, caps, resources, mods);
    console.log('\n🌍 Planet (from events, location_id =', String(locationId), ', block =', blockNumber, ')');
    console.log(JSON.stringify(planet, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2));
}

export type ValidateInitializePlayerResult = { ok: true } | { ok: false; reason: string };

/**
 * Local validation mirroring Core.initialize_player_public + check_player_init.
 * Returns { ok: true } or { ok: false, reason } so caller can skip sending the tx when invalid.
 */
async function validateBeforeInitializePlayer(
    ctx: TestContext,
    params: {
        user: AztecAddress;
        locationId: bigint;
        perlin: number;
        level: number;
        radius: number;
        snarkConstants: Record<string, unknown>;
        planetOwnerState: Record<string, unknown>;
        playerState: Record<string, unknown>;
        globalState: GlobalStateShape;
    }
): Promise<ValidateInitializePlayerResult> {
    const Config = ctx.contracts['Config'];
    const PlayerStorage = ctx.contracts['PlayerStorage'];
    if (!Config || !PlayerStorage) return { ok: false, reason: 'Config or PlayerStorage not loaded' };

    const chainSnark = await Config.methods.get_snark_constants_public().simulate({ from: params.user });
    if (params.snarkConstants.disable_zk_checks !== chainSnark.disable_zk_checks) {
        return { ok: false, reason: 'Disable zk checks is not valid (must match Config)' };
    }

    const player_is_valid = await PlayerStorage.methods.verify_unconstrained(params.user, params.playerState).simulate({ from: params.user });
    if (!player_is_valid) {
        return { ok: false, reason: 'Player state is not valid (player is already initialized in storage)' };
    }

    if (params.playerState.is_initialized) {
        return { ok: false, reason: 'Player is already initialized (player_state.is_initialized must be false)' };
    }

    const worldRadius = BigInt(Number(params.globalState.world_radius ?? 53_000));
    const radiusBig = BigInt(params.radius);
    if (radiusBig > worldRadius) {
        return { ok: false, reason: `Init radius is bigger than the current world radius (radius=${params.radius}, world_radius=${worldRadius})` };
    }

    const worldConfig = await Config.methods.get_world_config_public().simulate({ from: params.user }) as { spawn_rim_area?: bigint | number };
    const gameConfigCore = await Config.methods.get_game_config_core_public().simulate({ from: params.user }) as { init_perlin_min?: number; init_perlin_max?: number };
    const spawnRimArea = BigInt(Number(worldConfig.spawn_rim_area ?? 0));
    if (spawnRimArea !== 0n) {
        const radiusSqPi = (radiusBig * radiusBig * 314n) / 100n;
        const worldRadiusSqPi = (worldRadius * worldRadius * 314n) / 100n;
        if (radiusSqPi + spawnRimArea < worldRadiusSqPi) {
            return { ok: false, reason: 'Player can only spawn at the universe rim (radius_squared_times_pi + spawn_rim_area < world_radius_squared_times_pi)' };
        }
    }

    const initPerlinMin = Number(gameConfigCore.init_perlin_min ?? 0);
    const initPerlinMax = Number(gameConfigCore.init_perlin_max ?? 255);
    if (params.perlin < initPerlinMin) {
        return { ok: false, reason: `Init not allowed in perlin value less than INIT_PERLIN_MIN (perlin=${params.perlin}, init_perlin_min=${initPerlinMin})` };
    }
    if (params.perlin >= initPerlinMax) {
        return { ok: false, reason: `Init not allowed in perlin value greater than or equal to INIT_PERLIN_MAX (perlin=${params.perlin}, init_perlin_max=${initPerlinMax})` };
    }

    return { ok: true };
}

async function main() {
    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    const Core = ctx.contracts['Core'];
    const Config = ctx.contracts['Config'];
    if (!Core || !Config) {
        throw new Error('Core or Config contract not loaded');
    }

    const { admin, users } = ctx.accounts;
    const sendOpts = ctx.sendOpts;
    const user = users[0];

    console.log('✅ Core at:', Core.address.toString());
    console.log('✅ Config at:', Config.address.toString());
    console.log('✅ Player (user1):', user.toString());

    // location_id must yield level=0 and planet_type=0 in get_planet_level_type_and_space_type (contract assert).
    // - Level 0: bytes 4–6 (BE) of location_id = 24-bit value in [thresholds[1], thresholds[0]) = [4_194_292, 16_777_216).
    //   So any V in 4_194_292..16_777_215 works; put in high bits: (V << 216n).
    // - planet_type=0: for level 0 the weights are [1,0,0,0,0], so any byte 8 is OK (PlanetType::Planet).
    // Other valid level-0 location_ids (same formula, different V):
    //   (4_194_292n << 216n) | (255n << 64n)
    //   (5_000_000n << 216n) | (255n << 64n)
    //   (7_000_000n << 216n) | (255n << 64n)
    //   (12_000_000n << 216n) | (255n << 64n)
    //   (16_777_215n << 216n) | (255n << 64n)
    const locationId = (10_000_000n << 216n) | (255n << 64n); // user[0]
    // const locationId = (4_194_292n << 216n) | (255n << 64n); // user[1]
    const level = 0;

    console.log('\n📥 Loading global state, config, and snark constants...');
    const globalState = await loadGlobalState(ctx);
    const radius = 0;
    const snarkConstants = await Config.methods.get_snark_constants_public().simulate({ from: user });
    const gameConfigCore = await Config.methods.get_game_config_core_public().simulate({ from: user }) as { init_perlin_min?: number; init_perlin_max?: number };
    const perlin = Number(gameConfigCore.init_perlin_min ?? 13);

    console.log('📥 Loading default planet owner state from PlanetOwnerStorage...');
    const PlanetOwnerStorage = ctx.contracts['PlanetOwnerStorage'];
    if (!PlanetOwnerStorage) throw new Error('PlanetOwnerStorage contract not loaded');
    const planetOwnerState = await PlanetOwnerStorage.methods.get_default_planet_owner_unconstrained().simulate({ from: user });

    const PlayerStorage = ctx.contracts['PlayerStorage'];
    if (!PlayerStorage) throw new Error('PlayerStorage contract not loaded');
    const defaultPlayer = await PlayerStorage.methods.get_default_player_unconstrained().simulate({ from: user });
    const playerState = defaultPlayer;

    console.log('\n🔍 Validating locally (mirror of Core + check_player_init)...');
    const validation = await validateBeforeInitializePlayer(ctx, {
        user,
        locationId,
        perlin,
        level,
        radius,
        snarkConstants,
        planetOwnerState,
        playerState,
        globalState,
    });
    if (!validation.ok) {
        console.error('   ❌ Validation failed:', validation.reason);
        return;
    }
    console.log('   ✅ Local validation passed.');

    const x = 0n;
    const y = 0n;

    console.log('\n🎮 Calling Core.initialize_player() (private)...');
    console.log('   x =', String(x), ', y =', String(y), ', location_id =', String(locationId), ', perlin =', perlin, ', level =', level, ', radius =', radius);

    const initPlayerArgs = [
        x,
        y,
        radius,
        locationId,
        perlin,
        level,
        snarkConstants,
        planetOwnerState,
        playerState,
        globalState,
    ] as const;

    console.log('   Simulating first...');
    try {
        console.log('\n\n\n\n\n');
        console.log('   ✅ Simulating initialize_player...');
        console.log(initPlayerArgs);

        const playerStateRoot = await PlayerStorage.methods.get_state_root(user).simulate({ from: user });
        console.log('   ✅ playerStateRoot:', playerStateRoot);
        console.log('\n\n\n\n\n');
        const res = await PlayerStorage.methods.verify(user, playerState).simulate({ from: user });
        console.log('   ✅ verify succeeded:', res);
        if (!res) {
            console.error('   ❌ verify failed:', res);
            return;
        }

        await Core.methods.initialize_player(...initPlayerArgs).simulate(sendOpts(user));
        console.log('   ✅ Simulate clear.');
    } catch (simErr: unknown) {
        const msg = simErr instanceof Error ? simErr.message : String(simErr);
        console.error('   ❌ Simulate failed:', msg);
        if (simErr instanceof Error && simErr.stack) console.error(simErr.stack);
        return;
    }

    try {
        const tx = await Core.methods.initialize_player(...initPlayerArgs).send(sendOpts(user));
        const receipt = await tx.wait();
        console.log('   ✅ initialize_player committed.');
        const blockNumber =
            receipt && typeof (receipt as { blockNumber?: number }).blockNumber !== 'undefined'
                ? Number((receipt as { blockNumber: number }).blockNumber)
                : undefined;
        if (blockNumber !== undefined) {
            console.log('   blockNumber:', blockNumber);
            await readPlanetFromEvents(ctx, blockNumber, locationId);
            await readPlayerFromEvents(ctx, blockNumber, user);
        } else {
            console.warn('   Could not get blockNumber from receipt; skipping event read.');
        }
    } catch (error) {
        console.error('Error calling Core.initialize_player():', error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
