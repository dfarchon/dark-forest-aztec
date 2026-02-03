// Global game state

use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct GlobalState {
    pub paused: bool,
    pub planet_events_count: u128,
    pub world_radius: u128,
    pub misc_nonce: u128,
    pub planet_ids_count: u128,
    pub revealed_planet_ids_count: u128,
    pub player_ids_count: u128,
    pub next_change_block: u32,
}

impl GlobalState {
    pub fn zero() -> Self {
        GlobalState {
            paused: false,
            planet_events_count: 0,
            world_radius: 0,
            misc_nonce: 0,
            planet_ids_count: 0,
            revealed_planet_ids_count: 0,
            player_ids_count: 0,
            next_change_block: 0,
        }
    }
}
