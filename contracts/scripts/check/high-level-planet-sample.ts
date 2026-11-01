/**
 * A realistic high level planet for the state hash vectors: level 8, dead space,
 * plain location (no stat boosts), upgraded three times on the defense branch.
 *
 * Stats follow the contract math (libs `_default_planet` and `_buff_planet`) and
 * are pinned by `level8_rank3_dead_space_defense_path_stats` in
 * tests/high_level_planet/src/lib.nr. population_cap is above 2^31.
 *
 * Shared by scripts/check/state-hash-vectors.ts and client/tests/stateHash.test.ts.
 */
export const HIGH_LEVEL_PLANET_LABEL =
    'level 8, dead space, rank 3 (defense x3)';

// Full 32-byte hex, as the indexer delivers addresses.
const OWNER = `0x${'0a11ce'.padStart(64, '0')}`;
const NO_ADDRESS = `0x${'0'.repeat(64)}`;

export const HIGH_LEVEL_PLANET = {
    perlin: 30,
    created_at: 1_000_000n,
    owner: OWNER,
    planet_level: 8,
    planet_type: 0,
    space_type: 3,
    is_home_planet: false,
    is_initialized: true,
    destroyed: false,
    invader: NO_ADDRESS,
    capturer: NO_ADDRESS,
    invade_start_block: 0,
    population_cap: 2_419_200_000n,
    population_growth: 12_960n,
    range: 12_612n,
    speed: 150n,
    defense: 51n,
    silver_cap: 600_000_000n,
    silver_growth: 0n,
    population: 2_419_200_000n,
    silver: 123_456_789n,
    upgrade_state_0: 3,
    upgrade_state_1: 0,
    upgrade_state_2: 0,
    last_updated: 1_086_400n,
    pausers: 0n,
    energy_gro_doublers: 0n,
    silver_gro_doublers: 0n,
    hat_level: 0n,
    space_junk: 60n,
    has_tried_finding_artifact: false,
    prospected_block_number: 0,
};
