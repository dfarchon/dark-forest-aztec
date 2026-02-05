// Lazy update functions for planets
// Pure computation functions that update planet state based on time elapsed
use dep::types::args::{AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs};

use dep::types::config::{
    ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetDefaultStats,
    PlanetLevelThresholds, PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig,
    Upgrade, WorldConfig,
};

use dep::types::storage::{
    Arrival, ArrivalType, Artifact, ArtifactRarity, ArtifactState, ArtifactType, GlobalState,
    Planet, PlanetArtifacts, PlanetCaps, PlanetData, PlanetEventMetadata, PlanetEvents,
    PlanetEventType, PlanetFullState, PlanetMeta, PlanetMods, PlanetOwner, PlanetResources,
    PlanetType, Player, RevealedCoords, SpaceType, StateRoot, UpgradeBranch,
};

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
            planet.silver = if max_silver < current_silver {
                max_silver
            } else {
                current_silver
            };
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
pub fn apply_arrival(mut planet: Planet, arrival: Arrival) -> (Field, Planet) {
    // ArrivalType enum values: Unknown=0, Normal=1, Photoid=2, Wormhole=3
    let wormhole_type: u8 = ArrivalType::Wormhole();

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
/// Returns (updated_planet, event_ids_and_artifacts)
/// - event_ids_and_artifacts: first 12 are event ids to remove, last 12 are artifact ids that are new on the planet
pub fn apply_pending_events(
    current_timestamp: u64,
    mut planet: Planet,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
) -> (Planet, PlanetEvents, PlanetArtifacts) {
    let mut events_to_remove: PlanetEvents = PlanetEvents::zero();
    let mut artifacts_to_add: PlanetArtifacts = PlanetArtifacts::zero();

    let mut earliest_event_time: u64 = 0;
    let mut earliest_event_index: u32 = 0;

    let mut should_continue: bool = true;

    let max_cnt = planet_events_state.events_count;

    for _ in 0..max_cnt {
        if !should_continue {
            // Equivalent to break - do nothing
        } else if planet_events_state.events_count == 0 | planet.destroyed {
            should_continue = false;
        } else {
            // set to the upperbound of u64
            earliest_event_time = 18446744073709551615u64;

            // loops through the array and find the earliest event time that hasn't already been applied
            for i in 0..planet_events_state.events_count {
                if planet_events_state.events[i].time_trigger < earliest_event_time {
                    let mut should_apply: bool = true;
                    for already_removed_idx in 0..events_to_remove.events_count {
                        if events_to_remove.events[already_removed_idx].id
                            == planet_events_state.events[i].id {
                            should_apply = false;
                        }
                    }
                    if should_apply {
                        earliest_event_time = planet_events_state.events[i].time_trigger;
                        earliest_event_index = i;
                    }
                }
            }

            // only process the event if it occurs before the current time and the timeTrigger is not 0
            // which comes from uninitialized PlanetEventMetadata

            let max_u64: u64 = 18446744073709551615u64;
            if planet_events_state.events[earliest_event_index].time_trigger <= current_timestamp {
                if earliest_event_time != max_u64 {
                    planet = update_planet(
                        planet_events_state.events[earliest_event_index].time_trigger,
                        planet,
                    );

                    // PlanetEventType::Arrival = 0
                    if planet_events_state.events[earliest_event_index].event_type
                        == PlanetEventType::Arrival() {
                        let arrival_id = planet_events_state.events[earliest_event_index].id;
                        events_to_remove.events[events_to_remove.events_count] = arrival_id;
                        events_to_remove.events_count = events_to_remove.events_count + 1;

                        let mut arrival_data: Arrival = Arrival::zero();

                        for i in 0..planet_events_state.events_count {
                            if arrivals[i].id == arrival_id {
                                arrival_data = arrivals[i];
                            }
                        }

                        let result = apply_arrival(planet, arrival_data);
                        let new_artifact_id = result.0;
                        planet = result.1;

                        if new_artifact_id != 0 {
                            // if the arrival is carrying an artifact
                            artifacts_to_add.artifacts[artifacts_to_add.artifacts_count] =
                                new_artifact_id;
                            artifacts_to_add.artifacts_count = artifacts_to_add.artifacts_count + 1;
                        }
                    }
                }
            }
        }
    }
    (planet, events_to_remove, artifacts_to_add)
}
