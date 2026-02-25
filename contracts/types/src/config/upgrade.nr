use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct Upgrade {
    pub pop_cap_multiplier: u128,
    pub pop_gro_multiplier: u128,
    pub range_multiplier: u128,
    pub speed_multiplier: u128,
    pub def_multiplier: u128,
}

impl Upgrade {
    pub fn zero() -> Self {
        Self {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: 100,
        }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct UpgradeConfig {
    pub silver_cost_percent: u128,
    pub max_total_level_nebula: u8,
    pub max_total_level_space: u8,
    pub max_total_level_deep_space: u8,
    pub max_total_level_dead_space: u8,
    pub max_branch_level: u8,
}

impl UpgradeConfig {
    pub fn zero() -> Self {
        Self {
            silver_cost_percent: 20,
            max_total_level_nebula: 3,
            max_total_level_space: 4,
            max_total_level_deep_space: 5,
            max_total_level_dead_space: 5,
            max_branch_level: 4,
        }
    }
}
