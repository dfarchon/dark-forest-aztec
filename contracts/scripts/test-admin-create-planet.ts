/**
 * Script for testing Admin.create_planet.
 * After create_planet, reads planet data from storage contract events (PlanetMetaUpdated, PlanetOwnerUpdated, etc.).
 *
 * Run: pnpm exec tsx scripts/test-admin-create-planet.ts
 */
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { PlanetCapsStorageContract } from './artifacts/PlanetCapsStorage.ts';
import { PlanetMetaStorageContract } from './artifacts/PlanetMetaStorage.ts';
import { PlanetModsStorageContract } from './artifacts/PlanetModsStorage.ts';
import { PlanetOwnerStorageContract } from './artifacts/PlanetOwnerStorage.ts';
import { PlanetResourcesStorageContract } from './artifacts/PlanetResourcesStorage.ts';
import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import { getTestContext, type TestContext } from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** create_planet args (matches AdminCreatePlanetArgs). */
type CreatePlanetArgs = {
    location: bigint;
    perlin: number;
    level: number;
    planet_type: number;
    require_valid_location_id: boolean;
};

/**
 * Planet type aligned with types/src/storage/planet.nr (Planet = meta + owner + caps + resources + mods).
 * Used to merge the 5 event payloads into one object for unified print.
 */
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

/** Build a single Planet from the 5 storage event states (missing parts filled with defaults). */
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

/** Read planet from storage events, merge into one Planet, and print as JSON. */
async function readPlanetFromEvents(
    ctx: TestContext,
    blockNumber: number,
    locationId: bigint
): Promise<void> {
    const from = blockNumber;
    const limit = 1;

    const metaEvents = await getDecodedPublicEvents<
        { id: unknown; block_number: number; state: { location_id: unknown; perlin: unknown; created_at: unknown } }
    >(ctx.node, PlanetMetaStorageContract.events.PlanetMetaUpdated, from, limit);
    const meta = metaEvents.filter((e) => String(e.id) === String(locationId)).pop()?.state;

    const ownerEvents = await getDecodedPublicEvents<
        { id: unknown; block_number: number; state: Record<string, unknown> }
    >(ctx.node, PlanetOwnerStorageContract.events.PlanetOwnerUpdated, from, limit);
    const owner = ownerEvents.filter((e) => String(e.id) === String(locationId)).pop()?.state;

    const capsEvents = await getDecodedPublicEvents<
        { id: unknown; block_number: number; state: Record<string, unknown> }
    >(ctx.node, PlanetCapsStorageContract.events.PlanetCapsUpdated, from, limit);
    const caps = capsEvents.filter((e) => String(e.id) === String(locationId)).pop()?.state;

    const resourcesEvents = await getDecodedPublicEvents<
        { id: unknown; block_number: number; state: Record<string, unknown> }
    >(ctx.node, PlanetResourcesStorageContract.events.PlanetResourcesUpdated, from, limit);
    const resources = resourcesEvents.filter((e) => String(e.id) === String(locationId)).pop()?.state;

    const modsEvents = await getDecodedPublicEvents<
        { id: unknown; block_number: number; state: Record<string, unknown> }
    >(ctx.node, PlanetModsStorageContract.events.PlanetModsUpdated, from, limit);
    const mods = modsEvents.filter((e) => String(e.id) === String(locationId)).pop()?.state;

    if (!meta) {
        throw new Error(`Planet meta not found for location_id=${locationId} in block ${blockNumber}`);
    }
    if (!owner) {
        throw new Error(`Planet owner not found for location_id=${locationId} in block ${blockNumber}`);
    }
    if (!caps) {
        throw new Error(`Planet caps not found for location_id=${locationId} in block ${blockNumber}`);
    }
    if (!resources) {
        throw new Error(`Planet resources not found for location_id=${locationId} in block ${blockNumber}`);
    }
    if (!mods) {
        throw new Error(`Planet mods not found for location_id=${locationId} in block ${blockNumber}`);
    }

    const planet = mergeToPlanet(locationId, meta, owner, caps, resources, mods);

    console.log('\n🌍 Planet (location_id =', String(locationId), ', block =', blockNumber, ')');
    console.log(JSON.stringify(planet, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2));
    console.log('');
}

async function main() {
    console.log('🔗 Loading test context (admin + 2 users, contracts)...\n');
    const ctx: TestContext = await getTestContext();

    const Admin = ctx.contracts['Admin'];
    if (!Admin) {
        throw new Error('Admin contract not loaded');
    }

    const { admin } = ctx.accounts;
    const sendOpts = ctx.sendOpts;

    console.log('✅ Admin contract at:', Admin.address.toString());
    console.log('✅ Admin account:', admin.toString());

    const args: CreatePlanetArgs = {
        location: 2n,
        perlin: 13,
        level: 0,
        planet_type: 0,
        require_valid_location_id: false,
    };

    console.log('\n🪐 Calling Admin.create_planet() with args:', args);

    try {
        const tx = await Admin.methods.create_planet(args).send(sendOpts(admin));
        const receipt = await tx.wait();
        const blockNumber =
            receipt && typeof (receipt as { blockNumber?: number }).blockNumber !== 'undefined'
                ? Number((receipt as { blockNumber: number }).blockNumber)
                : undefined;

        console.log('   ✅ create_planet transaction committed.');
        if (blockNumber !== undefined) {
            console.log('   blockNumber:', blockNumber);
            await readPlanetFromEvents(ctx, blockNumber, args.location);
        } else {
            console.warn('   Could not get blockNumber from receipt; skipping event read.');
        }
    } catch (error) {
        console.error('Error while calling Admin.create_planet():', error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
