use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct ArtifactsConfig {
    pub token_mint_end_timestamp: u64,
    pub artifact_point_values: [u128; 6],
    pub photoid_activation_delay: u64,
}

impl ArtifactsConfig {
    pub fn zero() -> Self {
        Self {
            // 2027-01-01T00:00:00.000Z
            token_mint_end_timestamp: 1_798_761_600,
            artifact_point_values: [0, 2000, 10_000, 200_000, 3_000_000, 20_000_000],
            photoid_activation_delay: 14_400,
        }
    }
}
