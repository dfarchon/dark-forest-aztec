// Artifact utility functions - Pure functions for artifact management
// Ported from Solidity LibArtifactUtils.sol

use ::aztec::protocol::address::AztecAddress;
use ::types::args::DFTCreateArtifactArgs;
use ::types::config::upgrade::Upgrade;
use ::types::storage::arrival::Arrival;
use ::types::storage::artifact::{Artifact, ArtifactLocation};
use ::types::storage::planet::{Planet, PlanetArtifacts, PlanetEvents};

// ========== ArtifactType Constants (as u8) ==========
// These match the ArtifactType enum in types.nr
pub global ARTIFACT_TYPE_UNKNOWN: u8 = 0;
pub global ARTIFACT_TYPE_MONOLITH: u8 = 1;
pub global ARTIFACT_TYPE_COLOSSUS: u8 = 2;
pub global ARTIFACT_TYPE_SPACESHIP: u8 = 3;
pub global ARTIFACT_TYPE_PYRAMID: u8 = 4;
pub global ARTIFACT_TYPE_WORMHOLE: u8 = 5;
pub global ARTIFACT_TYPE_PLANETARY_SHIELD: u8 = 6;
pub global ARTIFACT_TYPE_PHOTOID_CANNON: u8 = 7;
pub global ARTIFACT_TYPE_BLOOM_FILTER: u8 = 8;
pub global ARTIFACT_TYPE_BLACK_DOMAIN: u8 = 9;
pub global ARTIFACT_TYPE_SHIP_MOTHERSHIP: u8 = 10;
pub global ARTIFACT_TYPE_SHIP_CRESCENT: u8 = 11;
pub global ARTIFACT_TYPE_SHIP_WHALE: u8 = 12;
pub global ARTIFACT_TYPE_SHIP_GEAR: u8 = 13;
pub global ARTIFACT_TYPE_SHIP_TITAN: u8 = 14;

// ========== ArtifactRarity Constants (as u8) ==========
pub global ARTIFACT_RARITY_UNKNOWN: u8 = 0;
pub global ARTIFACT_RARITY_COMMON: u8 = 1;
pub global ARTIFACT_RARITY_RARE: u8 = 2;
pub global ARTIFACT_RARITY_EPIC: u8 = 3;
pub global ARTIFACT_RARITY_LEGENDARY: u8 = 4;
pub global ARTIFACT_RARITY_MYTHIC: u8 = 5;

// ========== Biome Constants (as u8) ==========
pub global BIOME_UNKNOWN: u8 = 0;
pub global BIOME_OCEAN: u8 = 1;
pub global BIOME_FOREST: u8 = 2;
pub global BIOME_GRASSLAND: u8 = 3;
pub global BIOME_TUNDRA: u8 = 4;
pub global BIOME_SWAMP: u8 = 5;
pub global BIOME_DESERT: u8 = 6;
pub global BIOME_ICE: u8 = 7;
pub global BIOME_WASTELAND: u8 = 8;
pub global BIOME_LAVA: u8 = 9;
pub global BIOME_CORRUPTED: u8 = 10;

// ========== PlanetType Constants (as u8) ==========
pub global PLANET_TYPE_PLANET: u8 = 0;
pub global PLANET_TYPE_SILVER_MINE: u8 = 1;
pub global PLANET_TYPE_RUINS: u8 = 2;
pub global PLANET_TYPE_TRADING_POST: u8 = 3;
pub global PLANET_TYPE_SILVER_BANK: u8 = 4;

// ========== SpaceType Constants (as u8) ==========
pub global SPACE_TYPE_NEBULA: u8 = 0;
pub global SPACE_TYPE_SPACE: u8 = 1;
pub global SPACE_TYPE_DEEP_SPACE: u8 = 2;
pub global SPACE_TYPE_DEAD_SPACE: u8 = 3;

