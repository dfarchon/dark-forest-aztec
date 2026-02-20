use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

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
    pub fn zero() -> Self {
        Self { gear: true, mothership: true, titan: true, crescent: true, whale: true }
    }
}
