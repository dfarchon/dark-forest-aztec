// Frozen reference from 2bc30f6 for SUPER BOOST differential tests.
// Do not optimize: this is the behavioral oracle, never called by game contracts.
// Lazy update functions for planets
// Pure computation functions that update planet state based on time elapsed
use ::types::storage::arrival::{Arrival, ArrivalType};
use ::types::storage::planet::{
    Planet, PlanetArtifacts, PlanetEventMetadata, PlanetEvents, PlanetType,
};

use ::aztec::protocol::address::AztecAddress;

/// Noir port of Solidity `LibLazyUpdate._updateSilver`.
/// Updates silver for silver-producing planets using linear growth formula.
/// Only called for PlanetType::SilverMine (planet_type == 1).
///
/// This function should never be called directly and should only be called
/// by the refresh planet function. This assert is in place to make sure
/// no one tries to updateSilver on non silver producing planet.
pub fn update_silver(update_to_time: u64, mut planet: Planet) -> Planet {
    // This function should only be called for silver-producing planets
    // PlanetType::SilverMine = 1
    assert(
        planet.planet_type == PlanetType::SilverMine,
        "Can only update silver on silver producing planet",
    );

    if (planet.owner != AztecAddress::zero()) & (planet.pausers == 0) {
        if planet.silver < planet.silver_cap {
            let time_diff: u128 = (update_to_time - planet.last_updated) as u128;
            let silver_mined: u128 = planet.silver_growth * time_diff;

            let max_silver: u128 = planet.silver_cap;
            let current_silver: u128 = planet.silver + silver_mined;
            planet.silver = if max_silver < current_silver {
                max_silver
            } else {
                current_silver
            };
        }
    }
    // unowned planet doesn't gain silver; paused planet doesn't gain silver

    planet
}

/// Noir port of Solidity `LibLazyUpdate._updatePopulation`.
/// Updates population using linear growth formula (similar to silver growth).
/// Uses simple linear growth instead of exponential formula from ABDKMath64x64.
pub fn update_population(update_to_time: u64, mut planet: Planet) -> Planet {
    if planet.owner != AztecAddress::zero() {
        // Use linear growth formula similar to silver growth
        if planet.population < planet.population_cap {
            let time_diff: u128 = (update_to_time - planet.last_updated) as u128;
            let population_gained: u128 = planet.population_growth * time_diff;

            let max_population: u128 = planet.population_cap;
            let current_population: u128 = planet.population + population_gained;
            let new_population: u128 = if max_population < current_population {
                max_population
            } else {
                current_population
            };

            // If paused, no energy growth
            if planet.pausers == 0 {
                planet.population = new_population;
            } else if new_population <= planet.population {
                planet.population = new_population;
            }
        }
    }
    // unowned planet doesn't increase in population

    // quasars (SilverBank) have 0 energy growth, so they have 0 energy decay as well
    // so don't allow them to become overful
    // if (planet.planet_type == PlanetType::SilverBank) | (planet.pausers > 0) {
    //     if planet.population > planet.population_cap {
    //         planet.population = planet.population_cap;
    //     }
    // }

    // If planet.population exceeds population_cap, cap it to population_cap
    if planet.population > planet.population_cap {
        planet.population = planet.population_cap;
    }

    planet
}

/// Noir port of Solidity `LibLazyUpdate.updatePlanet`.
/// Updates planet population and silver based on time elapsed.
/// This is the main function to call when updating a planet's state.
pub fn update_planet(update_to_time: u64, mut planet: Planet) -> Planet {
    planet = update_population(update_to_time, planet);

    if planet.planet_type == PlanetType::SilverMine {
        planet = update_silver(update_to_time, planet);
    }

    planet.last_updated = update_to_time;

    planet
}

