/**
 * Zero-state constructors for Aztec contract inputs.
 * When an entity doesn't exist on-chain yet, pass its zero state.
 * Matches patterns from contracts/scripts/test-move.ts and test-core-initialize-player.ts.
 */

const AZTEC_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function worldZero(): Record<string, unknown> {
  return {
    paused: false,
    planet_events_count: 0n,
    radius: 53_000n,
    misc_nonce: 0n,
    planet_ids_count: 0n,
    revealed_planet_ids_count: 0n,
    player_ids_count: 0n,
    next_change_block: 0,
  };
}

export function playerZero(): Record<string, unknown> {
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

export function planetZero(): Record<string, unknown> {
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

export function planetEventsZero(): Record<string, unknown> {
  return {
    events: Array.from({ length: 20 }, () => ({ id: 0 })),
    count: 0,
    last_updated: 0,
  };
}

export function planetArtifactsZero(): Record<string, unknown> {
  return {
    ids: Array.from({ length: 20 }, () => 0n),
    count: 0,
    last_updated: 0,
  };
}

export function arrivalZero(): Record<string, unknown> {
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

export function artifactZero(): Record<string, unknown> {
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
    controller: AZTEC_ZERO,
    last_updated: 0,
  };
}

export function artifactLocationZero(): Record<string, unknown> {
  return {
    planet_id: 0n,
    voyage_id: 0n,
    last_updated: 0,
  };
}
