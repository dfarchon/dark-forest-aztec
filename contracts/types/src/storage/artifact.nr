// Artifact and ArtifactState types

use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

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
    pub owner: AztecAddress,
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
            owner: AztecAddress::zero(),
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
    pub global Unknown: u8 = 0;
    pub global Monolith: u8 = 1;
    pub global Colossus: u8 = 2;
    pub global Spaceship: u8 = 3;
    pub global Pyramid: u8 = 4;
    pub global Wormhole: u8 = 5;
    pub global PlanetaryShield: u8 = 6;
    pub global PhotoidCannon: u8 = 7;
    pub global BloomFilter: u8 = 8;
    pub global BlackDomain: u8 = 9;
    pub global ShipMothership: u8 = 10;
    pub global ShipCrescent: u8 = 11;
    pub global ShipWhale: u8 = 12;
    pub global ShipGear: u8 = 13;
    pub global ShipTitan: u8 = 14;
}

/// ArtifactRarity namespace with numeric helpers.
pub mod ArtifactRarity {
    pub global Unknown: u8 = 0;
    pub global Common: u8 = 1;
    pub global Rare: u8 = 2;
    pub global Epic: u8 = 3;
    pub global Legendary: u8 = 4;
    pub global Mythic: u8 = 5;
}
