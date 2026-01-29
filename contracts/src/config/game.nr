use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// # Game configuration
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct GameConfig {
    pub max_natural_planet_level: u128,
    pub perlin_threshold_1: u128,
    pub perlin_threshold_2: u128,
    pub perlin_threshold_3: u128,
    pub init_perlin_min: u128,
    pub init_perlin_max: u128,
    pub biome_threshold_1: u128,
    pub biome_threshold_2: u128,

    pub planet_level_thresholds: [u128; 10],
    pub planet_rarity: u128,

    /// Dimensions: [4][10][5]
    pub planet_type_weights: [[[u128; 5]; 10]; 4],
}

/// A split-out subset of `GameConfig` that is cheap to store in public state.
/// This is intentionally kept small to avoid hitting the public storage write limit.
/// Aztec protocol: MAX_PUBLIC_DATA_UPDATE_REQUESTS_PER_TX = 63 (@aztec/constants).
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct GameConfigCore {
    pub max_natural_planet_level: u128,
    pub perlin_threshold_1: u128,
    pub perlin_threshold_2: u128,
    pub perlin_threshold_3: u128,
    pub init_perlin_min: u128,
    pub init_perlin_max: u128,
    pub biome_threshold_1: u128,
    pub biome_threshold_2: u128,
    pub planet_rarity: u128,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetLevelThresholds {
    pub thresholds: [u128; 10],
}

/// One "tier" of the planet type weights table.
/// Dimensions: [10][5] = 50 entries.
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetTypeWeightsTier {
    pub weights: [[u128; 5]; 10],
}

impl GameConfig {
    pub fn default_dark_forest() -> Self {
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
                16_777_216,
                4_194_292,
                1_048_561,
                262_128,
                65_520,
                16_368,
                4_080,
                1_008,
                240,
                48,
            ],
            planet_rarity: 16_384,
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

    /// Default core parameters (everything except the large tables).
    pub fn default_dark_forest_core() -> GameConfigCore {
        GameConfigCore {
            max_natural_planet_level: 9,
            perlin_threshold_1: 14,
            perlin_threshold_2: 15,
            perlin_threshold_3: 19,
            init_perlin_min: 13,
            init_perlin_max: 14,
            biome_threshold_1: 15,
            biome_threshold_2: 17,
            planet_rarity: 16_384,
        }
    }

    pub fn default_dark_forest_planet_level_thresholds() -> PlanetLevelThresholds {
        PlanetLevelThresholds {
            thresholds: [
                16_777_216,
                4_194_292,
                1_048_561,
                262_128,
                65_520,
                16_368,
                4_080,
                1_008,
                240,
                48,
            ],
        }
    }

    pub fn default_dark_forest_planet_type_weights_tier(tier: u8) -> PlanetTypeWeightsTier {
        // NOTE: each tier is 10x5 (50 entries) to keep storage writes under limits.
        let weights = if tier == 0 {
            PlanetTypeWeightsTier {
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
            PlanetTypeWeightsTier {
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
            PlanetTypeWeightsTier {
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
            PlanetTypeWeightsTier {
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
            PlanetTypeWeightsTier { weights: [[0, 0, 0, 0, 0]; 10] }
        };

        weights
    }

    // ---- getters ----
    pub fn get_max_natural_planet_level(&self) -> u128 {
        self.max_natural_planet_level
    }
    pub fn get_perlin_threshold_1(&self) -> u128 {
        self.perlin_threshold_1
    }
    pub fn get_perlin_threshold_2(&self) -> u128 {
        self.perlin_threshold_2
    }
    pub fn get_perlin_threshold_3(&self) -> u128 {
        self.perlin_threshold_3
    }
    pub fn get_init_perlin_min(&self) -> u128 {
        self.init_perlin_min
    }
    pub fn get_init_perlin_max(&self) -> u128 {
        self.init_perlin_max
    }
    pub fn get_biome_threshold_1(&self) -> u128 {
        self.biome_threshold_1
    }
    pub fn get_biome_threshold_2(&self) -> u128 {
        self.biome_threshold_2
    }
    pub fn get_planet_level_thresholds(&self) -> [u128; 10] {
        self.planet_level_thresholds
    }
    pub fn get_planet_rarity(&self) -> u128 {
        self.planet_rarity
    }
    pub fn get_planet_type_weights(&self) -> [[[u128; 5]; 10]; 4] {
        self.planet_type_weights
    }

    // ---- setters ----
    pub fn set_max_natural_planet_level(&mut self, value: u128) {
        self.max_natural_planet_level = value;
    }
    pub fn set_perlin_threshold_1(&mut self, value: u128) {
        self.perlin_threshold_1 = value;
    }
    pub fn set_perlin_threshold_2(&mut self, value: u128) {
        self.perlin_threshold_2 = value;
    }
    pub fn set_perlin_threshold_3(&mut self, value: u128) {
        self.perlin_threshold_3 = value;
    }
    pub fn set_init_perlin_min(&mut self, value: u128) {
        self.init_perlin_min = value;
    }
    pub fn set_init_perlin_max(&mut self, value: u128) {
        self.init_perlin_max = value;
    }
    pub fn set_biome_threshold_1(&mut self, value: u128) {
        self.biome_threshold_1 = value;
    }
    pub fn set_biome_threshold_2(&mut self, value: u128) {
        self.biome_threshold_2 = value;
    }
    pub fn set_planet_level_thresholds(&mut self, value: [u128; 10]) {
        self.planet_level_thresholds = value;
    }
    pub fn set_planet_rarity(&mut self, value: u128) {
        self.planet_rarity = value;
    }
    pub fn set_planet_type_weights(&mut self, value: [[[u128; 5]; 10]; 4]) {
        self.planet_type_weights = value;
    }
}

