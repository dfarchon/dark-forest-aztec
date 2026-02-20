use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

/// SNARK keys & Perlin parameters.
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct SnarkConfig {
    pub disable_zk_checks: bool,
    pub planethash_key: u128,
    pub spacetype_key: u128,
    pub biomebase_key: u128,
    pub perlin_mirror_x: bool,
    pub perlin_mirror_y: bool,
    pub perlin_length_scale: u128,
}

impl SnarkConfig {
    pub fn zero() -> Self {
        Self {
            disable_zk_checks: false,
            planethash_key: 6279,
            spacetype_key: 6280,
            biomebase_key: 6271,
            perlin_mirror_x: false,
            perlin_mirror_y: false,
            perlin_length_scale: 16384,
        }
    }
}
