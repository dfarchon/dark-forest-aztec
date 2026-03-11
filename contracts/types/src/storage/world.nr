// Global game state
//
// Only low-frequency admin fields live here. High-frequency counters
// (planet_events_count, planet_ids_count, player_ids_count, etc.)
// have been moved out to avoid per-block write contention on the
// World state hash. See ArrivalStorage.allocate_event_id() for the
// event ID counter; other counters are maintained off-chain by the
// indexer.

use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct World {
    pub paused: bool,
    pub radius: u128,
    pub misc_nonce: u128,
    pub next_change_block: u32,
}

impl World {
    pub fn zero() -> Self {
        Self { paused: false, radius: 53_000, misc_nonce: 0, next_change_block: 0 }
    }
}
