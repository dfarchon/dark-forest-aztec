use ::aztec::protocol::{hash::poseidon2_hash, traits::Serialize};

use crate::planet::refresh_planet;

use ::types::storage::{
    arrival::Arrival,
    artifact::{Artifact, ArtifactLocation},
    planet::{Planet, PlanetArtifacts, PlanetEvents},
};

/// Assert that timestamp is >= all relevant last_updated fields for refresh inputs.
pub fn assert_refresh_timestamp_monotonicity(
    timestamp: u64,
    planet: Planet,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    artifact_locations: [ArtifactLocation; 20],
    planet_artifacts: PlanetArtifacts,
) {
    assert(timestamp >= planet.last_updated, "Timestamp must be >= planet's last_updated");
    assert(
        timestamp >= planet_events_state.last_updated,
        "Timestamp must be >= planet_events' last_updated",
    );
    for i in 0..20 {
        if i < planet_events_state.count {
            assert(
                timestamp >= arrivals[i].departure_time,
                "Timestamp must be >= arrival's departure_time",
            );
            if arrivals[i].carried_artifact_id != 0 {
                assert(
                    timestamp >= artifacts[i].last_updated,
                    "Timestamp must be >= artifact's last_updated",
                );
                assert(
                    timestamp >= artifact_locations[i].last_updated,
                    "Timestamp must be >= artifact_location's last_updated",
                );
            }
        }
    }
    assert(
        timestamp >= planet_artifacts.last_updated,
        "Timestamp must be >= planet_artifacts' last_updated",
    );
}

/// Call refresh_planet then set last_updated on all four outputs.
pub fn refresh_planet_and_apply_timestamp(
    timestamp: u64,
    location_id: Field,
    planet: Planet,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    artifact_locations: [ArtifactLocation; 20],
    planet_artifacts: PlanetArtifacts,
) -> (Planet, PlanetEvents, PlanetArtifacts, [ArtifactLocation; 20]) {
    let refresh_result = refresh_planet(
        timestamp,
        location_id,
        planet,
        planet_events_state,
        arrivals,
        artifacts,
        artifact_locations,
        planet_artifacts,
    );
    let mut new_planet = refresh_result.0;
    let mut new_planet_events = refresh_result.1;
    let mut new_planet_artifacts = refresh_result.2;
    let mut new_artifact_locations = refresh_result.3;
    new_planet.last_updated = timestamp;
    new_planet_events.last_updated = timestamp;
    new_planet_artifacts.last_updated = timestamp;
    for i in 0..20 {
        if i < planet_events_state.count {
            new_artifact_locations[i].last_updated = timestamp;
        }
    }
    (new_planet, new_planet_events, new_planet_artifacts, new_artifact_locations)
}

/// Build arrival_ids, arrivals_hash, artifact_ids, artifacts_hash, artifact_locations_hash for refresh hash verification.
pub fn build_refresh_event_hashes(
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    artifact_locations: [ArtifactLocation; 20],
) -> ([Field; 20], [Field; 20], [Field; 20], [Field; 20], [Field; 20]) {
    let mut arrival_ids: [Field; 20] = [0; 20];
    let mut arrivals_hash: [Field; 20] = [0; 20];
    let mut artifact_ids: [Field; 20] = [0; 20];
    let mut artifacts_hash: [Field; 20] = [0; 20];
    let mut artifact_locations_hash: [Field; 20] = [0; 20];
    for i in 0..20 {
        if i < planet_events_state.count {
            arrival_ids[i] = planet_events_state.events[i].id;
            artifact_ids[i] = arrivals[i].carried_artifact_id;
            if arrival_ids[i] != 0 {
                arrivals_hash[i] = poseidon2_hash(arrivals[i].serialize());
            }
            if artifact_ids[i] != 0 {
                artifacts_hash[i] = poseidon2_hash(artifacts[i].serialize());
                artifact_locations_hash[i] = poseidon2_hash(artifact_locations[i].serialize());
            }
        }
    }
    (arrival_ids, arrivals_hash, artifact_ids, artifacts_hash, artifact_locations_hash)
}
