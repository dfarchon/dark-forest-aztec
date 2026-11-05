// Destroyed planets (L-01): no natural growth, but arrivals already in flight still settle on
// refresh, including ships, which must land so they can leave again.
use crate::{CREATED_AT, enemy, new_planet, PLAIN_LOCATION};
use ::aztec::protocol::address::AztecAddress;
use ::libs::lazy_update::{apply_arrival, update_planet};
use ::libs::planet::refresh_planet_v1;
use ::types::storage::{
    arrival::{Arrival, ArrivalType},
    artifact::{Artifact, ArtifactLocation, ArtifactType},
    planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType},
};

global ARRIVES: u64 = CREATED_AT + 100;
global REFRESHED: u64 = CREATED_AT + 200;
global LATER: u64 = CREATED_AT + 300;

/// Owned, half full silver mine, so both energy and silver would grow if it were alive.
fn half_full(destroyed: bool) -> Planet {
    let mut planet = new_planet(PLAIN_LOCATION, 8, PlanetType::SilverMine, SpaceType::Nebula);
    planet.population = planet.population_cap / 2;
    planet.silver = planet.silver_cap / 2;
    planet.destroyed = destroyed;
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

fn in_transit(voyage_id: Field) -> ArtifactLocation {
    ArtifactLocation { planet_id: 0, voyage_id, last_updated: CREATED_AT }
}

/// Refreshes with one pending arrival; returns the refreshed state tables.
fn refresh_one(
    timestamp: u64,
    planet: Planet,
    arrival: Arrival,
    artifact: Artifact,
    location: ArtifactLocation,
) -> (Planet, PlanetEvents, PlanetArtifacts, [ArtifactLocation; 20]) {
    let mut events = PlanetEvents::zero();
    let mut arrivals = [Arrival::zero(); 20];
    let mut artifacts = [Artifact::zero(); 20];
    let mut locations = [ArtifactLocation::zero(); 20];
    events.events[0].id = arrival.id;
    events.count = 1;
    arrivals[0] = arrival;
    artifacts[0] = artifact;
    locations[0] = location;

    refresh_planet_v1(
        timestamp,
        PLAIN_LOCATION,
        planet,
        events,
        arrivals,
        artifacts,
        locations,
        PlanetArtifacts::zero(),
    )
}

#[test]
unconstrained fn destroyed_planet_does_not_grow() {
    let planet = half_full(true);
    let refreshed = update_planet(LATER, planet);

    assert_eq(refreshed.population, planet.population);
    assert_eq(refreshed.silver, planet.silver);
    assert_eq(refreshed.last_updated, LATER);
}

#[test]
unconstrained fn live_planet_still_grows() {
    let planet = half_full(false);
    let refreshed = update_planet(LATER, planet);

    assert(refreshed.population > planet.population, "energy should grow");
    assert(refreshed.silver > planet.silver, "silver should grow");
}

#[test]
unconstrained fn due_attack_settles_on_destroyed_planet() {
    let planet = half_full(true);
    let attack = attack_arrival(0xa77ac, ARRIVES, planet.population_cap / 100);
    let (refreshed, events, _, _) = refresh_one(
        REFRESHED,
        planet,
        attack,
        Artifact::zero(),
        ArtifactLocation::zero(),
    );

    assert_eq(events.count, 0);
    let expected = apply_arrival(planet, attack).1;
    assert_eq(refreshed.population, expected.population);
    assert_eq(refreshed.owner, planet.owner);
    assert_eq(refreshed.silver, planet.silver);
    assert_eq(refreshed.last_updated, REFRESHED);
}

#[test]
unconstrained fn due_attack_can_conquer_destroyed_planet() {
    let mut planet = half_full(true);
    planet.population = 1;
    let attack = attack_arrival(0xa77ac, ARRIVES, planet.population_cap / 10);
    let (refreshed, events, _, _) = refresh_one(
        REFRESHED,
        planet,
        attack,
        Artifact::zero(),
        ArtifactLocation::zero(),
    );

    assert_eq(events.count, 0);
    assert_eq(refreshed.owner, enemy());
    assert(refreshed.destroyed, "conquest keeps the planet destroyed");
}

#[test]
unconstrained fn due_ship_lands_on_destroyed_planet() {
    let planet = half_full(true);
    let (refreshed, events, planet_artifacts, locations) = refresh_one(
        REFRESHED,
        planet,
        ship_arrival(0x717a, ARRIVES),
        ship(ArtifactType::ShipTitan),
        in_transit(0x717a),
    );

    assert_eq(events.count, 0);
    assert_eq(planet_artifacts.count, 1);
    assert_eq(planet_artifacts.ids[0], 0x717a);
    assert_eq(locations[0].planet_id, PLAIN_LOCATION);
    assert_eq(locations[0].voyage_id, 0);
    assert_eq(refreshed.pausers, 1);
    assert_eq(refreshed.owner, planet.owner);
    assert_eq(refreshed.population, planet.population);
}

#[test]
unconstrained fn mothership_lands_but_destroyed_planet_stays_frozen() {
    let planet = half_full(true);
    let (refreshed, _, planet_artifacts, _) = refresh_one(
        REFRESHED,
        planet,
        ship_arrival(0x5417, ARRIVES),
        ship(ArtifactType::ShipMothership),
        in_transit(0x5417),
    );

    assert_eq(planet_artifacts.count, 1);
    assert_eq(refreshed.energy_gro_doublers, 1);
    assert_eq(refreshed.population_growth, planet.population_growth * 2);
    assert_eq(refreshed.population, planet.population);
}

#[test]
unconstrained fn future_arrival_stays_queued_on_destroyed_planet() {
    let planet = half_full(true);
    let (_, events, planet_artifacts, locations) = refresh_one(
        REFRESHED,
        planet,
        ship_arrival(0x717a, LATER),
        ship(ArtifactType::ShipTitan),
        in_transit(0x717a),
    );

    assert_eq(events.count, 1);
    assert_eq(events.events[0].id, 0x717a);
    assert_eq(planet_artifacts.count, 0);
    assert_eq(locations[0].voyage_id, 0x717a);
}
