// Arrival data for planet events

use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct Arrival {
    pub id: u128,
    pub player: AztecAddress,
    pub from_planet: Field,
    pub to_planet: Field,
    pub pop_arriving: u128,
    pub silver_moved: u128,
    pub departure_time: u64,
    pub arrival_time: u64,
    pub arrival_type: u8,
    pub carried_artifact_id: Field,
    pub distance: u128,
}

impl Arrival {
    pub fn zero() -> Self {
        Arrival {
            id: 0,
            player: AztecAddress::zero(),
            from_planet: 0 as Field,
            to_planet: 0 as Field,
            pop_arriving: 0,
            silver_moved: 0,
            departure_time: 0,
            arrival_time: 0,
            arrival_type: 0,
            carried_artifact_id: 0 as Field,
            distance: 0,
        }
    }
}
