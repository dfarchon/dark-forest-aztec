use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct GameConfig {
    pub max_natural_planet_level: u8,
    pub perlin_threshold_1: u8,
    pub perlin_threshold_2: u8,
    pub perlin_threshold_3: u8,
    pub init_perlin_min: u8,
    pub init_perlin_max: u8,
    pub biome_threshold_1: u8,
    pub biome_threshold_2: u8,

    pub planet_level_thresholds: [u128; 10],
    pub planet_rarity: u128,
    pub max_location_id: Field,

    /// Dimensions: [4][10][5]
    pub planet_type_weights: [[[u128; 5]; 10]; 4],
}

impl GameConfig {
    pub fn zero() -> Self {
        Self {
            max_natural_planet_level: 9,
            perlin_threshold_1: 14,
            perlin_threshold_2: 15,
            perlin_threshold_3: 19,
            init_perlin_min: 13,
            init_perlin_max: 14,
            biome_threshold_1: 15,
            biome_threshold_2: 17,
            planet_level_thresholds: [
                16_777_216, 4_194_292, 1_048_561, 262_128, 65_520, 16_368, 4_080, 1_008, 240, 48,
            ],
            planet_rarity: 16_384,
            max_location_id: 0xc19139cb84c680a6e14116da06056174a0cfa121e6e5c2450f87d64fc000,
            planet_type_weights: [
                [
                    [1, 0, 0, 0, 0],
                    [13, 2, 0, 1, 0],
                    [13, 2, 0, 1, 0],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                ],
                [
                    [1, 0, 0, 0, 0],
                    [13, 2, 1, 0, 0],
                    [12, 2, 1, 1, 0],
                    [11, 2, 1, 1, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                ],
                [
                    [1, 0, 0, 0, 0],
                    [10, 4, 2, 0, 0],
                    [10, 4, 1, 1, 0],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                ],
                [
                    [1, 0, 0, 0, 0],
                    [11, 4, 1, 0, 0],
                    [11, 4, 1, 0, 0],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                ],
            ],
        }
    }
}

/// A split-out subset of `GameConfig` that is cheap to store in public state.
/// This is intentionally kept small to avoid hitting the public storage write limit.
/// Aztec protocol: MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX = 63 (@aztec/constants).
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct GameConfigCore {
    pub max_natural_planet_level: u8,
    pub perlin_threshold_1: u8,
    pub perlin_threshold_2: u8,
    pub perlin_threshold_3: u8,
    pub init_perlin_min: u8,
    pub init_perlin_max: u8,
    pub biome_threshold_1: u8,
    pub biome_threshold_2: u8,
    pub planet_rarity: u128,
    pub max_location_id: Field,
}

impl GameConfigCore {
    pub fn zero() -> Self {
        Self {
            max_natural_planet_level: 9,
            perlin_threshold_1: 14,
            perlin_threshold_2: 15,
            perlin_threshold_3: 19,
            init_perlin_min: 13,
            init_perlin_max: 14,
            biome_threshold_1: 15,
            biome_threshold_2: 17,
            planet_rarity: 16_384,
            max_location_id: 0xc19139cb84c680a6e14116da06056174a0cfa121e6e5c2450f87d64fc000,
        }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetLevelThresholds {
    pub thresholds: [u128; 10],
}

impl PlanetLevelThresholds {
    pub fn zero() -> Self {
        Self {
            thresholds: [
                16_777_216, 4_194_292, 1_048_561, 262_128, 65_520, 16_368, 4_080, 1_008, 240, 48,
            ],
        }
    }
}

/// One "tier" of the planet type weights table.
/// Dimensions: [10][5] = 50 entries.
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetTypeWeightsTier {
    pub weights: [[u128; 5]; 10],
}

impl PlanetTypeWeightsTier {
    pub fn zero(tier: u8) -> Self {
        // NOTE: each tier is 10x5 (50 entries) to keep storage writes under limits.
        if tier == 0 {
            Self {
                weights: [
                    [1, 0, 0, 0, 0],
                    [13, 2, 0, 1, 0],
                    [13, 2, 0, 1, 0],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                    [13, 2, 0, 0, 1],
                ],
            }
        } else if tier == 1 {
            Self {
                weights: [
                    [1, 0, 0, 0, 0],
                    [13, 2, 1, 0, 0],
                    [12, 2, 1, 1, 0],
                    [11, 2, 1, 1, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                    [12, 2, 1, 0, 1],
                ],
            }
        } else if tier == 2 {
            Self {
                weights: [
                    [1, 0, 0, 0, 0],
                    [10, 4, 2, 0, 0],
                    [10, 4, 1, 1, 0],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                    [8, 4, 1, 2, 1],
                ],
            }
        } else if tier == 3 {
            Self {
                weights: [
                    [1, 0, 0, 0, 0],
                    [11, 4, 1, 0, 0],
                    [11, 4, 1, 0, 0],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                    [7, 4, 2, 2, 1],
                ],
            }
        } else {
            assert(false, "tier must be 0..=3");
            Self { weights: [[0, 0, 0, 0, 0]; 10] }
        }
    }
}
