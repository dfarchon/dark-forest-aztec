use ::aztec::protocol::{hash::poseidon2_hash, traits::Serialize};

use crate::planet::refresh_planet;

use ::types::config::{
    artifacts::ArtifactsConfig,
    default_stats::PlanetDefaultStats,
    game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
    snark::SnarkConfig,
    space_junk::SpaceJunkConfig,
    world::WorldConfig,
};

use ::types::storage::{
    arrival::Arrival,
    artifact::{Artifact, ArtifactLocation},
    planet::{Planet, PlanetArtifacts, PlanetEvents},
    world::World,
};

pub fn assert_planet_timestamp_freshness(
    timestamp: u64,
    planet: Planet,
    planet_artifacts_state: PlanetArtifacts,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    arrival_artifacts: [Artifact; 20],
    arrival_artifact_locations: [ArtifactLocation; 20],
) {
    assert(timestamp >= planet.last_updated, "Timestamp must be >= planet's last_updated");
    assert(
        timestamp >= planet_artifacts_state.last_updated,
        "Timestamp must be >= planet_artifacts_state' last_updated",
    );
    assert(
        timestamp >= planet_events_state.last_updated,
        "Timestamp must be >= planet_events_state' last_updated",
    );

    for i in 0..20 {
        if i < planet_events_state.count {
            assert(
                timestamp >= arrivals[i].departure_time,
                "Timestamp must be >= arrival's departure_time",
            );
            if arrivals[i].carried_artifact_id != 0 {
                assert(
                    timestamp >= arrival_artifacts[i].last_updated,
                    "Timestamp must be >= artifact's last_updated",
                );
                assert(
                    timestamp >= arrival_artifact_locations[i].last_updated,
                    "Timestamp must be >= artifact_location's last_updated",
                );
            }
        }
    }
}

pub fn assert_artifact_timestamp_freshness(timestamp: u64, artifact: Artifact) {
    assert(timestamp >= artifact.last_updated, "Timestamp must be >= artifact's last_updated");
}

pub fn assert_artifact_and_location_timestamp_freshness(
    timestamp: u64,
    artifact: Artifact,
    artifact_location: ArtifactLocation,
) {
    assert(timestamp >= artifact.last_updated, "Timestamp must be >= artifact's last_updated");
    assert(
        timestamp >= artifact_location.last_updated,
        "Timestamp must be >= artifact_location's last_updated",
    );
}

pub fn assert_owned_artifacts_timestamp_freshness(
    timestamp: u64,
    planet_artifacts_state: PlanetArtifacts,
    owned_artifacts: [Artifact; 20],
    owned_artifact_locations: [ArtifactLocation; 20],
) {
    for i in 0..20 {
        if i < planet_artifacts_state.count {
            assert(
                timestamp >= owned_artifacts[i].last_updated,
                "Timestamp must be >= owned artifact's last_updated",
            );
            assert(
                timestamp >= owned_artifact_locations[i].last_updated,
                "Timestamp must be >= owned artifact_location's last_updated",
            );
        }
    }
}

pub fn compute_planet_hashes(
    planet_id: Field,
    planet: Planet,
    planet_artifacts_state: PlanetArtifacts,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifacts: [Artifact; 20],
    artifact_locations: [ArtifactLocation; 20],
    ) -> (Field, Field, Field, Field, [Field; 20], [Field; 20], [Field; 20], [Field; 20], [Field; 20], u32) {
    let original_arrivals_count = planet_events_state.count;

    let planet_hash = if planet == Planet::zero() {
        0
    } else {
        poseidon2_hash(planet.serialize())
    };
    let planet_artifacts_state_hash = if planet_artifacts_state == PlanetArtifacts::zero() {
        0
    } else {
        poseidon2_hash(planet_artifacts_state.serialize())
    };
    let planet_events_state_hash = if planet_events_state == PlanetEvents::zero() {
        0
    } else {
        poseidon2_hash(planet_events_state.serialize())
    };

    let mut arrival_ids: [Field; 20] = [0; 20];
    let mut arrival_hashes: [Field; 20] = [0; 20];
    let mut artifact_ids: [Field; 20] = [0; 20];
    let mut artifact_hashes: [Field; 20] = [0; 20];
    let mut artifact_location_hashes: [Field; 20] = [0; 20];

    for i in 0..20 {
        if i < planet_events_state.count {
            let arrival_id = planet_events_state.events[i].id;
            let arrival = arrivals[i];
            let artifact_id = arrival.carried_artifact_id;

            arrival_ids[i] = arrival_id;
            artifact_ids[i] = artifact_id;
            if arrival_id != 0 {
                arrival_hashes[i] = poseidon2_hash(arrival.serialize());
            }
            if artifact_id != 0 {
                artifact_hashes[i] = poseidon2_hash(artifacts[i].serialize());
                artifact_location_hashes[i] = poseidon2_hash(artifact_locations[i].serialize());
            }
        }
    }

    (
        planet_id, planet_hash, planet_artifacts_state_hash, planet_events_state_hash, arrival_ids,
        arrival_hashes, artifact_ids, artifact_hashes, artifact_location_hashes,
        original_arrivals_count,
    )
}

