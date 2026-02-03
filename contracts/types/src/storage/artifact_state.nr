// Artifact and ArtifactState types

use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct Artifact {
    pub is_initialized: bool,
    pub id: Field,
    pub planet_discovered_on: Field,
    pub rarity: u8,
    pub planet_biome: u8,
    pub minted_at_timestamp: u64,
    pub discoverer: AztecAddress,
    pub artifact_type: u8,
    pub activations: u128,
    pub last_activated: u64,
    pub last_deactivated: u64,
    pub wormhole_to: Field,
    pub controller: AztecAddress,
}

impl Artifact {
    pub fn zero() -> Self {
        Artifact {
            is_initialized: false,
            id: 0 as Field,
            planet_discovered_on: 0 as Field,
            rarity: 0,
            planet_biome: 0,
            minted_at_timestamp: 0,
            discoverer: AztecAddress::zero(),
            artifact_type: 0,
            activations: 0,
            last_activated: 0,
            last_deactivated: 0,
            wormhole_to: 0 as Field,
            controller: AztecAddress::zero(),
        }
    }
}

#[derive(Serialize, Deserialize, Packable)]
pub struct ArtifactState {
    pub artifact: Artifact,
    pub planet_id: Field,   // 0 if in transit
    pub voyage_id: u128,    // arrival_id if in transit, 0 if arrived
}

impl ArtifactState {
    pub fn zero() -> Self {
        ArtifactState {
            artifact: Artifact::zero(),
            planet_id: 0 as Field,
            voyage_id: 0,
        }
    }
}
