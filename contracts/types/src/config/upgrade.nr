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

    /// Validates config boundaries to prevent downstream array OOB panics.
    pub fn validate(self) {
        // max_single_level is used as array index into [[Upgrade; 4]; 3].
        // Levels 0..max_single_level are accessed, so max_single_level <= 4.
        assert(self.max_single_level >= 1, "max_single_level must be >= 1");
        assert(self.max_single_level <= 4, "max_single_level must be <= 4");

        // max_total_level values are used to bound the loop that indexes
        // silver_cost_percent[u8; 5] (indices 0..4), so each must be <= 5.
        // Also must be consistent: can't exceed 3 * max_single_level.
        let max_possible_total: u8 = 3 * self.max_single_level;
        for i in 0..4 {
            assert(
                self.max_total_level[i] <= 5,
                "max_total_level entry must be <= 5",
            );
            assert(
                self.max_total_level[i] <= max_possible_total,
                "max_total_level entry exceeds 3 * max_single_level",
            );
        }
    }
}
