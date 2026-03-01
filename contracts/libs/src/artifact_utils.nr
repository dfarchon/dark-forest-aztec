// Artifact utility functions - Pure functions for artifact management
// Ported from Solidity LibArtifactUtils.sol

use ::aztec::protocol::address::AztecAddress;
use ::types::args::DFTCreateArtifactArgs;
use ::types::config::upgrade::Upgrade;
use ::types::storage::arrival::Arrival;
use ::types::storage::artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType};
use ::types::storage::planet::{Biome, Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType};

/// Noir port of Solidity `LibArtifactUtils.isSpaceship`.
/// Checks if an artifact type is a spaceship.
///
/// Spaceships are: ShipMothership(10), ShipCrescent(11), ShipWhale(12), ShipGear(13), ShipTitan(14)
pub fn is_spaceship(artifact_type: u8) -> bool {
    // Noir doesn't support && operator, use nested if
    if artifact_type >= ArtifactType::ShipMothership() {
        artifact_type <= ArtifactType::ShipTitan()
    } else {
        false
    }
}

/// Build the artifacts array for refreshed planet_artifacts: for each id in new_planet_artifacts,
/// resolve from planet_artifacts_artifacts (same id on planet) or from arrivals/artifacts (incoming).
pub fn build_planet_artifacts_artifacts_after_refresh(
    new_planet_artifacts: PlanetArtifacts,
    planet_artifacts: PlanetArtifacts,
    planet_artifacts_artifacts: [Artifact; 20],
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    planet_id: Field,
) -> [Artifact; 20] {
    let mut new_planet_artifacts_artifacts: [Artifact; 20] = [Artifact::zero(); 20];
    for k in 0..20 {
        if k < new_planet_artifacts.count {
            let id = new_planet_artifacts.ids[k];
            let mut found = false;
            for i in 0..20 {
                if i < planet_artifacts.count {
                    if planet_artifacts.ids[i] == id {
                        new_planet_artifacts_artifacts[k] = planet_artifacts_artifacts[i];
                        found = true;
                    }
                }
            }
            if !found {
                for j in 0..20 {
                    if j < planet_events_state.count {
                        let to_this = arrivals[j].to_planet == planet_id;
                        let same_id = arrivals[j].carried_artifact_id == id;
                        if to_this & same_id {
                            new_planet_artifacts_artifacts[k] = artifacts[j];
                            found = true;
                        }
                    }
                }
            }
        }
    }
    new_planet_artifacts_artifacts
}

/// Get artifact cooldown in seconds based on artifact type.
/// Noir port of the cooldown array from activateNonSpaceshipArtifact.
///
/// Returns cooldown in seconds (0 means no cooldown).
pub fn get_artifact_cooldown_seconds(artifact_type: u8) -> u64 {
    // artifactCooldownsHours = [24, 0, 0, 0, 0, 4, 4, 24, 24, 24]
    // Index: Unknown=0, Monolith=1, Colossus=2, Spaceship=3, Pyramid=4,
    //        Wormhole=5, PlanetaryShield=6, PhotoidCannon=7, BloomFilter=8, BlackDomain=9
    let cooldown_hours: u64 = if artifact_type == ArtifactType::Unknown() {
        24
    } else if artifact_type == ArtifactType::Wormhole() {
        4
    } else if artifact_type == ArtifactType::PlanetaryShield() {
        4
    } else if artifact_type == ArtifactType::PhotoidCannon() {
        24
    } else if artifact_type == ArtifactType::BloomFilter() {
        24
    } else if artifact_type == ArtifactType::BlackDomain() {
        24
    } else {
        0 // Monolith, Colossus, Spaceship, Pyramid have no cooldown
    };

    cooldown_hours * 60 * 60 // Convert to seconds
}

/// Get biome from space type and biomebase.
/// Noir port of Solidity `LibGameUtils._getBiome`.
pub fn get_biome(space_type: u8, biomebase: u128) -> u8 {
    // biomebase is expected to be in range [0, 10)
    let biome_index = biomebase % 10;

    if space_type == SpaceType::Nebula() {
        // Nebula: Ocean(1), Forest(2), Grassland(3)
        if biome_index < 3 {
            Biome::Ocean()
        } else if biome_index < 6 {
            Biome::Forest()
        } else {
            Biome::Grassland()
        }
    } else if space_type == SpaceType::Space() {
        // Space: Tundra(4), Swamp(5), Desert(6)
        if biome_index < 3 {
            Biome::Tundra()
        } else if biome_index < 6 {
            Biome::Swamp()
        } else {
            Biome::Desert()
        }
    } else if space_type == SpaceType::DeepSpace() {
        // Deep Space: Ice(7), Wasteland(8), Lava(9)
        if biome_index < 3 {
            Biome::Ice()
        } else if biome_index < 6 {
            Biome::Wasteland()
        } else {
            Biome::Lava()
        }
    } else {
        // Dead Space: Corrupted(10)
        Biome::Corrupted()
    }
}

