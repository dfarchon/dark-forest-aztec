use ::aztec::protocol::{address::AztecAddress, traits::{Deserialize, Serialize}};

use crate::config::{
    artifacts::ArtifactsConfig,
    capture_zones::CaptureZonesConfig,
    default_stats::PlanetDefaultStats,
    game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
    snark::SnarkConfig,
    space_junk::SpaceJunkConfig,
    spaceships::SpaceshipsConfig,
    upgrade::{Upgrade, UpgradeConfig},
    world::WorldConfig,
};

/// All config needed by the client in a single struct, so callers can fetch
/// everything in one PXE `simulate` call instead of many serial calls.
#[derive(Serialize, Deserialize)]
pub struct FullConfig {
    pub admin: AztecAddress,
    pub snark_config: SnarkConfig,
    pub world_config: WorldConfig,
    pub game_config_core: GameConfigCore,
    pub upgrade_config: UpgradeConfig,
    pub planet_level_thresholds: PlanetLevelThresholds,
    pub space_junk_config: SpaceJunkConfig,
    pub planet_type_weights_tier_0: PlanetTypeWeightsTier,
    pub planet_type_weights_tier_1: PlanetTypeWeightsTier,
    pub planet_type_weights_tier_2: PlanetTypeWeightsTier,
    pub planet_type_weights_tier_3: PlanetTypeWeightsTier,
    pub artifacts_config: ArtifactsConfig,
    pub spaceships_config: SpaceshipsConfig,
    pub capture_zones_config: CaptureZonesConfig,
    pub default_stats: [PlanetDefaultStats; 10],
    pub upgrades: [[Upgrade; 4]; 3],
    pub cumulative_rarities: [u128; 10],
}
