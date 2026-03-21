//! Bundles of linked storage contract addresses configured on system contracts.
//! Shapes mirror each system contract's `set_all_storage_addresses` parameters.

use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct AdminSystemStorageAddresses {
    pub config_storage_address: AztecAddress,
    pub world_storage_address: AztecAddress,
    pub player_storage_address: AztecAddress,
    pub planet_storage_address: AztecAddress,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct CoreSystemStorageAddresses {
    pub config_storage_address: AztecAddress,
    pub world_storage_address: AztecAddress,
    pub player_storage_address: AztecAddress,
    pub planet_storage_address: AztecAddress,
    pub planet_revealed_coords_storage_address: AztecAddress,
    pub planet_events_storage_address: AztecAddress,
    pub planet_artifacts_storage_address: AztecAddress,
    pub arrivals_storage_address: AztecAddress,
    pub artifact_storage_address: AztecAddress,
    pub artifact_location_storage_address: AztecAddress,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct MoveSystemStorageAddresses {
    pub config_storage_address: AztecAddress,
    pub world_storage_address: AztecAddress,
    pub player_storage_address: AztecAddress,
    pub planet_storage_address: AztecAddress,
    pub planet_events_storage_address: AztecAddress,
    pub planet_artifacts_storage_address: AztecAddress,
    pub arrivals_storage_address: AztecAddress,
    pub artifact_storage_address: AztecAddress,
    pub artifact_location_storage_address: AztecAddress,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct ArtifactFacetSystemStorageAddresses {
    pub config_storage_address: AztecAddress,
    pub arrivals_storage_address: AztecAddress,
    pub artifact_storage_address: AztecAddress,
    pub artifact_location_storage_address: AztecAddress,
    pub planet_storage_address: AztecAddress,
    pub planet_artifacts_storage_address: AztecAddress,
    pub planet_events_storage_address: AztecAddress,
    pub player_storage_address: AztecAddress,
    pub world_storage_address: AztecAddress,
}