/// Get artifact rarity from planet level.
/// Noir port of Solidity `LibGameUtils.artifactRarityFromPlanetLevel`.
pub fn artifact_rarity_from_planet_level(level_with_bonus: u8) -> u8 {
    if level_with_bonus <= 1 {
        ArtifactRarity::Common()
    } else if level_with_bonus <= 3 {
        ArtifactRarity::Rare()
    } else if level_with_bonus <= 5 {
        ArtifactRarity::Epic()
    } else if level_with_bonus <= 7 {
        ArtifactRarity::Legendary()
    } else {
        ArtifactRarity::Mythic()
    }
}

/// Get random artifact type and level bonus based on seed, biome, and space type.
/// Noir port of Solidity `LibGameUtils._randomArtifactTypeAndLevelBonus`.
///
/// Returns (artifact_type, level_bonus)
pub fn random_artifact_type_and_level_bonus(seed: Field, biome: u8, space_type: u8) -> (u8, u8) {
    // Extract random values from seed
    let seed_u128 = seed as u128;
    let type_roll = (seed_u128 % 256) as u8;
    let bonus_roll = ((seed_u128 / 256) % 256) as u8;

    // Determine biome category (Noir has no || operator, check each biome separately)
    // Nebula biomes: Ocean(1), Forest(2), Grassland(3)
    // Space biomes: Tundra(4), Swamp(5), Desert(6)
    // Deep biomes: Ice(7), Wasteland(8), Lava(9), Corrupted(10)
    let is_nebula_biome = if biome == Biome::Ocean() {
        true
    } else if biome == Biome::Forest() {
        true
    } else if biome == Biome::Grassland() {
        true
    } else {
        false
    };

    let is_space_biome = if biome == Biome::Tundra() {
        true
    } else if biome == Biome::Swamp() {
        true
    } else if biome == Biome::Desert() {
        true
    } else {
        false
    };

    // Determine artifact type based on biome category
    let artifact_type = if is_nebula_biome {
        // Nebula biomes: more likely to get defensive artifacts
        if type_roll < 40 {
            ArtifactType::Monolith()
        } else if type_roll < 80 {
            ArtifactType::Colossus()
        } else if type_roll < 120 {
            ArtifactType::Pyramid()
        } else if type_roll < 160 {
            ArtifactType::Wormhole()
        } else if type_roll < 200 {
            ArtifactType::PlanetaryShield()
        } else if type_roll < 230 {
            ArtifactType::BloomFilter()
        } else {
            ArtifactType::BlackDomain()
        }
    } else if is_space_biome {
        // Space biomes: balanced distribution
        if type_roll < 50 {
            ArtifactType::Monolith()
        } else if type_roll < 100 {
            ArtifactType::Colossus()
        } else if type_roll < 140 {
            ArtifactType::Pyramid()
        } else if type_roll < 180 {
            ArtifactType::Wormhole()
        } else if type_roll < 210 {
            ArtifactType::PhotoidCannon()
        } else if type_roll < 240 {
            ArtifactType::BloomFilter()
        } else {
            ArtifactType::BlackDomain()
        }
    } else {
        // Deep Space/Dead Space biomes: more powerful artifacts
        if type_roll < 30 {
            ArtifactType::Monolith()
        } else if type_roll < 60 {
            ArtifactType::Colossus()
        } else if type_roll < 100 {
            ArtifactType::Pyramid()
        } else if type_roll < 140 {
            ArtifactType::Wormhole()
        } else if type_roll < 180 {
            ArtifactType::PhotoidCannon()
        } else if type_roll < 220 {
            ArtifactType::BloomFilter()
        } else {
            ArtifactType::BlackDomain()
        }
    };

    // Determine level bonus (0-2) based on space type
    let level_bonus = if space_type == SpaceType::DeadSpace() {
        if bonus_roll < 100 {
            2
        } else if bonus_roll < 200 {
            1
        } else {
            0
        }
    } else if space_type == SpaceType::DeepSpace() {
        if bonus_roll < 80 {
            2
        } else if bonus_roll < 180 {
            1
        } else {
            0
        }
    } else if space_type == SpaceType::Space() {
        if bonus_roll < 50 {
            1
        } else {
            0
        }
    } else {
        0 // Nebula - no bonus
    };

    (artifact_type, level_bonus)
}

/// Pure logic for prospect: validate and return updated planet (prospected_block_number, last_updated set).
/// Ported from LibArtifactUtils.prospectPlanet. Caller (contract) does verify_hash and storage set.
pub fn prospect_planet_logic(
    planet: Planet,
    block_number: u32,
    timestamp: u64,
    sender: AztecAddress,
    gear_required: bool,
    has_gear: bool,
) -> Planet {
    assert(!planet.destroyed, "planet is destroyed");
    assert(planet.planet_type == PlanetType::Ruins(), "you can't find an artifact on this planet");
    assert(planet.owner == sender, "you must own this planet");
    assert(planet.prospected_block_number == 0, "this planet has already been prospected");
    if gear_required {
        assert(has_gear, "gear ship must be present on planet");
    }
    let mut new_planet = planet;
    new_planet.prospected_block_number = block_number;
    new_planet.last_updated = timestamp;
    new_planet
}

