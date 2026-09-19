// Exercise the real Noir implementation against the frozen pre-optimization code.
use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::FromField;
use ::types::storage::{
    arrival::{Arrival, ArrivalType},
    artifact::{Artifact, ArtifactLocation, ArtifactType},
    planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType},
};
use crate::batch_utils::compute_planet_split_roots;

fn check_refresh(count: u32, timestamp: u64, destroyed: bool, with_artifacts: bool) {
    let mut planet = Planet::zero();
    planet.is_initialized = true;
    planet.owner = AztecAddress::from_field(1);
    planet.population = 400;
    planet.population_cap = 10000;
    planet.population_growth = 3;
    planet.silver = 100;
    planet.silver_cap = 10000;
    planet.silver_growth = 2;
    planet.planet_type = PlanetType::SilverMine;
    planet.defense = 100;
    planet.last_updated = 10;
    planet.destroyed = destroyed;
    let mut events = PlanetEvents::zero();
    events.count = count;
    events.last_updated = 9;
    let mut arrivals = [Arrival::zero(); 20];
    let mut artifacts = [Artifact::zero(); 20];
    let mut locations = [ArtifactLocation::zero(); 20];
    for i in 0..20 {
        if i < count {
            let id = (i + 1) as Field;
            events.events[i].id = id;
            arrivals[i].id = id;
            // Unsorted with ties: tie order affects conquest and must be preserved.
            arrivals[i].arrival_time = 11 + ((19 - i) % 7) as u64;
            arrivals[i].player = AztecAddress::from_field((1 + i % 3) as Field);
            arrivals[i].pop_arriving = 50 + (i as u128) * 31;
            arrivals[i].silver_moved = (i as u128) * 7;
            arrivals[i].arrival_type = if i % 4 == 0 {
                ArrivalType::Wormhole
            } else {
                ArrivalType::Normal
            };
            if with_artifacts & (i % 3 == 0) {
                arrivals[i].carried_artifact_id = 100 + id;
                artifacts[i].artifact_type = if i % 2 == 0 {
                    ArtifactType::ShipMothership
                } else {
                    ArtifactType::ShipWhale
                };
                locations[i].voyage_id = id;
            }
        }
    }
    let held = PlanetArtifacts::zero();
    let expected = crate::superboost_reference::refresh_planet_v1(
        timestamp,
        42,
        planet,
        events,
        arrivals,
        artifacts,
        locations,
        held,
    );
    let actual = crate::planet::refresh_planet_v1(
        timestamp,
        42,
        planet,
        events,
        arrivals,
        artifacts,
        locations,
        held,
    );
    assert_eq(actual, expected);
    let expected_v2 = crate::superboost_reference::refresh_planet_v2(
        timestamp,
        42,
        planet,
        events,
        arrivals,
        artifacts,
        locations,
        held,
    );
    let actual_v2 = crate::planet::refresh_planet_v2(
        timestamp,
        42,
        planet,
        events,
        arrivals,
        artifacts,
        locations,
        held,
    );
    assert_eq(actual_v2, expected_v2);
}

#[test]
fn superboost_split_roots_are_authenticated_and_zero_safe() {
    let empty = compute_planet_split_roots(Planet::zero());
    assert(empty == (0, 0, 0, 0, 0));

    let mut planet = Planet::zero();
    planet.is_initialized = true;
    planet.population_cap = 100;
    planet.population = 40;
    let roots = compute_planet_split_roots(planet);
    assert(roots.0 != 0);
    assert(roots.1 != 0);
    assert(roots.2 != 0);
    assert(roots.3 != 0);
    assert(roots.4 != 0);

    let mut changed = Planet::zero();
    changed.is_initialized = true;
    changed.population_cap = 100;
    changed.population = 41;
    let changed_roots = compute_planet_split_roots(changed);
    assert(changed_roots.1 != roots.1);
    assert(changed_roots.4 != roots.4);
    assert(changed_roots.0 == roots.0);
}

#[test]
fn superboost_empty_refresh() {
    check_refresh(0, 20, false, false);
}

#[test]
fn superboost_one_arrival() {
    check_refresh(1, 20, false, false);
}

#[test]
fn superboost_full_queue_unsorted_ties() {
    check_refresh(20, 20, false, false);
}

#[test]
fn superboost_partial_queue_future_events() {
    check_refresh(20, 13, false, false);
}

#[test]
fn superboost_no_due_events() {
    check_refresh(20, 10, false, true);
}

#[test]
fn superboost_spaceship_arrivals() {
    check_refresh(20, 20, false, true);
}

#[test]
fn superboost_destroyed_planet() {
    check_refresh(20, 20, true, true);
}
