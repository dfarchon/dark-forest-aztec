use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

// ========== Enums ==========
// Note: Enums don't have derive attributes - they're for type safety only
// Structs store enum values as u8



// ========== Structs ==========

#[derive(Serialize, Deserialize, Packable)]
pub struct Upgrade {
    pub pop_cap_multiplier: u128,
    pub pop_gro_multiplier: u128,
    pub range_multiplier: u128,
    pub speed_multiplier: u128,
    pub def_multiplier: u128,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetDefaultStats {
    pub population_cap: u128,
    pub population_growth: u128,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub silver_growth: u128,
    pub silver_cap: u128,
    pub barbarian_percentage: u128,
}

