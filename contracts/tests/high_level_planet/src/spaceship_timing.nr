// Spaceship timing (H-05): a carried ship takes effect when its arrival lands, before any
// later arrival in the same refresh, and only once.
use crate::{CREATED_AT, enemy, new_planet, PLAIN_LOCATION};
use ::aztec::protocol::address::AztecAddress;
use ::libs::lazy_update::{apply_arrival, update_planet};
use ::libs::planet::get_refreshed_planet;
use ::types::storage::{
    arrival::{Arrival, ArrivalType},
    artifact::{Artifact, ArtifactType},
    planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType},
};

global SHIP_LANDS: u64 = CREATED_AT + 100;
global ATTACK_LANDS: u64 = CREATED_AT + 200;

/// Owned, half full, so energy keeps growing.
fn growing_planet() -> Planet {
    let mut planet = new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::Nebula);
    planet.population = planet.population_cap / 2;
    planet
}

fn ship_arrival(id: Field, arrival_time: u64) -> Arrival {
    let mut arrival = Arrival::zero();
    arrival.id = id;
    arrival.to_planet = PLAIN_LOCATION;
    arrival.arrival_type = ArrivalType::Normal;
    arrival.player = AztecAddress::zero();
    arrival.carried_artifact_id = id;
    arrival.arrival_time = arrival_time;
    arrival
}

fn attack_arrival(id: Field, arrival_time: u64, pop_arriving: u128) -> Arrival {
    let mut arrival = Arrival::zero();
    arrival.id = id;
    arrival.to_planet = PLAIN_LOCATION;
    arrival.arrival_type = ArrivalType::Normal;
    arrival.player = enemy();
    arrival.pop_arriving = pop_arriving;
    arrival.arrival_time = arrival_time;
    arrival
}

fn ship(artifact_type: u8) -> Artifact {
    let mut artifact = Artifact::zero();
    artifact.artifact_type = artifact_type;
    artifact
}

/// Refreshes with `count` arrivals; arrivals[i] and artifacts[i] stay index-aligned.
fn refresh<let N: u32>(
    timestamp: u64,
    planet: Planet,
    pending: [Arrival; N],
    carried: [Artifact; N],
) -> Planet {
    let mut events = PlanetEvents::zero();
    let mut arrivals = [Arrival::zero(); 20];
    let mut artifacts = [Artifact::zero(); 20];
    for i in 0..N {
        events.events[i].id = pending[i].id;
        arrivals[i] = pending[i];
        artifacts[i] = carried[i];
    }
    events.count = N;

    let (refreshed, removed, _) = get_refreshed_planet(
        PLAIN_LOCATION,
        timestamp,
        planet,
        events,
        arrivals,
        artifacts,
        PlanetArtifacts::zero(),
    );
    assert_eq(removed.count, N);
    refreshed
}

#[test]
unconstrained fn titan_pauses_growth_before_later_attack() {
    let planet = growing_planet();
    let attack_pop = planet.population_cap / 100;
    // Listed out of time order so the loop has to sort them.
    let refreshed = refresh(
        ATTACK_LANDS,
        planet,
        [attack_arrival(0xa77ac, ATTACK_LANDS, attack_pop), ship_arrival(0x717a, SHIP_LANDS)],
        [Artifact::zero(), ship(ArtifactType::ShipTitan)],
    );

    let at_landing = update_planet(SHIP_LANDS, planet);
    assert(at_landing.population > planet.population, "fixture should grow before the titan");
    let expected = at_landing.population - attack_pop * 100 / planet.defense;

    assert_eq(refreshed.pausers, 1);
    assert_eq(refreshed.owner, planet.owner);
    assert_eq(refreshed.population, expected);

    let grew_through = apply_arrival(
        update_planet(ATTACK_LANDS, planet),
        attack_arrival(0xa77ac, ATTACK_LANDS, attack_pop),
    )
        .1;
    assert(refreshed.population < grew_through.population, "attack saw unpaused growth");
}

#[test]
unconstrained fn mothership_doubles_growth_from_landing_time() {
    let planet = growing_planet();
    let refreshed = refresh(
        ATTACK_LANDS,
        planet,
        [ship_arrival(0x5417, SHIP_LANDS)],
        [ship(ArtifactType::ShipMothership)],
    );

    assert_eq(refreshed.energy_gro_doublers, 1);
    assert_eq(refreshed.population_growth, planet.population_growth * 2);

    let at_landing = update_planet(SHIP_LANDS, planet);
    let doubled_after = (ATTACK_LANDS - SHIP_LANDS) as u128 * planet.population_growth * 2;
    assert_eq(refreshed.population, at_landing.population + doubled_after);
}

#[test]
unconstrained fn two_motherships_double_growth_once() {
    let planet = growing_planet();
    let refreshed = refresh(
        ATTACK_LANDS,
        planet,
        [ship_arrival(0x5417, SHIP_LANDS), ship_arrival(0x5418, ATTACK_LANDS)],
        [ship(ArtifactType::ShipMothership), ship(ArtifactType::ShipMothership)],
    );

    assert_eq(refreshed.energy_gro_doublers, 2);
    assert_eq(refreshed.population_growth, planet.population_growth * 2);
}

#[test]
unconstrained fn non_ship_artifact_changes_nothing() {
    let planet = growing_planet();
    let refreshed = refresh(
        ATTACK_LANDS,
        planet,
        [ship_arrival(0x5417, SHIP_LANDS)],
        [ship(ArtifactType::Wormhole)],
    );

    assert_eq(refreshed.pausers, 0);
    assert_eq(refreshed.energy_gro_doublers, 0);
    assert_eq(refreshed.population, update_planet(ATTACK_LANDS, planet).population);
}
