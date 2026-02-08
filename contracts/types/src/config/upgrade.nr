use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct Upgrade {
    pub pop_cap_multiplier: u128,
    pub pop_gro_multiplier: u128,
    pub range_multiplier: u128,
    pub speed_multiplier: u128,
    pub def_multiplier: u128,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct UpgradeConfig {
    pub max_single_level: u8,
    pub max_total_level: [u8; 4],
    pub silver_cost_percent: [u8; 5],
}

impl UpgradeConfig {
    pub fn default_dark_forest() -> Self {
        Self {
            max_single_level: 4,
            max_total_level: [3, 4, 5, 5],
            silver_cost_percent: [20, 40, 60, 80, 100],
        }
    }
}
