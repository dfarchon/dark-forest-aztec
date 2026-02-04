// Storage types for state hash verification
//
// Design: On-chain stores (hash, block_number), off-chain Indexer maintains full state.
// When Indexer needs to rebuild, it queries the block_number to find the event with full data.

// ========== State Root ==========
pub mod state_root;
pub use state_root::StateRoot;

// ========== Global State ==========
pub mod global_state;
pub use global_state::GlobalState;

// ========== Artifact State ==========
pub mod artifact_state;
pub use artifact_state::{Artifact, ArtifactState};

// ========== Player State ==========
pub mod player;
pub use player::Player;

// ========== Planet State ==========
pub mod planet;
pub use planet::{
    Planet,
    PlanetMeta,
    PlanetOwner,
    PlanetCaps,
    PlanetResources,
    PlanetMods,
    RevealedCoords,
    PlanetData,
    PlanetEventMetadata,
    PlanetEvents,
    PlanetArtifacts,
    PlanetFullState,
};

// ========== Arrival Data ==========
pub mod arrival;
pub use arrival::Arrival;
