use ::aztec::protocol::traits::{Deserialize, Serialize};

use crate::config::{
    default_stats::PlanetDefaultStats,
    game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
    space_junk::SpaceJunkConfig,
    world::WorldConfig,
};

/// All config needed for planet initialization in a single struct,
/// so callers can fetch everything in one cross-contract view call.
#[derive(Serialize, Deserialize)]
pub struct PlanetInitConfig {
    pub world_config: WorldConfig,
    pub game_config_core: GameConfigCore,
    pub space_junk_config: SpaceJunkConfig,
    pub planet_default_stats: PlanetDefaultStats,
    pub planet_level_thresholds: PlanetLevelThresholds,
    pub planet_type_weights_tier_0: PlanetTypeWeightsTier,
    pub planet_type_weights_tier_1: PlanetTypeWeightsTier,
    pub planet_type_weights_tier_2: PlanetTypeWeightsTier,
    pub planet_type_weights_tier_3: PlanetTypeWeightsTier,
}