/// Noir port of Solidity `LibLazyUpdate.applyArrival`.
/// Applies an arrival event to a planet.
/// Assumes that the planet last updated time is equal to the arrival time trigger.
/// Returns (carried_artifact_id, updated_planet).
pub fn apply_arrival(mut planet: Planet, arrival: Arrival) -> (Field, Planet) {
    // ArrivalType enum values: Unknown=0, Normal=1, Photoid=2, Wormhole=3
    let wormhole_type: u8 = ArrivalType::Wormhole;

    // checks whether the planet is owned by the player sending ships
    if arrival.player == planet.owner {
        // simply increase the population if so
        planet.population = planet.population + arrival.pop_arriving;
    } else {
        if arrival.arrival_type == wormhole_type {
            // if this is a wormhole arrival to a planet that isn't owned by the initiator of
            // the move, then don't move any energy
        } else if planet.population > (arrival.pop_arriving * 100) / planet.defense {
            // handles if the planet population is bigger than the arriving ships
            // simply reduce the amount of planet population by the arriving ships
            planet.population = planet.population - ((arrival.pop_arriving * 100) / planet.defense);
        } else {
            // handles if the planet population is equal or less the arriving ships
            // reduce the arriving ships amount with the current population and the
            // result is the new population of the planet now owned by the attacking
            // player

            // This is the zero address so that ships moving to an unowned planet with
            // no barbarians don't cause the planet to be conquered by the ship's controller.
            planet.owner = if arrival.player == AztecAddress::zero() {
                planet.owner
            } else {
                arrival.player
            };
            planet.population = arrival.pop_arriving - ((planet.population * planet.defense) / 100);
            if planet.population == 0 {
                // make sure pop is never 0
                planet.population = 1;
            }
        }
    }

    if planet.population > planet.population_cap {
        planet.population = planet.population_cap;
    }

    let max_silver: u128 = planet.silver_cap;
    let next_silver: u128 = planet.silver + arrival.silver_moved;
    planet.silver = if max_silver < next_silver {
        max_silver
    } else {
        next_silver
    };

    (arrival.carried_artifact_id, planet)
}

/// Noir port of Solidity `LibLazyUpdate.applyPendingEvents`.
/// Applies pending events to a planet.
/// This function processes events in chronological order and updates the planet state.
///
/// Note: This function requires the caller to provide Arrival for each event.
/// The caller should read Arrival from storage before calling this function.
/// The arrivals array should have the same length as events, with each element
/// corresponding to the event at the same index (or a zero-initialized Arrival if not applicable).
///
/// Returns (updated_planet, events_to_remove, artifacts_to_add)
pub fn apply_pending_events(
    current_timestamp: u64,
    mut planet: Planet,
    planet_events: PlanetEvents,
    arrivals: [Arrival; 20],
) -> (Planet, PlanetEvents, PlanetArtifacts) {
    let mut events_to_remove: PlanetEvents = PlanetEvents::zero();
    let mut artifacts_to_add: PlanetArtifacts = PlanetArtifacts::zero();

    let mut earliest_event_time: u64 = 0;
    let mut earliest_event_index: u32 = 0;

    let mut should_continue: bool = true;

    // Use fixed array size 20 as compile-time constant for loop bound
    // Runtime count check is done inside the loop
    for _ in 0..20 {
        if !should_continue {
            // Equivalent to break - do nothing
        } else if (planet_events.count == 0) | planet.destroyed {
            should_continue = false;
        } else {
            // set to the upperbound of u64
            earliest_event_time = 18446744073709551615u64;

            // loops through the array and find the earliest event time that hasn't already been applied
            // PlanetEventMetadata only has id; use arrivals[i].arrival_time for ordering (index-aligned)
            for i in 0..20 {
                if i < planet_events.count {
                    let arrival_time: u64 = arrivals[i].arrival_time;
                    if arrival_time < earliest_event_time {
                        let mut should_apply: bool = true;
                        for already_removed_idx in 0..20 {
                            if already_removed_idx < events_to_remove.count {
                                if events_to_remove.events[already_removed_idx].id
                                    == planet_events.events[i].id {
                                    should_apply = false;
                                }
                            }
                        }
                        if should_apply {
                            earliest_event_time = arrival_time;
                            earliest_event_index = i;
                        }
                    }
                }
            }

            // only process the event if it occurs before the current time and arrival_time is not 0
            let max_u64: u64 = 18446744073709551615u64;
            if arrivals[earliest_event_index].arrival_time <= current_timestamp {
                if earliest_event_time != max_u64 {
                    planet = update_planet(arrivals[earliest_event_index].arrival_time, planet);

                    // All events in PlanetEvents are Arrival events (PlanetEventMetadata has no event_type)
                    let arrival_id = planet_events.events[earliest_event_index].id;
                    events_to_remove.events[events_to_remove.count].id = arrival_id;
                    events_to_remove.count = events_to_remove.count + 1;

                    let arrival_data: Arrival = arrivals[earliest_event_index];

                    let result = apply_arrival(planet, arrival_data);
                    let new_artifact_id = result.0;
                    planet = result.1;

                    if new_artifact_id != 0 {
                        // if the arrival is carrying an artifact
                        artifacts_to_add.ids[artifacts_to_add.count] = new_artifact_id;
                        artifacts_to_add.count = artifacts_to_add.count + 1;
                    }
                } else {
                    should_continue = false;
                }
            } else {
                should_continue = false;
            }
        }
    }
    (planet, events_to_remove, artifacts_to_add)
}

