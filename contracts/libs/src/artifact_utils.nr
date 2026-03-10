use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::hash::poseidon2_hash;
use ::types::args::DFTCreateArtifactArgs;
use ::types::config::upgrade::Upgrade;
use ::types::storage::arrival::Arrival;
use ::types::storage::artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType};
use ::types::storage::planet::{Biome, Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType};

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

/// Noir port of Solidity `LibGameUtils.activateSpaceshipArtifact`.

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
