use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// `# Capture zones` section
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct CaptureZonesConfig {
    pub capture_zones_enabled: bool,
    pub capture_zone_change_block_interval: u128,
    pub capture_zone_radius: u128,
    pub capture_zone_planet_level_score: [u128; 10],
    pub capture_zone_hold_blocks_required: u128,
    pub capture_zones_per_5000_world_radius: u128,
}

impl CaptureZonesConfig {
    pub fn default_dark_forest() -> Self {
        Self {
            capture_zones_enabled: true,
            capture_zone_change_block_interval: 255,
            capture_zone_radius: 1000,
            capture_zone_planet_level_score: [0, 0, 1000, 2500, 5000, 10_000, 100_000, 200_000, 500_000, 1_000_000],
            capture_zone_hold_blocks_required: 255,
            capture_zones_per_5000_world_radius: 3,
        }
    }

    // ---- getters ----
    pub fn get_capture_zones_enabled(&self) -> bool {
        self.capture_zones_enabled
    }
    pub fn get_capture_zone_change_block_interval(&self) -> u128 {
        self.capture_zone_change_block_interval
    }
    pub fn get_capture_zone_radius(&self) -> u128 {
        self.capture_zone_radius
    }
    pub fn get_capture_zone_planet_level_score(&self) -> [u128; 10] {
        self.capture_zone_planet_level_score
    }
    pub fn get_capture_zone_hold_blocks_required(&self) -> u128 {
        self.capture_zone_hold_blocks_required
    }
    pub fn get_capture_zones_per_5000_world_radius(&self) -> u128 {
        self.capture_zones_per_5000_world_radius
    }

    // ---- setters ----
    pub fn set_capture_zones_enabled(&mut self, value: bool) {
        self.capture_zones_enabled = value;
    }
    pub fn set_capture_zone_change_block_interval(&mut self, value: u128) {
        self.capture_zone_change_block_interval = value;
    }
    pub fn set_capture_zone_radius(&mut self, value: u128) {
        self.capture_zone_radius = value;
    }
    pub fn set_capture_zone_planet_level_score(&mut self, value: [u128; 10]) {
        self.capture_zone_planet_level_score = value;
    }
    pub fn set_capture_zone_hold_blocks_required(&mut self, value: u128) {
        self.capture_zone_hold_blocks_required = value;
    }
    pub fn set_capture_zones_per_5000_world_radius(&mut self, value: u128) {
        self.capture_zones_per_5000_world_radius = value;
    }
}

