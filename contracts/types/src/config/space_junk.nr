use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

/// `# Space junk` section
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct SpaceJunkConfig {
    pub space_junk_enabled: bool,
    pub space_junk_limit: u128,
    pub planet_level_junk: [u128; 10],
    /// Percentage integer (e.g. 150 = 150%).
    pub abandon_speed_change_percent: u128,
    /// Percentage integer (e.g. 150 = 150%).
    pub abandon_range_change_percent: u128,
}

impl SpaceJunkConfig {
    pub fn zero() -> Self {
        Self {
            space_junk_enabled: false,
            space_junk_limit: 10000,
            planet_level_junk: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65],
            abandon_speed_change_percent: 150,
            abandon_range_change_percent: 150,
        }
    }
}
