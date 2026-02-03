// Shared core, config, and storage types for contracts.

// ========== Game configuration types ==========
pub mod config;
pub use config::{
    ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetDefaultStats,
    PlanetLevelThresholds, PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig,
    Upgrade, WorldConfig,
};

// ========== Storage types ==========
pub mod storage;
pub use storage::{
    // State root wrapper
    StateRoot,
    // Global state
    GlobalState,
    // Artifact types
    Artifact, ArtifactState,
    // Player types
    Player,
    // Planet types and sub-tables
    Planet, PlanetMeta, PlanetOwner, PlanetCaps, PlanetResources, PlanetMods, RevealedCoords,
    PlanetData, PlanetEventMetadata, PlanetFullState,
    // Arrival data
    Arrival,
};