use crate::game_utils::_put_artifact_on_planet;
use crate::planet::apply_spaceship_arrive;
use ::types::storage::artifact::{Artifact, ArtifactLocation};
pub fn get_refreshed_planet(
    location_id: Field,
    timestamp: u64,
    mut planet: Planet,
    planet_events: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    planet_artifacts_state: PlanetArtifacts,
) -> (Planet, PlanetEvents, PlanetArtifacts) {
    let res = apply_pending_events(timestamp, planet, planet_events, arrivals);

    planet = res.0;
    let events_to_remove = res.1;
    let artifacts_to_add = res.2;

    // Use fixed array size 20 as compile-time constant for loop bound
    // Runtime count check is done inside the loop
    for i in 0..20 {
        if i < artifacts_to_add.count {
            let artifact_id = artifacts_to_add.ids[i];
            let mut artifact: Artifact = Artifact::zero();

            for j in 0..20 {
                if arrivals[j].carried_artifact_id == artifact_id {
                    artifact = artifacts[j];
                }
            }
            planet = apply_spaceship_arrive(artifact, planet);
        }
    }
    planet = update_planet(timestamp, planet);

    (planet, events_to_remove, artifacts_to_add)
}

pub fn refresh_planet_v1(
    timestamp: u64,
    location_id: Field,
    mut planet: Planet,
    mut planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    mut artifact_locations: [ArtifactLocation; 20],
    mut planet_artifacts_state: PlanetArtifacts,
) -> (Planet, PlanetEvents, PlanetArtifacts, [ArtifactLocation; 20]) {
    // assert(planet.is_initialized, "Planet is not initialized");

    let result = get_refreshed_planet(
        location_id,
        timestamp,
        planet,
        planet_events_state,
        arrivals,
        artifacts,
        planet_artifacts_state,
    );

    planet = result.0;
    let events_to_remove = result.1;
    let artifacts_to_add = result.2;

    let original_event_count = planet_events_state.count;

    for i in 0..20 {
        if i < events_to_remove.count {
            let event_id = events_to_remove.events[i].id;

            let mut found: bool = false;
            for j in 0..20 {
                if j < planet_events_state.count {
                    if !found {
                        if planet_events_state.events[j].id == event_id {
                            let last_idx = planet_events_state.count - 1;
                            planet_events_state.events[j] = planet_events_state.events[last_idx];
                            planet_events_state.events[last_idx] = PlanetEventMetadata::zero();
                            planet_events_state.count = last_idx;
                            found = true;
                        }
                    }
                }
            }
        }
    }

    for i in 0..20 {
        if i < artifacts_to_add.count {
            let artifact_id = artifacts_to_add.ids[i];

            let mut artifact_loc_idx: u32 = 0;
            for j in 0..20 {
                if arrivals[j].carried_artifact_id == artifact_id {
                    artifact_loc_idx = j;
                }
            }
            artifact_locations[artifact_loc_idx].voyage_id = 0;
            let res = _put_artifact_on_planet(
                artifact_id,
                artifact_locations[artifact_loc_idx],
                location_id,
                planet_artifacts_state,
            );
            planet_artifacts_state = res.3;
            artifact_locations[artifact_loc_idx] = res.1;
        }
    }

    (planet, planet_events_state, planet_artifacts_state, artifact_locations)
}

