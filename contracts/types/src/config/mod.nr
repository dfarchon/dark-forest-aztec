pub mod world;
pub mod snark;
pub mod game;
pub mod artifacts;
pub mod spaceships;
pub mod space_junk;
pub mod capture_zones;
pub mod default_stats;
pub mod upgrade;

// Optional convenience re-exports
pub use world::WorldConfig;
pub use snark::SnarkConstants;
pub use game::{GameConfig, GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier};
pub use artifacts::ArtifactsConfig;
pub use spaceships::SpaceshipsConfig;
pub use space_junk::SpaceJunkConfig;
pub use capture_zones::CaptureZonesConfig;
pub use default_stats::PlanetDefaultStats;
pub use upgrade::{Upgrade, UpgradeConfig};

