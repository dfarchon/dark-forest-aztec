use crate::game_utils::{_default_planet, assert_nonzero_artifact_id};
use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::hash::poseidon2_hash;
use ::types::args::DFTCreateArtifactArgs;
use ::types::config::default_stats::PlanetDefaultStats;
use ::types::config::upgrade::Upgrade;
use ::types::storage::arrival::Arrival;
use ::types::storage::artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType};
use ::types::storage::planet::{Biome, Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType};

/// Dark Forest `notTokenEnded`: minting is open only while `timestamp` is strictly
/// before `token_mint_end_timestamp`. Equal to the deadline is closed.
pub fn assert_token_mint_open(timestamp: u64, token_mint_end_timestamp: u64) {
    assert(timestamp < token_mint_end_timestamp, "Token mint period has ended");
}

/// Noir port of Solidity `LibGameUtils.checkFindArtifact`.
pub fn check_find_artifact(
    planet: Planet,
    planet_artifacts: PlanetArtifacts,
    artifacts: [Artifact; 20],
    block_number: u32,
    sender: AztecAddress,
    gear_required: bool,
) {
    assert(!planet.has_tried_finding_artifact, "artifact already minted from this planet");
    assert(planet.owner == sender, "you can only find artifacts on planets you own");
    assert(planet.prospected_block_number != 0, "planet never prospected");
    assert(
        planet.prospected_block_number < block_number,
        "can only call findArtifact after prospectedBlockNumber",
    );
    assert((block_number - planet.prospected_block_number) < 256, "planet prospect expired");
    assert(!planet.destroyed, "planet is destroyed");
    if gear_required {
        assert(
            contains_gear(sender, planet_artifacts, artifacts),
            "gear ship must be present on planet",
        );
    }
}

/// Noir port of Solidity `LibGameUtils.createAndPlaceSpaceship`.
pub fn create_and_place_spaceship(
    planet_id: Field,
    owner: AztecAddress,
    ship_type: u8,
    miscNonce: u32,
) -> (Field, DFTCreateArtifactArgs) {
    assert(ship_type >= ArtifactType::ShipMothership, "ship type out of range");
    assert(ship_type <= ArtifactType::ShipTitan, "ship type out of range");

    let artifact_id = poseidon2_hash([planet_id, miscNonce as Field]);
    assert_nonzero_artifact_id(artifact_id);

    let create_artifact_args = DFTCreateArtifactArgs {
        id: artifact_id,
        discoverer: owner,
        planet_id: planet_id,
        rarity: ArtifactRarity::Unknown,
        biome: Biome::Unknown,
        artifact_type: ship_type,
        controller: owner,
    };

    // The `_put_artifact_on_planet` is handled by the outer function

    (artifact_id, create_artifact_args)
}

/// Noir port of Solidity `LibGameUtils.findArtifact`.

/// Noir port of Solidity `LibGameUtils.activateArtifact`.

/// Noir port of Solidity `LibGameUtils.activateSpaceshipArtifact` (checks only).
/// Only the Crescent has an activation effect; activating any other ship would just bump
/// `activations` / `last_updated` and invalidate the controller's pending proofs.
pub fn assert_can_activate_spaceship(artifact: Artifact, planet: Planet, sender: AztecAddress) {
    assert(artifact.controller == sender, "you can only activate a spaceship you control");
    assert(
        artifact.artifact_type == ArtifactType::ShipCrescent,
        "only the crescent can be activated",
    );
    assert(artifact.activations == 0, "crescent cannot be activated more than once");
    assert(
        planet.planet_type != PlanetType::SilverMine,
        "cannot turn a silver mine into a silver mine",
    );
    assert(planet.owner == AztecAddress::zero(), "can only activate crescent on unowned planets");
    assert(planet.planet_level >= 1, "planet level must be more than one");
}

/// Turns an unowned planet into a silver mine using the default mine of the same
/// location, level, and space type. Diverges from Dark Forest v0.6, which copied
/// `silverGrowth` only when `silver == 0` and left cap and defense unchanged.
///
/// Growth, cap, and defense are taken from that default mine. They already include
/// location boosts, space-type multipliers, and the mine's cap doubling and defense
/// halving, so they must not be applied again on top of the planet's current stats.
/// A whale already on the planet (`silver_gro_doublers > 0`) doubled a zero growth
/// rate when it arrived; double the copied rate once so its departure does not halve it.
/// Existing silver is kept. Empty planets are seeded with 1. Silver above the new cap
/// is clamped. Population, range, speed, and owner stay as they are.
pub fn apply_crescent(
    mut planet: Planet,
    location_id: Field,
    time_factor_hundredths: u16,
    planet_default_stats: PlanetDefaultStats,
) -> Planet {
    let default_planet = _default_planet(
        location_id,
        planet.planet_level,
        PlanetType::SilverMine,
        planet.space_type,
        time_factor_hundredths,
        planet_default_stats,
    );

    planet.silver_growth = default_planet.silver_growth;
    planet.silver_cap = default_planet.silver_cap;
    planet.defense = default_planet.defense;
    if planet.silver_gro_doublers > 0 {
        planet.silver_growth *= 2;
    }
    if planet.silver == 0 {
        planet.silver = 1;
    }
    if planet.silver > planet.silver_cap {
        planet.silver = planet.silver_cap;
    }
    planet.planet_type = PlanetType::SilverMine;

    planet
}

/// Noir port of Solidity `LibGameUtils.activateNonSpaceshipArtifact`.

/// Noir port of Solidity `LibGameUtils.deactivateArtifact`.

/// Noir port of Solidity `LibGameUtils.depositArtifact`.

/// Noir port of Solidity `LibGameUtils.withdrawArtifact`.

/// Noir port of Solidity `LibGameUtils.prospectPlanet`.

/// Noir port of Solidity `LibArtifactUtils.containsGear`.
pub fn contains_gear(
    controller: AztecAddress,
    planet_artifacts: PlanetArtifacts,
    artifacts: [Artifact; 20],
) -> bool {
    let mut found: bool = false;
    for i in 0..20 {
        if (i < planet_artifacts.count) & !found {
            let artifact = artifacts[i as u32];
            if (artifact.artifact_type == ArtifactType::ShipGear)
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
    if artifact_type >= ArtifactType::ShipMothership {
        artifact_type <= ArtifactType::ShipTitan
    } else {
        false
    }
}

pub fn artifact_from_create_args(
    args: DFTCreateArtifactArgs,
    owner: AztecAddress,
    timestamp: u64,
) -> Artifact {
    Artifact {
        planet_discovered_on: args.planet_id,
        rarity: args.rarity,
        planet_biome: args.biome,
        minted_at_timestamp: timestamp,
        discoverer: args.discoverer,
        artifact_type: args.artifact_type,
        activations: 0,
        last_activated: 0,
        last_deactivated: 0,
        wormhole_to: 0 as Field,
        owner: AztecAddress::zero(),
        controller: owner,
        last_updated: timestamp,
    }
}