pub fn refresh_planet_v2(
    timestamp: u64,
    location_id: Field,
    planet: Planet,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    arrival_artifacts: [Artifact; 20],
    arrival_artifact_locations: [ArtifactLocation; 20],
    planet_artifacts_state: PlanetArtifacts,
) -> (Planet, PlanetEvents, PlanetArtifacts, u32, [Field; 20], [ArtifactLocation; 20], [u32; 20]) {
    let mut new_planet = planet;
    let mut new_planet_events_state = planet_events_state;
    let mut new_planet_artifacts_state = planet_artifacts_state;

    let result = get_refreshed_planet(
        location_id,
        timestamp,
        new_planet,
        new_planet_events_state,
        arrivals,
        arrival_artifacts,
        new_planet_artifacts_state,
    );

    new_planet = result.0;
    let events_to_remove = result.1;
    let artifacts_to_add = result.2;

    for i in 0..20 {
        if i < events_to_remove.count {
            let event_id = events_to_remove.events[i].id;
            let mut found: bool = false;
            for j in 0..20 {
                if j < new_planet_events_state.count {
                    if !found {
                        if new_planet_events_state.events[j].id == event_id {
                            let last_idx = new_planet_events_state.count - 1;
                            new_planet_events_state.events[j] =
                                new_planet_events_state.events[last_idx];
                            new_planet_events_state.events[last_idx] = PlanetEventMetadata::zero();
                            new_planet_events_state.count = last_idx;
                            found = true;
                        }
                    }
                }
            }
        }
    }

    let mut changed_artifact_location_count: u32 = 0;
    let mut changed_artifact_location_ids: [Field; 20] = [0; 20];
    let mut changed_artifact_locations: [ArtifactLocation; 20] = [ArtifactLocation::zero(); 20];
    let mut changed_artifact_arrival_indices: [u32; 20] = [0; 20];

    for i in 0..20 {
        if i < artifacts_to_add.count {
            let artifact_id = artifacts_to_add.ids[i];
            let mut artifact_loc_idx: u32 = 0;
            for j in 0..20 {
                if arrivals[j].carried_artifact_id == artifact_id {
                    artifact_loc_idx = j;
                }
            }
            let mut artifact_location = arrival_artifact_locations[artifact_loc_idx];
            artifact_location.voyage_id = 0;
            let res = _put_artifact_on_planet(
                artifact_id,
                artifact_location,
                location_id,
                new_planet_artifacts_state,
            );
            new_planet_artifacts_state = res.3;

            changed_artifact_location_ids[changed_artifact_location_count] = artifact_id;
            changed_artifact_locations[changed_artifact_location_count] = res.1;
            changed_artifact_arrival_indices[changed_artifact_location_count] = artifact_loc_idx;
            changed_artifact_location_count += 1;
        }
    }

    (
        new_planet, new_planet_events_state, new_planet_artifacts_state,
        changed_artifact_location_count, changed_artifact_location_ids, changed_artifact_locations,
        changed_artifact_arrival_indices,
    )
}
