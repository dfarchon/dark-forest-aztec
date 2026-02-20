use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct Upgrade {
    pub pop_cap_multiplier: u128,
    pub pop_gro_multiplier: u128,
    pub range_multiplier: u128,
    pub speed_multiplier: u128,
    pub def_multiplier: u128,
}

impl Upgrade {
    pub fn zero() -> Self {
        Self {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: 100,
        }
    }
}
