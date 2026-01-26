use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// `# World` section
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct WorldConfig {
    pub start_paused: bool,
    /// Speedup/slowdown factor in hundredths (e.g. 100 = 100%).
    pub time_factor_hundredths: u128,
    pub spawn_rim_area: u128,
    pub world_radius_locked: bool,
    pub world_radius_min: u128,

    /// Seconds.
    pub location_reveal_cooldown_s: u64,
    pub silver_score_value: u128,
    pub planet_transfer_enabled: bool,
    pub admin_can_add_planets: bool,
}

impl WorldConfig {
    pub fn default_dark_forest() -> Self {
        Self {
            start_paused: false,
            time_factor_hundredths: 100,
            spawn_rim_area: 0,
            world_radius_locked: false,
            world_radius_min: 53_000,
            location_reveal_cooldown_s: 86_400,
            silver_score_value: 100,
            planet_transfer_enabled: true,
            admin_can_add_planets: true,
        }
    }

    // ---- getters ----
    pub fn get_start_paused(&self) -> bool {
        self.start_paused
    }
    pub fn get_time_factor_hundredths(&self) -> u128 {
        self.time_factor_hundredths
    }
    pub fn get_spawn_rim_area(&self) -> u128 {
        self.spawn_rim_area
    }
    pub fn get_world_radius_locked(&self) -> bool {
        self.world_radius_locked
    }
    pub fn get_world_radius_min(&self) -> u128 {
        self.world_radius_min
    }
    pub fn get_location_reveal_cooldown_s(&self) -> u64 {
        self.location_reveal_cooldown_s
    }
    pub fn get_silver_score_value(&self) -> u128 {
        self.silver_score_value
    }
    pub fn get_planet_transfer_enabled(&self) -> bool {
        self.planet_transfer_enabled
    }
    pub fn get_admin_can_add_planets(&self) -> bool {
        self.admin_can_add_planets
    }

    // ---- setters ----
    pub fn set_start_paused(&mut self, value: bool) {
        self.start_paused = value;
    }
    pub fn set_time_factor_hundredths(&mut self, value: u128) {
        self.time_factor_hundredths = value;
    }
    pub fn set_spawn_rim_area(&mut self, value: u128) {
        self.spawn_rim_area = value;
    }
    pub fn set_world_radius_locked(&mut self, value: bool) {
        self.world_radius_locked = value;
    }
    pub fn set_world_radius_min(&mut self, value: u128) {
        self.world_radius_min = value;
    }
    pub fn set_location_reveal_cooldown_s(&mut self, value: u64) {
        self.location_reveal_cooldown_s = value;
    }
    pub fn set_silver_score_value(&mut self, value: u128) {
        self.silver_score_value = value;
    }
    pub fn set_planet_transfer_enabled(&mut self, value: bool) {
        self.planet_transfer_enabled = value;
    }
    pub fn set_admin_can_add_planets(&mut self, value: bool) {
        self.admin_can_add_planets = value;
    }
}

