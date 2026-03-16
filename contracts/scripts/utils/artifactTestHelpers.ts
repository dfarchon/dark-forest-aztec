/**
 * Shared helpers for artifact-related test scripts.
 *
 * NOTE: These are pure data-shape helpers and basic utils.
 * Event-loading logic is kept inside each test script so they can
 * choose between getPublicEvents / custom decoders as needed.
 */

export const AZTEC_ZERO =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

export type GenericState = Record<string, unknown>;

export function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

// ---------------------------------------------------------------------------
// Zero-value state helpers (mirror Noir storage structs)
// ---------------------------------------------------------------------------

export function planetZero(): GenericState {
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

export function planetArtifactsZero(): GenericState {
    return { ids: Array(20).fill(0n), count: 0, last_updated: 0 };
}

/** Zero PlanetEvents for refresh flows (no in-flight arrivals). */
export function planetEventsZero(): GenericState {
    return { events: Array(20).fill({ id: 0n }), count: 0, last_updated: 0 };
}

export function arrivalZero(): GenericState {
    return {
        id: 0n,
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

export function artifactLocationZero(): GenericState {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

export function artifactsArrayZero(): GenericState[] {
    return Array(20).fill({
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
        controller: AZTEC_ZERO,
        last_updated: 0,
    });
}

export function playerZero(): GenericState {
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
