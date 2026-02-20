use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct WorldConfig {
    pub start_paused: bool,
    /// Speedup/slowdown factor in hundredths (e.g. 100 = 100%).
    pub time_factor_hundredths: u16,
    pub spawn_rim_area: u128,
    pub world_radius_locked: bool,
    pub world_radius_min: u128,

    /// Seconds.
    pub location_reveal_cooldown: u64,
    pub silver_score_value: u128,
    pub planet_transfer_enabled: bool,
    pub admin_can_add_planets: bool,
}

impl WorldConfig {
    pub fn zero() -> Self {
        Self {
            start_paused: false,
            time_factor_hundredths: 100,
            spawn_rim_area: 0,
            world_radius_locked: false,
            world_radius_min: 53_000,
            location_reveal_cooldown: 86_400,
            silver_score_value: 100,
            planet_transfer_enabled: true,
            admin_can_add_planets: true,
        }
    }
}
