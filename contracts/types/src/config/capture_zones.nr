use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

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
    pub fn zero() -> Self {
        Self {
            capture_zones_enabled: true,
            capture_zone_change_block_interval: 255,
            capture_zone_radius: 1000,
            capture_zone_planet_level_score: [
                0, 0, 1000, 2500, 5000, 10_000, 100_000, 200_000, 500_000, 1_000_000,
            ],
            capture_zone_hold_blocks_required: 255,
            capture_zones_per_5000_world_radius: 3,
        }
    }
}