/// Build (artifact_id, DFTCreateArtifactArgs) for a spaceship. L1: LibArtifactUtils.createAndPlaceSpaceship (args construction part).
/// Caller does create_artifact(args) and add_artifact_id_to_planet_artifacts (contract/storage).
pub fn build_create_spaceship_args(
    planet_id: Field,
    controller: AztecAddress,
    ship_type: u8,
    nonce: u32,
) -> (Field, DFTCreateArtifactArgs) {
    assert(ship_type >= ArtifactType::ShipMothership(), "ship type out of range");
    assert(ship_type <= ArtifactType::ShipTitan(), "ship type out of range");
    let artifact_id = planet_id + (nonce as Field);
    let create_args = DFTCreateArtifactArgs {
        id: artifact_id,
        planet_id: planet_id,
        rarity: 0, // Unknown rarity for spaceships
        biome: 0, // Unknown biome for spaceships
        artifact_type: ship_type,
        discoverer: controller,
        controller: controller,
    };
    (artifact_id, create_args)
}

/// Prospect expiration time in seconds (1 hour instead of 256 blocks).
/// In Solidity this was: block.number - planet.prospectedBlockNumber < 256
/// We use timestamp-based expiration instead.
pub fn get_prospect_expiration_seconds() -> u64 {
    3600 // 1 hour
}

/// Check if prospect has expired.
pub fn is_prospect_expired(prospected_timestamp: u64, current_timestamp: u64) -> bool {
    if prospected_timestamp == 0 {
        true // Never prospected
    } else {
        current_timestamp > prospected_timestamp + get_prospect_expiration_seconds()
    }
}

// ========== Location-based Stat Boosts ==========
// Ported from Solidity LibGameUtils.sol (lines 559-582)
// These functions check if a planet location has specific stat boosts
// based on the value of specific bytes in the location ID.

/// Helper function to extract a specific byte from a Field (location ID).
/// location_id is treated as a 32-byte big-endian array.
fn get_location_byte(location: Field, byte_index: u32) -> u8 {
    let bytes: [u8; 32] = location.to_be_bytes();
    bytes[byte_index]
}

/// Check if location has population cap boost (byte 9 < 16).
/// Solidity: LibGameUtils.isPopCapBoost (line 559)
pub fn is_pop_cap_boost(location: Field) -> bool {
    get_location_byte(location, 9) < 16
}

/// Check if location has population growth boost (byte 10 < 16).
/// Solidity: LibGameUtils.isPopGroBoost (line 564)
pub fn is_pop_gro_boost(location: Field) -> bool {
    get_location_byte(location, 10) < 16
}

/// Check if location has range boost (byte 11 < 16).
/// Solidity: LibGameUtils.isRangeBoost (line 569)
pub fn is_range_boost(location: Field) -> bool {
    get_location_byte(location, 11) < 16
}

/// Check if location has speed boost (byte 12 < 16).
/// Solidity: LibGameUtils.isSpeedBoost (line 574)
pub fn is_speed_boost(location: Field) -> bool {
    get_location_byte(location, 12) < 16
}

/// Check if location has defense boost (byte 13 < 16).
/// Solidity: LibGameUtils.isDefBoost (line 579)
pub fn is_def_boost(location: Field) -> bool {
    get_location_byte(location, 13) < 16
}

// ========== Default Planet Calculation (for Crescent Spaceship) ==========
// Ported from Solidity LibGameUtils._defaultPlanet (lines 589-711)

/// Calculate default planet stats for a given level and type.
/// This is primarily used by Crescent spaceship to convert a planet to SILVER_MINE.
/// Returns: (silver_growth, silver_cap, initial_silver)
pub fn default_planet_silver_stats(
    level: u8,
    planet_type: u8,
    space_type: u8,
    default_stats: ::types::config::default_stats::PlanetDefaultStats,
    time_factor_hundredths: u128,
) -> (u128, u128, u128) {
    let mut silver_growth = default_stats.silver_growth;
    let mut silver_cap = default_stats.silver_cap;

    if space_type == 3 {
        silver_cap = silver_cap * 2;
        silver_growth = silver_growth * 2;
    } else if space_type == 2 {
        silver_cap = (silver_cap * 3) / 2;
        silver_growth = (silver_growth * 3) / 2;
    } else if space_type == 1 {
        silver_cap = (silver_cap * 5) / 4;
        silver_growth = (silver_growth * 5) / 4;
    }

    if planet_type == 1 {
        silver_cap = silver_cap * 2;
    }

    let initial_silver = if planet_type == 1 { silver_cap / 2 } else { 0 };

    let final_silver_growth = (silver_growth * time_factor_hundredths) / 100;

    (final_silver_growth, silver_cap, initial_silver)
}
