// Player state

use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct Player {
    pub is_initialized: bool,
    pub player: AztecAddress,
    pub init_timestamp: u64,
    pub home_planet_id: Field,
    pub last_reveal_timestamp: u64,
    pub score: u128,
    pub space_junk: u128,
    pub space_junk_limit: u128,
    pub claimed_ships: bool,
}

impl Player {
    pub fn zero() -> Self {
        Player {
            is_initialized: false,
            player: AztecAddress::zero(),
            init_timestamp: 0,
            home_planet_id: 0 as Field,
            last_reveal_timestamp: 0,
            score: 0,
            space_junk: 0,
            space_junk_limit: 0,
            claimed_ships: false,
        }
    }
}
