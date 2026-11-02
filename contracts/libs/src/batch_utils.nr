use ::macros::StateHash;

use ::types::config::{
    default_stats::PlanetDefaultStats,
    game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
    snark::SnarkConfig,
    space_junk::SpaceJunkConfig,
    world::WorldConfig,
};

use ::types::storage::{
    arrival::Arrival,
    artifact::{Artifact, ArtifactLocation},
    planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetRevealedCoords},
    player::Player,
    world::World,
};

pub fn compute_world_state_hash(world: World) -> Field {
    world.state_hash()
}

pub fn compute_planet_state_hash(planet: Planet) -> Field {
    if planet == Planet::zero() {
        0
    } else {
        planet.state_hash()
    }
}

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
        planet.state_hash()
    };
    let planet_artifacts_state_hash = if planet_artifacts_state == PlanetArtifacts::zero() {
        0
    } else {
        planet_artifacts_state.state_hash()
    };
    let planet_events_state_hash = if planet_events_state == PlanetEvents::zero() {
        0
    } else {
        planet_events_state.state_hash()
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
                arrival_hashes[i] = arrival.state_hash();
            }
            if artifact_id != 0 {
                artifact_hashes[i] = artifacts[i].state_hash();
                artifact_location_hashes[i] = artifact_locations[i].state_hash();
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
                artifact_hashes[i] = owned_artifacts[i].state_hash();
                artifact_location_hashes[i] = owned_artifact_locations[i].state_hash();
            }
        }
    }

    (artifact_ids, artifact_hashes, artifact_location_hashes, planet_artifacts_state.count)
}

/// Hashes the artifacts currently on a planet, aligned with `planet_artifacts_state.ids`.
/// Unlike `compute_owned_artifact_hashes`, artifact locations are not hashed.
pub fn compute_planet_artifact_hashes(
    planet_artifacts_state: PlanetArtifacts,
    planet_artifacts: [Artifact; 20],
) -> [Field; 20] {
    let mut artifact_hashes: [Field; 20] = [0; 20];
    for i in 0..20 {
        if (i < planet_artifacts_state.count) & (planet_artifacts_state.ids[i] != 0) {
            artifact_hashes[i] = planet_artifacts[i].state_hash();
        }
    }
    artifact_hashes
}

pub fn compute_artifact_and_location_hashes(
    artifact_id: Field,
    artifact: Artifact,
    artifact_location: ArtifactLocation,
) -> (Field, Field, Field) {
    let artifact_hash = if artifact == Artifact::zero() {
        0
    } else {
        artifact.state_hash()
    };
    let artifact_location_hash = if artifact_location == ArtifactLocation::zero() {
        0
    } else {
        artifact_location.state_hash()
    };
    (artifact_id, artifact_hash, artifact_location_hash)
}

pub fn compute_artifact_hash(artifact_id: Field, artifact: Artifact) -> (Field) {
    let artifact_hash = if artifact == Artifact::zero() {
        0
    } else {
        artifact.state_hash()
    };

    artifact_hash
}

pub fn compute_player_hash(player: Player) -> Field {
    if player == Player::zero() {
        0
    } else {
        player.state_hash()
    }
}

pub fn compute_planet_revealed_coords_hash(coords: PlanetRevealedCoords) -> Field {
    if coords == PlanetRevealedCoords::zero() {
        0
    } else {
        coords.state_hash()
    }
}

pub fn compute_world_hash(world: World) -> Field {
    if world == World::zero() {
        0
    } else {
        world.state_hash()
    }
}

pub fn assert_public_timestamp(timestamp: u64, actual_timestamp: u64) {
    assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");
    let max_time_drift: u64 = 300;
    assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");
}

/// Arrival times aligned with the `arrival_hashes` produced by `compute_planet_hashes`.
/// Slots whose hash is not verified on-chain (beyond `count` or with id 0) stay 0.
pub fn compute_arrival_times(
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
) -> [u64; 20] {
    let mut arrival_times: [u64; 20] = [0; 20];
    for i in 0..20 {
        if (i < planet_events_state.count) & (planet_events_state.events[i].id != 0) {
            arrival_times[i] = arrivals[i].arrival_time;
        }
    }
    arrival_times
}

/// `arrival_times` must come from the same private execution as the batch-verified
/// `arrival_hashes`. Settling at `timestamp` must not skip an arrival that is already
/// due at the block time.
pub fn assert_no_skipped_arrivals(
    timestamp: u64,
    actual_timestamp: u64,
    arrival_times: [u64; 20],
    count: u32,
) {
    for i in 0..20 {
        if i < count {
            let arrival_time = arrival_times[i];
            assert(
                (arrival_time <= timestamp) | (arrival_time > actual_timestamp),
                "Due arrival skipped; settle at a later timestamp",
            );
        }
    }
}

