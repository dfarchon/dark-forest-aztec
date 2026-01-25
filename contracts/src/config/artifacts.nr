use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

/// `# Artifacts` section
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct ArtifactsConfig {
    /// From TOML:
    /// 2022-10-05T04:00:00.000Z -> unix timestamp in milliseconds.
    pub token_mint_end_timestamp_ms: u128,
    pub artifact_point_values: [u128; 6],
    /// Seconds.
    pub photoid_activation_delay_s: u128,
}

impl ArtifactsConfig {
    pub fn default_dark_forest() -> Self {
        Self {
            // 2022-10-05T04:00:00.000Z
            token_mint_end_timestamp_ms: 1_664_942_400_000,
            artifact_point_values: [0, 2000, 10_000, 200_000, 3_000_000, 20_000_000],
            photoid_activation_delay_s: 14_400,
        }
    }

    // ---- getters ----
    pub fn get_token_mint_end_timestamp_ms(&self) -> u128 {
        self.token_mint_end_timestamp_ms
    }
    pub fn get_artifact_point_values(&self) -> [u128; 6] {
        self.artifact_point_values
    }
    pub fn get_photoid_activation_delay_s(&self) -> u128 {
        self.photoid_activation_delay_s
    }

    // ---- setters ----
    pub fn set_token_mint_end_timestamp_ms(&mut self, value: u128) {
        self.token_mint_end_timestamp_ms = value;
    }
    pub fn set_artifact_point_values(&mut self, value: [u128; 6]) {
        self.artifact_point_values = value;
    }
    pub fn set_photoid_activation_delay_s(&mut self, value: u128) {
        self.photoid_activation_delay_s = value;
    }
}

