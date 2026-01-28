// Lazy update functions for planets
// Pure computation functions that update planet state based on time elapsed

use crate::types::{Planet, ArrivalData, PlanetEventMetadata};
use dep::aztec::protocol_types::address::AztecAddress;

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
    assert(planet.planet_type == 1, "Can only update silver on silver producing planet");
    
    if planet.owner != AztecAddress::zero() {
        if planet.silver < planet.silver_cap {
            let time_diff: u128 = (update_to_time - planet.last_updated) as u128;
            let silver_mined: u128 = planet.silver_growth * time_diff;

            let max_silver: u128 = planet.silver_cap;
            let current_silver: u128 = planet.silver + silver_mined;
            planet.silver = if max_silver < current_silver { max_silver } else { current_silver };
        }
    }
    // unowned planet doesn't gain silver

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
            let new_population: u128 = if max_population < current_population { max_population } else { current_population };

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
    // PlanetType::SilverBank = 4
    if planet.planet_type == 4 {
        if planet.population > planet.population_cap {
            planet.population = planet.population_cap;
        }
    }
    if planet.pausers > 0 {
        if planet.population > planet.population_cap {
            planet.population = planet.population_cap;
        }
    }

    planet
}

/// Noir port of Solidity `LibLazyUpdate.updatePlanet`.
/// Updates planet population and silver based on time elapsed.
/// This is the main function to call when updating a planet's state.
pub fn update_planet(update_to_time: u64, mut planet: Planet) -> Planet {
    planet = update_population(update_to_time, planet);

    // PlanetType::SilverMine = 1
    if planet.planet_type == 1 {
        planet = update_silver(update_to_time, planet);
    }

    planet.last_updated = update_to_time;

    planet
}

/// Noir port of Solidity `LibLazyUpdate.applyArrival`.
/// Applies an arrival event to a planet.
/// Assumes that the planet last updated time is equal to the arrival time trigger.
/// Returns (carried_artifact_id, updated_planet).
pub fn apply_arrival(mut planet: Planet, arrival: ArrivalData) -> (u128, Planet) {
    // ArrivalType enum values: Unknown=0, Normal=1, Photoid=2, Wormhole=3
    let wormhole_type: u8 = 3; // ArrivalType::Wormhole

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
            planet.owner = if arrival.player == AztecAddress::zero() { planet.owner } else { arrival.player };
            planet.population = arrival.pop_arriving - ((planet.population * planet.defense) / 100);
            if planet.population == 0 {
                // make sure pop is never 0
                planet.population = 1;
            }
        }
    }

    // quasars have 0 energy growth, so they have 0 energy decay as well
    // so don't allow them to become overful
    // PlanetType::SilverBank = 4
    if planet.planet_type == 4 {
        if planet.population > planet.population_cap {
            planet.population = planet.population_cap;
        }
    }
    if planet.pausers > 0 {
        if planet.population > planet.population_cap {
            planet.population = planet.population_cap;
        }
    }

    let max_silver: u128 = planet.silver_cap;
    let next_silver: u128 = planet.silver + arrival.silver_moved;
    planet.silver = if max_silver < next_silver { max_silver } else { next_silver };

    (arrival.carried_artifact_id, planet)
}

/// Noir port of Solidity `LibLazyUpdate.applyPendingEvents`.
/// Applies pending events to a planet.
/// This function processes events in chronological order and updates the planet state.
/// 
/// Note: This function requires the caller to provide ArrivalData for each event.
/// The caller should read ArrivalData from storage before calling this function.
/// The arrivals array should have the same length as events, with each element
/// corresponding to the event at the same index (or a zero-initialized ArrivalData if not applicable).
/// 
/// Returns (updated_planet, event_ids_and_artifacts)
/// - event_ids_and_artifacts: first 12 are event ids to remove, last 12 are artifact ids that are new on the planet
pub fn apply_pending_events(
    current_timestamp: u64,
    mut planet: Planet,
    events: [PlanetEventMetadata; 24],
    events_length: u128,
    arrivals: [ArrivalData; 24],
) -> (Planet, [u128; 24]) {
    // first 12 are event ids to remove
    // last 12 are artifact ids that are new on the planet
    let mut event_ids_and_artifacts: [u128; 24] = [0; 24];

    let mut num_events_to_remove: u128 = 0;
    let mut num_new_artifacts_on_planet: u128 = 0;
    let mut earliest_event_time: u64 = 0;
    let mut earliest_event_index: u128 = 0;
    let mut should_continue: bool = true;

    // Convert do-while loop to for loop with max iterations
    // The original do-while continues while earliestEventTime <= currentTimestamp
    for _i in 0..24 {
        if !should_continue {
            // Equivalent to break - do nothing
        } else {
            if events_length == 0 {
                should_continue = false;
            } else if planet.destroyed {
                should_continue = false;
            } else {
                // set to the upperbound of u64
                earliest_event_time = 18446744073709551615u64;

                // loops through the array and find the earliest event time that hasn't already been applied
                for i in 0..24 {
                    if i < events_length {
                        if events[i as u32].time_trigger < earliest_event_time {
                            let mut should_apply: bool = true;

                            // checks if this event has already been applied.
                            for already_removed_idx in 0..num_events_to_remove {
                                if event_ids_and_artifacts[already_removed_idx as u32] == events[i as u32].id {
                                    should_apply = false;
                                }
                            }

                            if should_apply {
                                earliest_event_time = events[i as u32].time_trigger;
                                earliest_event_index = i;
                            }
                        }
                    }
                }

                // only process the event if it occurs before the current time and the timeTrigger is not 0
                // which comes from uninitialized PlanetEventMetadata
                let max_u64: u64 = 18446744073709551615u64;
                if events[earliest_event_index as u32].time_trigger <= current_timestamp {
                    if earliest_event_time != max_u64 {
                        planet = update_planet(events[earliest_event_index as u32].time_trigger, planet);

                        // PlanetEventType::Arrival = 0
                        if events[earliest_event_index as u32].event_type == 0 {
                            event_ids_and_artifacts[num_events_to_remove as u32] = events[earliest_event_index as u32].id;
                            num_events_to_remove = num_events_to_remove + 1;

                            let arrival_data = arrivals[earliest_event_index as u32];
                            let result = apply_arrival(planet, arrival_data);
                            let new_artifact_id = result.0;
                            planet = result.1;

                            if new_artifact_id != 0 {
                                event_ids_and_artifacts[(12 + num_new_artifacts_on_planet) as u32] = new_artifact_id;
                                num_new_artifacts_on_planet = num_new_artifacts_on_planet + 1;
                            }
                        }
                    }
                }

                // Check if we should continue (equivalent to do-while condition)
                if earliest_event_time > current_timestamp {
                    should_continue = false;
                }
            }
        }
    }

    (planet, event_ids_and_artifacts)
}