/// Noir port of Solidity `LibArtifactUtils.isSpaceship`.
/// Checks if an artifact type is a spaceship.
///
/// Spaceships are: ShipMothership(10), ShipCrescent(11), ShipWhale(12), ShipGear(13), ShipTitan(14)
pub fn is_spaceship(artifact_type: u8) -> bool {
    // Noir doesn't support && operator, use nested if
    if artifact_type >= ARTIFACT_TYPE_SHIP_MOTHERSHIP {
        artifact_type <= ARTIFACT_TYPE_SHIP_TITAN
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
    let cooldown_hours: u64 = if artifact_type == ARTIFACT_TYPE_UNKNOWN {
        24
    } else if artifact_type == ARTIFACT_TYPE_WORMHOLE {
        4
    } else if artifact_type == ARTIFACT_TYPE_PLANETARY_SHIELD {
        4
    } else if artifact_type == ARTIFACT_TYPE_PHOTOID_CANNON {
        24
    } else if artifact_type == ARTIFACT_TYPE_BLOOM_FILTER {
        24
    } else if artifact_type == ARTIFACT_TYPE_BLACK_DOMAIN {
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

    if space_type == SPACE_TYPE_NEBULA {
        // Nebula: Ocean(1), Forest(2), Grassland(3)
        if biome_index < 3 {
            BIOME_OCEAN
        } else if biome_index < 6 {
            BIOME_FOREST
        } else {
            BIOME_GRASSLAND
        }
    } else if space_type == SPACE_TYPE_SPACE {
        // Space: Tundra(4), Swamp(5), Desert(6)
        if biome_index < 3 {
            BIOME_TUNDRA
        } else if biome_index < 6 {
            BIOME_SWAMP
        } else {
            BIOME_DESERT
        }
    } else if space_type == SPACE_TYPE_DEEP_SPACE {
        // Deep Space: Ice(7), Wasteland(8), Lava(9)
        if biome_index < 3 {
            BIOME_ICE
        } else if biome_index < 6 {
            BIOME_WASTELAND
        } else {
            BIOME_LAVA
        }
    } else {
        // Dead Space: Corrupted(10)
        BIOME_CORRUPTED
    }
}

/// Get artifact rarity from planet level.
/// Noir port of Solidity `LibGameUtils.artifactRarityFromPlanetLevel`.
pub fn artifact_rarity_from_planet_level(level_with_bonus: u8) -> u8 {
    if level_with_bonus <= 1 {
        ARTIFACT_RARITY_COMMON
    } else if level_with_bonus <= 3 {
        ARTIFACT_RARITY_RARE
    } else if level_with_bonus <= 5 {
        ARTIFACT_RARITY_EPIC
    } else if level_with_bonus <= 7 {
        ARTIFACT_RARITY_LEGENDARY
    } else {
        ARTIFACT_RARITY_MYTHIC
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
    let is_nebula_biome = if biome == BIOME_OCEAN {
        true
    } else if biome == BIOME_FOREST {
        true
    } else if biome == BIOME_GRASSLAND {
        true
    } else {
        false
    };

    let is_space_biome = if biome == BIOME_TUNDRA {
        true
    } else if biome == BIOME_SWAMP {
        true
    } else if biome == BIOME_DESERT {
        true
    } else {
        false
    };

    // Determine artifact type based on biome category
    let artifact_type = if is_nebula_biome {
        // Nebula biomes: more likely to get defensive artifacts
        if type_roll < 40 {
            ARTIFACT_TYPE_MONOLITH
        } else if type_roll < 80 {
            ARTIFACT_TYPE_COLOSSUS
        } else if type_roll < 120 {
            ARTIFACT_TYPE_PYRAMID
        } else if type_roll < 160 {
            ARTIFACT_TYPE_WORMHOLE
        } else if type_roll < 200 {
            ARTIFACT_TYPE_PLANETARY_SHIELD
        } else if type_roll < 230 {
            ARTIFACT_TYPE_BLOOM_FILTER
        } else {
            ARTIFACT_TYPE_BLACK_DOMAIN
        }
    } else if is_space_biome {
        // Space biomes: balanced distribution
        if type_roll < 50 {
            ARTIFACT_TYPE_MONOLITH
        } else if type_roll < 100 {
            ARTIFACT_TYPE_COLOSSUS
        } else if type_roll < 140 {
            ARTIFACT_TYPE_PYRAMID
        } else if type_roll < 180 {
            ARTIFACT_TYPE_WORMHOLE
        } else if type_roll < 210 {
            ARTIFACT_TYPE_PHOTOID_CANNON
        } else if type_roll < 240 {
            ARTIFACT_TYPE_BLOOM_FILTER
        } else {
            ARTIFACT_TYPE_BLACK_DOMAIN
        }
    } else {
        // Deep Space/Dead Space biomes: more powerful artifacts
        if type_roll < 30 {
            ARTIFACT_TYPE_MONOLITH
        } else if type_roll < 60 {
            ARTIFACT_TYPE_COLOSSUS
        } else if type_roll < 100 {
            ARTIFACT_TYPE_PYRAMID
        } else if type_roll < 140 {
            ARTIFACT_TYPE_WORMHOLE
        } else if type_roll < 180 {
            ARTIFACT_TYPE_PHOTOID_CANNON
        } else if type_roll < 220 {
            ARTIFACT_TYPE_BLOOM_FILTER
        } else {
            ARTIFACT_TYPE_BLACK_DOMAIN
        }
    };

    // Determine level bonus (0-2) based on space type
    let level_bonus = if space_type == SPACE_TYPE_DEAD_SPACE {
        if bonus_roll < 100 {
            2
        } else if bonus_roll < 200 {
            1
        } else {
            0
        }
    } else if space_type == SPACE_TYPE_DEEP_SPACE {
        if bonus_roll < 80 {
            2
        } else if bonus_roll < 180 {
            1
        } else {
            0
        }
    } else if space_type == SPACE_TYPE_SPACE {
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

/// Get upgrade stats for an artifact.
/// Noir port of Solidity `LibGameUtils._getUpgradeForArtifact`.
///
/// Returns upgrade multipliers (100 = 1x, 150 = 1.5x, etc.)
pub fn get_upgrade_for_artifact(artifact: Artifact) -> Upgrade {
    let rarity = artifact.rarity;
    let artifact_type = artifact.artifact_type;

    // Base multipliers (100 = no change)
    let mut pop_cap_mult: u128 = 100;
    let mut pop_gro_mult: u128 = 100;
    let mut range_mult: u128 = 100;
    let mut speed_mult: u128 = 100;
    let mut def_mult: u128 = 100;

    // Rarity bonus: Common=5%, Rare=10%, Epic=15%, Legendary=20%, Mythic=25%
    let rarity_bonus: u128 = if rarity == ARTIFACT_RARITY_COMMON {
        5
    } else if rarity == ARTIFACT_RARITY_RARE {
        10
    } else if rarity == ARTIFACT_RARITY_EPIC {
        15
    } else if rarity == ARTIFACT_RARITY_LEGENDARY {
        20
    } else if rarity == ARTIFACT_RARITY_MYTHIC {
        25
    } else {
        0
    };

    // Apply artifact type bonuses
    if artifact_type == ARTIFACT_TYPE_MONOLITH {
        // Monolith: Boosts energy cap
        pop_cap_mult = 100 + rarity_bonus * 2;
    } else if artifact_type == ARTIFACT_TYPE_COLOSSUS {
        // Colossus: Boosts energy growth
        pop_gro_mult = 100 + rarity_bonus * 2;
    } else if artifact_type == ARTIFACT_TYPE_PYRAMID {
        // Pyramid: Boosts defense
        def_mult = 100 + rarity_bonus * 2;
    } else if artifact_type == ARTIFACT_TYPE_WORMHOLE {
        // Wormhole: Boosts speed
        speed_mult = 100 + rarity_bonus * 2;
    } else if artifact_type == ARTIFACT_TYPE_PLANETARY_SHIELD {
        // Planetary Shield: Big defense boost
        def_mult = 100 + rarity_bonus * 4;
    } else if artifact_type == ARTIFACT_TYPE_PHOTOID_CANNON {
        // Photoid Cannon: Boosts range and speed
        range_mult = 100 + rarity_bonus * 2;
        speed_mult = 100 + rarity_bonus;
    }
    // BloomFilter and BlackDomain have instant effects, no stat boosts

    Upgrade {
        pop_cap_multiplier: pop_cap_mult,
        pop_gro_multiplier: pop_gro_mult,
        range_multiplier: range_mult,
        speed_multiplier: speed_mult,
        def_multiplier: def_mult,
    }
}

/// Apply buff to planet stats.
/// Noir port of Solidity `LibGameUtils._buffPlanet`.
pub fn buff_planet(mut planet: Planet, upgrade: Upgrade) -> Planet {
    planet.population_cap = (planet.population_cap * upgrade.pop_cap_multiplier) / 100;
    planet.population_growth = (planet.population_growth * upgrade.pop_gro_multiplier) / 100;
    planet.range = (planet.range * upgrade.range_multiplier) / 100;
    planet.speed = (planet.speed * upgrade.speed_multiplier) / 100;
    planet.defense = (planet.defense * upgrade.def_multiplier) / 100;
    planet
}

/// Remove buff from planet stats.
/// Noir port of Solidity `LibGameUtils._debuffPlanet`.
pub fn debuff_planet(mut planet: Planet, upgrade: Upgrade) -> Planet {
    planet.population_cap = (planet.population_cap * 100) / upgrade.pop_cap_multiplier;
    planet.population_growth = (planet.population_growth * 100) / upgrade.pop_gro_multiplier;
    planet.range = (planet.range * 100) / upgrade.range_multiplier;
    planet.speed = (planet.speed * 100) / upgrade.speed_multiplier;
    planet.defense = (planet.defense * 100) / upgrade.def_multiplier;
    planet
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
    assert(planet.planet_type == PLANET_TYPE_RUINS, "you can't find an artifact on this planet");
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
    assert(ship_type >= ARTIFACT_TYPE_SHIP_MOTHERSHIP, "ship type out of range");
    assert(ship_type <= ARTIFACT_TYPE_SHIP_TITAN, "ship type out of range");
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
    location_id: Field,
    level: u8,
    planet_type: u8, // Should be SILVER_MINE (1) for Crescent
    space_type: u8, // NEBULA=0, SPACE=1, DEEP_SPACE=2, DEAD_SPACE=3
    default_stats: ::types::config::default_stats::PlanetDefaultStats,
    time_factor_hundredths: u128,
) -> (u128, u128, u128) {
    // 1. Get base stats from config
    let mut silver_growth = default_stats.silver_growth;
    let mut silver_cap = default_stats.silver_cap;

    // Note: Other stats (population_cap, range, speed, defense) are also modified
    // but for Crescent we only need silver_growth and silver_cap
    let mut population_cap = default_stats.population_cap;
    let mut population_growth = default_stats.population_growth;
    let mut range = default_stats.range;
    let mut speed = default_stats.speed;
    let mut defense = default_stats.defense;

    // 2. Apply location-based boosts (each doubles the stat if byte check passes)
    // Solidity lines 616-630
    if is_pop_cap_boost(location_id) {
        population_cap = population_cap * 2;
    }
    if is_pop_gro_boost(location_id) {
        population_growth = population_growth * 2;
    }
    if is_range_boost(location_id) {
        range = range * 2;
    }
    if is_speed_boost(location_id) {
        speed = speed * 2;
    }
    if is_def_boost(location_id) {
        defense = defense * 2;
    }

    // 3. Apply space type modifiers (Solidity lines 633-666)
    let dead_space = space_type == 3;
    let deep_space = space_type == 2;
    let medium_space = space_type == 1;
    // nebula (space_type == 0) has no modifiers

    if dead_space {
        // DEAD_SPACE: all stats x2, except defense x3/20
        range = range * 2;
        speed = speed * 2;
        population_cap = population_cap * 2;
        population_growth = population_growth * 2;
        silver_cap = silver_cap * 2;
        silver_growth = silver_growth * 2;
        defense = (defense * 3) / 20;
    } else if deep_space {
        // DEEP_SPACE: all stats x3/2, except defense /4
        range = (range * 3) / 2;
        speed = (speed * 3) / 2;
        population_cap = (population_cap * 3) / 2;
        population_growth = (population_growth * 3) / 2;
        silver_cap = (silver_cap * 3) / 2;
        silver_growth = (silver_growth * 3) / 2;
        defense = defense / 4;
    } else if medium_space {
        // SPACE: all stats x5/4, except defense /2
        range = (range * 5) / 4;
        speed = (speed * 5) / 4;
        population_cap = (population_cap * 5) / 4;
        population_growth = (population_growth * 5) / 4;
        silver_cap = (silver_cap * 5) / 4;
        silver_growth = (silver_growth * 5) / 4;
        defense = defense / 2;
    }

    // 4. Apply planet type modifiers (Solidity lines 672-683)
    // For SILVER_MINE (planet_type == 1):
    if planet_type == 1 {
        silver_cap = silver_cap * 2;
        defense = defense / 2;
    }
    // For SILVER_BANK (planet_type == 2):
    // speed /= 2; silver_cap *= 10; population_growth = 0; population_cap *= 5;
    // For TRADING_POST (planet_type == 3):
    // defense /= 2; silver_cap *= 2;
    // (We only implement SILVER_MINE case as Crescent only creates SILVER_MINE)

    // 5. Calculate initial silver for SILVER_MINE (Solidity lines 703-705)
    let initial_silver = if planet_type == 1 {
        silver_cap / 2 // Start at 50% capacity
    } else {
        0
    };

    // 6. Apply time factor (Solidity lines 708-710)
    // speed *= TIME_FACTOR_HUNDREDTHS / 100;
    // population_growth *= TIME_FACTOR_HUNDREDTHS / 100;
    // silver_growth *= TIME_FACTOR_HUNDREDTHS / 100;
    let final_silver_growth = (silver_growth * time_factor_hundredths) / 100;

    (final_silver_growth, silver_cap, initial_silver)
}
