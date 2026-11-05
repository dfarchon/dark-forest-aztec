// A tail slot past `planet_events.count` is not hash-checked. Copying a landing
// artifact's id there must not redirect the index used by the Gear check.
use crate::{CREATED_AT, new_planet, owner, PLAIN_LOCATION};
use ::libs::artifact_utils::contains_gear;
use ::libs::planet::{refresh_planet_v1, refresh_planet_v2};
use ::types::storage::{
    arrival::{Arrival, ArrivalType},
    artifact::{Artifact, ArtifactLocation, ArtifactType},
    planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType, SpaceType},
};

global ARTIFACT_ID: Field = 0xa47;
global TAIL: u32 = 19;
global LANDS: u64 = CREATED_AT + 50;
global NOW: u64 = CREATED_AT + 100;

fn planet() -> Planet {
    new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::Nebula)
}

fn landing() -> Arrival {
    let mut arrival = Arrival::zero();
    arrival.id = 2;
    arrival.to_planet = PLAIN_LOCATION;
    arrival.arrival_type = ArrivalType::Normal;
    arrival.player = owner();
    arrival.carried_artifact_id = ARTIFACT_ID;
    arrival.arrival_time = LANDS;
    arrival
}

fn carried(artifact_type: u8) -> Artifact {
    let mut artifact = Artifact::zero();
    artifact.artifact_type = artifact_type;
    artifact.controller = owner();
    artifact
}

/// One real arrival at index 0, and a copy of its carried id in the unchecked tail.
fn arrivals_with_tail() -> (PlanetEvents, [Arrival; 20]) {
    let mut events = PlanetEvents::zero();
    events.events[0].id = 2;
    events.count = 1;

    let mut arrivals = [Arrival::zero(); 20];
    arrivals[0] = landing();
    arrivals[TAIL] = landing();

    (events, arrivals)
}

fn place(real: Artifact, tail: Artifact) -> [Artifact; 20] {
    let mut artifacts = [Artifact::zero(); 20];
    artifacts[0] = real;
    artifacts[TAIL] = tail;
    artifacts
}

/// Same assembly as `find_artifact` / `prospect_planet` before `contains_gear`.
fn artifacts_seen_by_gear_check(
    planet_artifacts_state: PlanetArtifacts,
    owned_artifacts: [Artifact; 20],
    arrival_artifacts: [Artifact; 20],
    change_artifact_location_count: u32,
    change_artifact_arrival_indices: [u32; 20],
) -> [Artifact; 20] {
    let mut artifacts: [Artifact; 20] = [Artifact::zero(); 20];
    for i in 0..20 {
        if i < planet_artifacts_state.count {
            artifacts[i] = owned_artifacts[i];
        }
    }
    for i in 0..20 {
        if i < change_artifact_location_count {
            artifacts[planet_artifacts_state.count + i] =
                arrival_artifacts[change_artifact_arrival_indices[i]];
        }
    }
    artifacts
}

#[test]
unconstrained fn tail_slot_cannot_impersonate_a_landed_artifact() {
    let before = PlanetArtifacts::zero();
    let (events, arrivals) = arrivals_with_tail();
    let artifacts = place(
        carried(ArtifactType::Monolith),
        carried(ArtifactType::ShipGear),
    );

    let (_, _, new_artifacts, change_count, _, _, indices) = refresh_planet_v2(
        NOW,
        PLAIN_LOCATION,
        planet(),
        events,
        arrivals,
        artifacts,
        [ArtifactLocation::zero(); 20],
        before,
    );

    assert_eq(change_count, 1);
    assert_eq(indices[0], 0);
    assert_eq(new_artifacts.count, 1);
    assert_eq(new_artifacts.ids[0], ARTIFACT_ID);

    let seen = artifacts_seen_by_gear_check(
        before,
        [Artifact::zero(); 20],
        artifacts,
        change_count,
        indices,
    );
    assert(!contains_gear(owner(), new_artifacts, seen), "tail gear must not satisfy the check");
}

#[test]
unconstrained fn real_gear_still_satisfies_contains_gear() {
    let before = PlanetArtifacts::zero();
    let (events, arrivals) = arrivals_with_tail();
    let artifacts = place(
        carried(ArtifactType::ShipGear),
        carried(ArtifactType::Monolith),
    );

    let (_, _, new_artifacts, change_count, _, _, indices) = refresh_planet_v2(
        NOW,
        PLAIN_LOCATION,
        planet(),
        events,
        arrivals,
        artifacts,
        [ArtifactLocation::zero(); 20],
        before,
    );

    assert_eq(indices[0], 0);
    let seen = artifacts_seen_by_gear_check(
        before,
        [Artifact::zero(); 20],
        artifacts,
        change_count,
        indices,
    );
    assert(contains_gear(owner(), new_artifacts, seen), "a gear that actually landed is present");
}

#[test]
unconstrained fn v1_writes_the_location_of_the_real_arrival() {
    let (events, arrivals) = arrivals_with_tail();
    let artifacts = place(
        carried(ArtifactType::Monolith),
        carried(ArtifactType::ShipGear),
    );

    let mut locations = [ArtifactLocation::zero(); 20];
    locations[0].voyage_id = 7;
    locations[TAIL].voyage_id = 19;
    locations[TAIL].planet_id = 1;

    let (_, _, _, updated) = refresh_planet_v1(
        NOW,
        PLAIN_LOCATION,
        planet(),
        events,
        arrivals,
        artifacts,
        locations,
        PlanetArtifacts::zero(),
    );

    assert_eq(updated[0].voyage_id, 0);
    assert_eq(updated[0].planet_id, PLAIN_LOCATION);
    assert_eq(updated[TAIL].voyage_id, 19);
    assert_eq(updated[TAIL].planet_id, 1);
}
