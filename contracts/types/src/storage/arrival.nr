// Arrival data for planet events

use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct Arrival {
    pub id: Field,
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

pub mod ArrivalType {
    pub fn Unknown() -> u8 {
        0
    }
    pub fn Normal() -> u8 {
        1
    }
    pub fn Photoid() -> u8 {
        2
    }
    pub fn Wormhole() -> u8 {
        3
    }
}
