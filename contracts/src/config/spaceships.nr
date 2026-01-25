use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// # Spaceships
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct SpaceshipsConfig {
    pub gear: bool,
    pub mothership: bool,
    pub titan: bool,
    pub crescent: bool,
    pub whale: bool,
}

impl SpaceshipsConfig {
    pub fn default_dark_forest() -> Self {
        Self { gear: true, mothership: true, titan: true, crescent: true, whale: true }
    }

    // ---- getters ----
    pub fn get_gear(&self) -> bool {
        self.gear
    }
    pub fn get_mothership(&self) -> bool {
        self.mothership
    }
    pub fn get_titan(&self) -> bool {
        self.titan
    }
    pub fn get_crescent(&self) -> bool {
        self.crescent
    }
    pub fn get_whale(&self) -> bool {
        self.whale
    }

    // ---- setters ----
    pub fn set_gear(&mut self, value: bool) {
        self.gear = value;
    }
    pub fn set_mothership(&mut self, value: bool) {
        self.mothership = value;
    }
    pub fn set_titan(&mut self, value: bool) {
        self.titan = value;
    }
    pub fn set_crescent(&mut self, value: bool) {
        self.crescent = value;
    }
    pub fn set_whale(&mut self, value: bool) {
        self.whale = value;
    }
}