pub fn compute_owned_artifact_hashes(
    planet_artifacts_state: PlanetArtifacts,
    owned_artifacts: [Artifact; 20],
    owned_artifact_locations: [ArtifactLocation; 20],
) -> ([Field; 20], [Field; 20], [Field; 20], u32) {
    let mut artifact_ids: [Field; 20] = [0; 20];
    let mut artifact_hashes: [Field; 20] = [0; 20];
    let mut artifact_location_hashes: [Field; 20] = [0; 20];

    for i in 0..20 {
        if i < planet_artifacts_state.count {
            let artifact_id = planet_artifacts_state.ids[i];
            artifact_ids[i] = artifact_id;
            if artifact_id != 0 {
                artifact_hashes[i] = poseidon2_hash(owned_artifacts[i].serialize());
                artifact_location_hashes[i] =
                    poseidon2_hash(owned_artifact_locations[i].serialize());
            }
        }
    }

    (artifact_ids, artifact_hashes, artifact_location_hashes, planet_artifacts_state.count)
}

pub fn compute_artifact_and_location_hashes(
    artifact_id: Field,
    artifact: Artifact,
    artifact_location: ArtifactLocation,
) -> (Field, Field, Field) {
    let artifact_hash = if artifact == Artifact::zero() {
        0
    } else {
        poseidon2_hash(artifact.serialize())
    };
    let artifact_location_hash = if artifact_location == ArtifactLocation::zero() {
        0
    } else {
        poseidon2_hash(artifact_location.serialize())
    };
    (artifact_id, artifact_hash, artifact_location_hash)
}

pub fn compute_artifact_hash(artifact_id: Field, artifact: Artifact) -> (Field) {
    let artifact_hash = if artifact == Artifact::zero() {
        0
    } else {
        poseidon2_hash(artifact.serialize())
    };

    artifact_hash
}

pub fn compute_world_hash(world: World) -> Field {
    if world == World::zero() {
        0
    } else {
        poseidon2_hash(world.serialize())
    }
}

pub fn assert_public_timestamp(timestamp: u64, actual_timestamp: u64) {
    assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");
    let max_time_drift: u64 = 300;
    assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");
}

pub fn compact_artifact_locations(
    artifact_ids: [Field; 20],
    artifact_locations: [ArtifactLocation; 20],
    count: u32,
) -> ([Field; 20], [ArtifactLocation; 20], u32) {
    let mut out_ids: [Field; 20] = [0; 20];
    let mut out_locations: [ArtifactLocation; 20] = [ArtifactLocation::zero(); 20];
    let mut out_count: u32 = 0;
    for i in 0..20 {
        if (i < count) & (artifact_ids[i] != 0) {
            out_ids[out_count] = artifact_ids[i];
            out_locations[out_count] = artifact_locations[i];
            out_count += 1;
        }
    }
    (out_ids, out_locations, out_count)
}

/// Compute config hashes for the move transaction.
/// Returns (planet_default_stats_hash, config_hashes) where config_hashes is
/// [snark, world, game_core, thresholds, space_junk, tier0, tier1, tier2, tier3, artifacts].
pub fn compute_move_config_hashes(
    snark_config: SnarkConfig,
    planet_default_stats: PlanetDefaultStats,
    world_config: WorldConfig,
    game_config_core: GameConfigCore,
    planet_level_thresholds: PlanetLevelThresholds,
    space_junk_config: SpaceJunkConfig,
    planet_type_weights_tier_0: PlanetTypeWeightsTier,
    planet_type_weights_tier_1: PlanetTypeWeightsTier,
    planet_type_weights_tier_2: PlanetTypeWeightsTier,
    planet_type_weights_tier_3: PlanetTypeWeightsTier,
    artifacts_config: ArtifactsConfig,
) -> (Field, [Field; 10]) {
    let planet_default_stats_hash = poseidon2_hash(planet_default_stats.serialize());
    let config_hashes: [Field; 10] = [
        poseidon2_hash(snark_config.serialize()),
        poseidon2_hash(world_config.serialize()),
        poseidon2_hash(game_config_core.serialize()),
        poseidon2_hash(planet_level_thresholds.serialize()),
        poseidon2_hash(space_junk_config.serialize()),
        poseidon2_hash(planet_type_weights_tier_0.serialize()),
        poseidon2_hash(planet_type_weights_tier_1.serialize()),
        poseidon2_hash(planet_type_weights_tier_2.serialize()),
        poseidon2_hash(planet_type_weights_tier_3.serialize()),
        poseidon2_hash(artifacts_config.serialize()),
    ];
    (planet_default_stats_hash, config_hashes)
}
