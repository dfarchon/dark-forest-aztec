use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// SNARK keys & Perlin parameters.
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct SnarkConstants {
    pub disable_zk_checks: bool,
    pub planethash_key: u128,
    pub spacetype_key: u128,
    pub biomebase_key: u128,
    pub perlin_mirror_x: bool,
    pub perlin_mirror_y: bool,
    pub perlin_length_scale: u128,
}

impl SnarkConstants {
    pub fn new(
        disable_zk_checks: bool,
        planethash_key: u128,
        spacetype_key: u128,
        biomebase_key: u128,
        perlin_mirror_x: bool,
        perlin_mirror_y: bool,
        perlin_length_scale: u128,
    ) -> Self {
        Self {
            disable_zk_checks,
            planethash_key,
            spacetype_key,
            biomebase_key,
            perlin_mirror_x,
            perlin_mirror_y,
            perlin_length_scale,
        }
    }

    pub fn default_dark_forest() -> Self {
        SnarkConstants::new(false, 6279, 6280, 6271, false, false, 16384)
    }

    // ---- getters ----
    pub fn get_disable_zk_checks(&self) -> bool {
        self.disable_zk_checks
    }
    pub fn get_planethash_key(&self) -> u128 {
        self.planethash_key
    }
    pub fn get_spacetype_key(&self) -> u128 {
        self.spacetype_key
    }
    pub fn get_biomebase_key(&self) -> u128 {
        self.biomebase_key
    }
    pub fn get_perlin_mirror_x(&self) -> bool {
        self.perlin_mirror_x
    }
    pub fn get_perlin_mirror_y(&self) -> bool {
        self.perlin_mirror_y
    }
    pub fn get_perlin_length_scale(&self) -> u128 {
        self.perlin_length_scale
    }

    // ---- setters ----
    pub fn set_disable_zk_checks(&mut self, value: bool) {
        self.disable_zk_checks = value;
    }
    pub fn set_planethash_key(&mut self, value: u128) {
        self.planethash_key = value;
    }
    pub fn set_spacetype_key(&mut self, value: u128) {
        self.spacetype_key = value;
    }
    pub fn set_biomebase_key(&mut self, value: u128) {
        self.biomebase_key = value;
    }
    pub fn set_perlin_mirror_x(&mut self, value: bool) {
        self.perlin_mirror_x = value;
    }
    pub fn set_perlin_mirror_y(&mut self, value: bool) {
        self.perlin_mirror_y = value;
    }
    pub fn set_perlin_length_scale(&mut self, value: u128) {
        self.perlin_length_scale = value;
    }
}

