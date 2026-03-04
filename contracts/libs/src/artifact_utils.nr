// Artifact utility functions - Pure functions for artifact management
// Ported from Solidity LibArtifactUtils.sol

use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::hash::poseidon2_hash;
use ::types::args::DFTCreateArtifactArgs;
use ::types::config::upgrade::Upgrade;
use ::types::storage::arrival::Arrival;
use ::types::storage::artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType};
use ::types::storage::planet::{Biome, Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType};

// == Check / Find helpers ==
// Solidity: LibArtifactUtils.checkFindArtifact -> createAndPlaceSpaceship -> findArtifact

/// TODO: checkFindArtifact glue lives in `ArtifactSystem.find_artifact` + `artifact_utils::contains_gear`.
// pub fn check_find_artifact_...?  // no extra reuse, keep inline for now.

/// Build (artifact_id, DFTCreateArtifactArgs) for a spaceship.
/// Solidity: LibArtifactUtils.createAndPlaceSpaceship (args construction part).
/// Caller does create_artifact(args) and push_artifact_id (contract/storage).
pub fn create_and_place_spaceship(
    planet_id: Field,
    controller: AztecAddress,
    ship_type: u8,
    nonce: u32,
) -> (Field, DFTCreateArtifactArgs) {
    assert(ship_type >= ArtifactType::ShipMothership(), "ship type out of range");
    assert(ship_type <= ArtifactType::ShipTitan(), "ship type out of range");
    let artifact_id = poseidon2_hash([planet_id, nonce as Field]);
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

/// TODO: findArtifact orchestration stays in `ArtifactSystem.find_artifact` (refresh + SNARK + hashes + enqueue).
// pub fn find_artifact_logic_...?  // pure pieces already live in libs; a wrapper would be huge.

/// Resolve the [Artifact; 20] structs array for a post-refresh PlanetArtifacts: for each id in
/// new_planet_artifacts, look up the struct from the existing planet array or from incoming arrivals.
/// Solidity: helper for LibArtifactUtils.findArtifact post-refresh resolution.
pub fn resolve_artifact_structs(
    new_planet_artifacts: PlanetArtifacts,
    current_ids: PlanetArtifacts,
    current_structs: [Artifact; 20],
    planet_events: PlanetEvents,
    arrivals: [Arrival; 20],
    arrival_structs: [Artifact; 20],
    planet_id: Field,
) -> [Artifact; 20] {
    let mut result: [Artifact; 20] = [Artifact::zero(); 20];
    for k in 0..20 {
        if k < new_planet_artifacts.count {
            let id = new_planet_artifacts.ids[k];
            let mut found = false;
            for i in 0..20 {
                if i < current_ids.count {
                    if current_ids.ids[i] == id {
                        result[k] = current_structs[i];
                        found = true;
                    }
                }
            }
            if !found {
                for j in 0..20 {
                    if j < planet_events.count {
                        let to_this = arrivals[j].to_planet == planet_id;
                        let same_id = arrivals[j].carried_artifact_id == id;
                        if to_this & same_id {
                            result[k] = arrival_structs[j];
                            found = true;
                        }
                    }
                }
            }
        }
    }
    result
}

// == Activate / Deactivate helpers ==
// Solidity: LibArtifactUtils.activateArtifact -> activateSpaceshipArtifact -> activateNonSpaceshipArtifact -> deactivateArtifact

/// TODO: activateArtifact glue remains in `ArtifactSystem.activate_artifact` (refresh + storage + events).
// pub fn activate_artifact_logic_...?  // libs only hold small pure pieces (cooldowns, buffs, Crescent math).

/// TODO: activateSpaceshipArtifact - Crescent logic is split: math in `default_silver_stats`, glue in `ArtifactSystem.activate_artifact`.
// pub fn activate_spaceship_artifact_logic_...?  // no second wrapper needed yet.

/// Calculate default planet stats for a given level and type.
/// This is primarily used by Crescent spaceship to convert a planet to SILVER_MINE.
/// Ported from Solidity LibGameUtils._defaultPlanet (lines 589-711), used by LibArtifactUtils.activateSpaceshipArtifact.
/// Returns: (silver_growth, silver_cap, initial_silver)
pub fn default_silver_stats(
    planet_type: u8, // Should be SILVER_MINE (1) for Crescent
    space_type: u8, // NEBULA=0, SPACE=1, DEEP_SPACE=2, DEAD_SPACE=3
    default_stats: ::types::config::default_stats::PlanetDefaultStats,
    time_factor_hundredths: u128,
) -> (u128, u128, u128) {
    // 1. Get base stats from config
    let mut silver_growth = default_stats.silver_growth;
    let mut silver_cap = default_stats.silver_cap;

    // 2. Apply space type modifiers (Solidity lines 633-666)
    let dead_space = space_type == 3;
    let deep_space = space_type == 2;
    let medium_space = space_type == 1;
    // nebula (space_type == 0) has no modifiers

    if dead_space {
        silver_cap = silver_cap * 2;
        silver_growth = silver_growth * 2;
    } else if deep_space {
        silver_cap = (silver_cap * 3) / 2;
        silver_growth = (silver_growth * 3) / 2;
    } else if medium_space {
        silver_cap = (silver_cap * 5) / 4;
        silver_growth = (silver_growth * 5) / 4;
    }

    // 3. Apply planet type modifiers (Solidity lines 672-683)
    // For SILVER_MINE (planet_type == 1):
    if planet_type == 1 {
        silver_cap = silver_cap * 2;
    }
    // For SILVER_BANK (planet_type == 2):
    // speed /= 2; silver_cap *= 10; population_growth = 0; population_cap *= 5;
    // For TRADING_POST (planet_type == 3):
    // defense /= 2; silver_cap *= 2;
    // (We only implement SILVER_MINE case as Crescent only creates SILVER_MINE)

    // 4. Calculate initial silver for SILVER_MINE (Solidity lines 703-705)
    let initial_silver = if planet_type == 1 {
        silver_cap / 2 // Start at 50% capacity
    } else {
        0
    };

    // 5. Apply time factor (Solidity lines 708-710)
    // speed *= TIME_FACTOR_HUNDREDTHS / 100;
    // population_growth *= TIME_FACTOR_HUNDREDTHS / 100;
    // silver_growth *= TIME_FACTOR_HUNDREDTHS / 100;
    let final_silver_growth = (silver_growth * time_factor_hundredths) / 100;

    (final_silver_growth, silver_cap, initial_silver)
}

/// TODO: activateNonSpaceshipArtifact - checks + cooldown + buff/burn; pure bits already in libs.
// pub fn activate_non_spaceship_artifact_logic_...?  // system glue is one-off.

/// Get artifact cooldown in seconds based on artifact type.
/// Noir port of the cooldown array from Solidity `LibArtifactUtils.activateNonSpaceshipArtifact`.
///
/// Returns cooldown in seconds (0 means no cooldown).
pub fn artifact_cooldown_seconds(artifact_type: u8) -> u64 {
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

/// TODO: deactivateArtifact logic mostly lives in `ArtifactSystem.deactivate_artifact` + `debuff_planet_with_artifact`.
// pub fn deactivate_artifact_logic_...?  // wrapper would mirror the system method.

// == Deposit / Withdraw helpers ==
// Solidity: LibArtifactUtils.depositArtifact -> withdrawArtifact

/// TODO: depositArtifact logic lives in `ArtifactSystem.deposit_artifact` (storage + token transfer).
// pub fn deposit_artifact_logic_...?  // no pure extraction needed; all storage-dependent.

/// TODO: withdrawArtifact logic lives in `ArtifactSystem.withdraw_artifact` (storage + token transfer).
// pub fn withdraw_artifact_logic_...?  // no pure extraction needed; all storage-dependent.

// == Prospect helpers ==
// Solidity: LibArtifactUtils.prospectPlanet

/// Pure logic for prospect: validate and return updated planet (prospected_block_number, last_updated set).
/// Solidity: LibArtifactUtils.prospectPlanet (pure logic port).
/// Caller (contract) does verify_hash and storage set.
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

// == Misc / Type helpers ==
// Solidity: LibArtifactUtils.containsGear -> isSpaceship

/// Noir port of Solidity `LibArtifactUtils.containsGear`. Pure so it can be used in private context.
pub fn contains_gear(
    controller: AztecAddress,
    planet_artifacts: PlanetArtifacts,
    artifacts: [Artifact; 20],
) -> bool {
    let mut found: bool = false;
    for i in 0..20 {
        if (i < planet_artifacts.count) & !found {
            let artifact = artifacts[i as u32];
            if (artifact.artifact_type == ArtifactType::ShipGear())
                & (artifact.controller == controller) {
                found = true;
            }
        }
    }
    found
}

/// Noir port of Solidity `LibArtifactUtils.isSpaceship`.
/// Checks if an artifact type is a spaceship (ShipMothership..ShipTitan).
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
