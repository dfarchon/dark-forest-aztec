// Planet-related utility functions
// Ported from Solidity LibPlanet
//
// Note: The main function `get_default_init_planet_args` is implemented as an internal
// function in the Main contract (main.nr) because it needs to:
// 1. Call `get_planet_level_type_and_space_type` which requires storage access
// 2. Access world config to get `time_factor_hundredths`
//
// This library file contains pure utility functions that don't require storage access.

use crate::types::{Planet, Artifact};

/// Noir port of Solidity `LibPlanet.applySpaceshipArrive`.
/// Applies spaceship artifact effects to a planet.
/// 
/// This is a pure function that modifies planet stats based on artifact type:
/// - ShipMothership: doubles energy growth (if not already doubled) and increments energyGroDoublers
/// - ShipWhale: doubles silver growth (if not already doubled) and increments silverGroDoublers
/// - ShipTitan: increments pausers
/// 
/// # Arguments
/// - `artifact`: The artifact (spaceship) arriving at the planet
/// - `planet`: The planet to apply the effect to
/// 
/// # Returns
/// The updated planet with spaceship effects applied
pub fn apply_spaceship_arrive(artifact: Artifact, mut planet: Planet) -> Planet {
    // ArtifactType enum values (as u8):
    // ShipMothership = 9
    // ShipWhale = 11
    // ShipTitan = 13
    
    // Only apply effects if not a home planet
    if !planet.is_home_planet {
        if artifact.artifact_type == 9 { // ArtifactType::ShipMothership
            if planet.energy_gro_doublers == 0 {
                planet.population_growth = planet.population_growth * 2;
            }
            planet.energy_gro_doublers += 1;
        } else if artifact.artifact_type == 11 { // ArtifactType::ShipWhale
            if planet.silver_gro_doublers == 0 {
                planet.silver_growth = planet.silver_growth * 2;
            }
            planet.silver_gro_doublers += 1;
        } else if artifact.artifact_type == 13 { // ArtifactType::ShipTitan
            planet.pausers += 1;
        }
    }

    planet
}
