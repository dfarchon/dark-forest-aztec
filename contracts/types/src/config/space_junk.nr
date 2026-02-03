use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

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
    pub fn default_dark_forest() -> Self {
        Self {
            space_junk_enabled: false,
            space_junk_limit: 1000,
            planet_level_junk: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65],
            abandon_speed_change_percent: 150,
            abandon_range_change_percent: 150,
        }
    }

    // ---- getters ----
    pub fn get_space_junk_enabled(&self) -> bool {
        self.space_junk_enabled
    }
    pub fn get_space_junk_limit(&self) -> u128 {
        self.space_junk_limit
    }
    pub fn get_planet_level_junk(&self) -> [u128; 10] {
        self.planet_level_junk
    }
    pub fn get_abandon_speed_change_percent(&self) -> u128 {
        self.abandon_speed_change_percent
    }
    pub fn get_abandon_range_change_percent(&self) -> u128 {
        self.abandon_range_change_percent
    }

    // ---- setters ----
    pub fn set_space_junk_enabled(&mut self, value: bool) {
        self.space_junk_enabled = value;
    }
    pub fn set_space_junk_limit(&mut self, value: u128) {
        self.space_junk_limit = value;
    }
    pub fn set_planet_level_junk(&mut self, value: [u128; 10]) {
        self.planet_level_junk = value;
    }
    pub fn set_abandon_speed_change_percent(&mut self, value: u128) {
        self.abandon_speed_change_percent = value;
    }
    pub fn set_abandon_range_change_percent(&mut self, value: u128) {
        self.abandon_range_change_percent = value;
    }
}

