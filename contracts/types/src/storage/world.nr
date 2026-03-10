// Global game state

use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct World {
    pub paused: bool,
    pub planet_events_count: Field,
    pub radius: u128,
    pub misc_nonce: u128,
    pub planet_ids_count: u128,
    pub revealed_planet_ids_count: u128,
    pub player_ids_count: u128,
    pub initialized_planet_count_level4: u128,
    pub next_change_block: u32,
}

impl World {
    pub fn zero() -> Self {
        Self {
            paused: false,
            planet_events_count: 0,
            radius: 53_000,
            misc_nonce: 0,
            planet_ids_count: 0,
            revealed_planet_ids_count: 0,
            player_ids_count: 0,
            initialized_planet_count_level4: 0,
            next_change_block: 0,
        }
    }
}
