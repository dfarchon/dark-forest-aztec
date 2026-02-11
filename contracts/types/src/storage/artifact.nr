// Artifact and ArtifactState types

use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct Artifact {
    // pub id: Field,
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
    pub last_updated: u64,
}

impl Artifact {
    pub fn zero() -> Self {
        Artifact {
            // id: 0 as Field,
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
            last_updated: 0,
        }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct ArtifactLocation {
    // pub artifact_id: Field,
    pub planet_id: Field, // 0 if in transit
    pub voyage_id: Field, // arrival_id if in transit, 0 if arrived
    pub last_updated: u64,
}

impl ArtifactLocation {
    pub fn zero() -> Self {
        Self {
            // artifact_id: 0 as Field,
            planet_id: 0 as Field,
            voyage_id: 0 as Field,
            last_updated: 0,
        }
    }
}

pub mod ArtifactType {
    pub fn Unknown() -> u8 {
        0
    }
    pub fn Monolith() -> u8 {
        1
    }
    pub fn Colossus() -> u8 {
        2
    }
    pub fn Spaceship() -> u8 {
        3
    }
    pub fn Pyramid() -> u8 {
        4
    }
    pub fn Wormhole() -> u8 {
        5
    }
    pub fn PlanetaryShield() -> u8 {
        6
    }
    pub fn PhotoidCannon() -> u8 {
        7
    }
    pub fn BloomFilter() -> u8 {
        8
    }
    pub fn BlackDomain() -> u8 {
        9
    }
    pub fn ShipMothership() -> u8 {
        10
    }
    pub fn ShipCrescent() -> u8 {
        11
    }
    pub fn ShipWhale() -> u8 {
        12
    }
    pub fn ShipGear() -> u8 {
        13
    }
    pub fn ShipTitan() -> u8 {
        14
    }
}

/// ArtifactRarity namespace with numeric helpers.
pub mod ArtifactRarity {
    pub fn Unknown() -> u8 {
        0
    }
    pub fn Common() -> u8 {
        1
    }
    pub fn Rare() -> u8 {
        2
    }
    pub fn Epic() -> u8 {
        3
    }
    pub fn Legendary() -> u8 {
        4
    }
    pub fn Mythic() -> u8 {
        5
    }
}