/// A newly created arrival must not already be due when the move lands on-chain.
pub fn assert_new_arrival_not_due(arrival_time: u64, actual_timestamp: u64) {
    assert(arrival_time > actual_timestamp, "New arrival already due");
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

/// Compute base config hashes for planet init and other operations.
/// Returns (planet_default_stats_hash, config_hashes) where config_hashes is
/// [snark, world, game_core, thresholds, space_junk, tier0, tier1, tier2, tier3].
/// Callers that need artifacts_config_hash should compute it separately.
pub fn compute_config_hashes(
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
) -> (Field, [Field; 9]) {
    let planet_default_stats_hash = planet_default_stats.state_hash();
    let config_hashes: [Field; 9] = [
        snark_config.state_hash(),
        world_config.state_hash(),
        game_config_core.state_hash(),
        planet_level_thresholds.state_hash(),
        space_junk_config.state_hash(),
        planet_type_weights_tier_0.state_hash(),
        planet_type_weights_tier_1.state_hash(),
        planet_type_weights_tier_2.state_hash(),
        planet_type_weights_tier_3.state_hash(),
    ];
    (planet_default_stats_hash, config_hashes)
}

mod tests {
    use super::{
        assert_new_arrival_not_due, assert_no_skipped_arrivals, assert_public_timestamp,
        compute_arrival_times, compute_planet_artifact_hashes, compute_planet_state_hash,
    };
    use ::aztec::protocol::{hash::poseidon2_hash, traits::Serialize};
    use ::types::storage::{
        arrival::Arrival,
        artifact::Artifact,
        planet::{Planet, PlanetArtifacts, PlanetEvents},
    };

    global BLOCK_TIME: u64 = 1_000_000;

    fn one_arrival_at(arrival_time: u64) -> [u64; 20] {
        let mut times = [0; 20];
        times[0] = arrival_time;
        times
    }

    #[test(should_fail_with = "Due arrival skipped; settle at a later timestamp")]
    fn h01_backdated_settlement_cannot_skip_due_arrival() {
        let times = one_arrival_at(BLOCK_TIME - 10);
        assert_no_skipped_arrivals(BLOCK_TIME - 300, BLOCK_TIME, times, 1);
    }

    #[test]
    fn h01_settling_at_or_after_due_arrival_passes() {
        let times = one_arrival_at(BLOCK_TIME - 10);
        assert_no_skipped_arrivals(BLOCK_TIME - 10, BLOCK_TIME, times, 1);
        assert_no_skipped_arrivals(BLOCK_TIME, BLOCK_TIME, times, 1);
    }

    #[test]
    fn h01_future_arrival_may_stay_pending() {
        let times = one_arrival_at(BLOCK_TIME + 1);
        assert_no_skipped_arrivals(BLOCK_TIME - 300, BLOCK_TIME, times, 1);
    }

    #[test]
    fn h01_slots_beyond_count_are_ignored() {
        let mut times = one_arrival_at(BLOCK_TIME + 50);
        times[1] = BLOCK_TIME - 10;
        assert_no_skipped_arrivals(BLOCK_TIME - 300, BLOCK_TIME, times, 1);
    }

    #[test(should_fail_with = "Timestamp too old")]
    fn proof_older_than_window_still_fails() {
        assert_public_timestamp(BLOCK_TIME - 301, BLOCK_TIME);
    }

    #[test(should_fail_with = "New arrival already due")]
    fn backdated_departure_cannot_land_on_arrival() {
        let departure = BLOCK_TIME - 270;
        let travel_time = 120;
        assert_new_arrival_not_due(departure + travel_time, BLOCK_TIME);
    }

    #[test(should_fail_with = "New arrival already due")]
    fn new_arrival_at_block_time_is_already_due() {
        assert_new_arrival_not_due(BLOCK_TIME, BLOCK_TIME);
    }

    #[test]
    fn new_arrival_after_block_time_passes() {
        assert_new_arrival_not_due(BLOCK_TIME + 1, BLOCK_TIME);
    }

    #[test]
    fn arrival_times_follow_verified_event_slots() {
        let mut events = PlanetEvents::zero();
        events.events[0].id = 7;
        events.events[1].id = 0;
        events.events[2].id = 9;
        events.count = 2;
        let mut arrivals = [Arrival::zero(); 20];
        arrivals[0].arrival_time = 100;
        arrivals[1].arrival_time = 200;
        arrivals[2].arrival_time = 300;

        let times = compute_arrival_times(events, arrivals);
        assert(times[0] == 100);
        assert(times[1] == 0);
        assert(times[2] == 0);
    }

    // C1/C2/H2 rely on this: hash 0 means "slot must be empty" for verify_hash, and an
    // existing planet can never produce hash 0, so Planet::zero() cannot impersonate it.
    #[test]
    fn zero_planet_hashes_to_zero_and_existing_planet_does_not() {
        assert(compute_planet_state_hash(Planet::zero()) == 0);
        let mut planet = Planet::zero();
        planet.last_updated = 1;
        assert(compute_planet_state_hash(planet) != 0);
    }

    #[test]
    fn c3_planet_artifact_hashes_follow_ids_and_count() {
        let mut state = PlanetArtifacts::zero();
        state.ids[0] = 11;
        state.ids[1] = 22;
        state.ids[2] = 33;
        state.count = 2;
        let mut arts = [Artifact::zero(); 20];
        arts[0].last_updated = 1;
        arts[1].last_updated = 2;
        arts[2].last_updated = 3;

        let hashes = compute_planet_artifact_hashes(state, arts);
        assert(hashes[0] == poseidon2_hash(arts[0].serialize()));
        assert(hashes[1] == poseidon2_hash(arts[1].serialize()));
        assert(hashes[2] == 0);
    }
}
