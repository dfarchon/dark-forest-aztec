use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::{hash::poseidon2_hash, traits::Serialize};

use ::types::args::DFPInitPlanetArgs;
use ::types::config::{
    default_stats::PlanetDefaultStats,
    game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
    space_junk::SpaceJunkConfig,
    upgrade::UpgradeConfig,
    world::WorldConfig,
};

use ::types::storage::{
    arrival::Arrival,
    artifact::{Artifact, ArtifactLocation, ArtifactType},
    planet::{
        Planet, PlanetArtifacts, PlanetEventMetadata, PlanetEvents, PlanetRevealedCoords,
        PlanetType, SpaceType, UpgradeBranch,
    },
    player::Player,
    world::World,
};

use crate::game_utils::{
    _default_planet, _put_artifact_on_planet, get_planet_default_space_junk,
    get_planet_level_type_and_space_type, is_half_space_junk, location_id_valid,
};

use crate::lazy_update::{apply_pending_events, update_planet};

/// Noir port of Solidity `LibPlanet.revealLocation`.
pub fn reveal_location(
    location: Field,
    perlin: u8,
    x: Field,
    y: Field,
    check_timestamp: bool,
    timestamp: u64,
    sender: AztecAddress,
    mut player: Player,
    world_config: WorldConfig,
    mut revealed_coords: PlanetRevealedCoords,
) -> (Player, PlanetRevealedCoords) {
    if check_timestamp {
        assert(
            timestamp > player.last_reveal_timestamp + world_config.location_reveal_cooldown,
            "wait for cooldown before revealing again",
        );
    }
    assert(revealed_coords.location_id == 0 as Field, "Location already revealed");

    revealed_coords = PlanetRevealedCoords { location_id: location, x: x, y: y, revealer: sender };

    player.last_reveal_timestamp = timestamp;

    (player, revealed_coords)
}

/// Noir port of Solidity `LibPlanet.getDefaultInitPlanetArgs`.
pub fn get_default_init_planet_args(
    location: Field,
    perlin: u8,
    is_home_planet: bool,
    time_factor_hundredths: u16,
    game_config_core: GameConfigCore,
    planet_level_thresholds: PlanetLevelThresholds,
    planet_type_weights_tier_0: PlanetTypeWeightsTier,
    planet_type_weights_tier_1: PlanetTypeWeightsTier,
    planet_type_weights_tier_2: PlanetTypeWeightsTier,
    planet_type_weights_tier_3: PlanetTypeWeightsTier,
) -> DFPInitPlanetArgs {
    let (level, planet_type, space_type) = get_planet_level_type_and_space_type(
        location,
        perlin,
        game_config_core,
        planet_level_thresholds,
        planet_type_weights_tier_0,
        planet_type_weights_tier_1,
        planet_type_weights_tier_2,
        planet_type_weights_tier_3,
    );

    if is_home_planet {
        assert(level == 0, "Can only initialize on planet level 0");
        assert(planet_type == 0, "Can only initialize on regular planets"); // PlanetType::Planet = 0
    }

    DFPInitPlanetArgs {
        location,
        perlin,
        level,
        time_factor_hundredths: time_factor_hundredths,
        space_type,
        planet_type,
        is_home_planet,
    }
}

/// Noir port of Solidity `LibPlanet.initializePlanet`.
/// todo: implement this

/// Noir port of Solidity `LibPlanet.initializePlanetWithDefaults`.
pub fn initialize_planet_with_defaults(
    location: Field,
    perlin: u8,
    is_home_planet: bool,
    timestamp: u64,
    sender: AztecAddress,
    level: u8,
    planet_default_stats: PlanetDefaultStats,
    world_config: WorldConfig,
    planet_level_thresholds: PlanetLevelThresholds,
    game_config_core: GameConfigCore,
    space_junk_config: SpaceJunkConfig,
    planet_type_weights_tier_0: PlanetTypeWeightsTier,
    planet_type_weights_tier_1: PlanetTypeWeightsTier,
    planet_type_weights_tier_2: PlanetTypeWeightsTier,
    planet_type_weights_tier_3: PlanetTypeWeightsTier,
) -> Planet {
    assert(
        location_id_valid(location, game_config_core.max_location_id),
        "Not a valid planet location",
    );
    let init_args = get_default_init_planet_args(
        location,
        perlin,
        is_home_planet,
        world_config.time_factor_hundredths,
        game_config_core,
        planet_level_thresholds,
        planet_type_weights_tier_0,
        planet_type_weights_tier_1,
        planet_type_weights_tier_2,
        planet_type_weights_tier_3,
    );

    assert(level == init_args.level, "Level is not valid");

    _initialize_planet(
        init_args,
        timestamp,
        sender,
        planet_default_stats,
        world_config,
        space_junk_config,
    )
}

/// Noir port of Solidity `LibPlanet._initializePlanet`.
pub fn _initialize_planet(
    args: DFPInitPlanetArgs,
    timestamp: u64,
    sender: AztecAddress,
    planet_default_stats: PlanetDefaultStats,
    world_config: WorldConfig,
    space_junk_config: SpaceJunkConfig,
) -> Planet {
    let default_planet = _default_planet(
        args.location,
        args.level,
        args.planet_type,
        args.space_type,
        args.time_factor_hundredths,
        planet_default_stats,
    );

    let mut _planet = Planet::zero();
    _planet.owner = default_planet.owner;
    _planet.is_home_planet = default_planet.is_home_planet;
    _planet.range = default_planet.range;
    _planet.speed = default_planet.speed;
    _planet.defense = default_planet.defense;
    _planet.population = default_planet.population;
    _planet.population_cap = default_planet.population_cap;
    _planet.population_growth = default_planet.population_growth;
    _planet.silver_cap = default_planet.silver_cap;
    _planet.silver_growth = default_planet.silver_growth;
    _planet.silver = default_planet.silver;
    _planet.planet_level = default_planet.planet_level;
    _planet.planet_type = default_planet.planet_type;

    _planet.is_initialized = true;
    _planet.perlin = args.perlin;
    _planet.space_type = args.space_type;
    _planet.created_at = timestamp;
    _planet.last_updated = timestamp;
    _planet.upgrade_state_0 = 0;
    _planet.upgrade_state_1 = 0;
    _planet.upgrade_state_2 = 0;
    _planet.pausers = 0;
    _planet.energy_gro_doublers = 0;
    _planet.silver_gro_doublers = 0;

    if args.is_home_planet {
        _planet.is_home_planet = true;
        _planet.owner = sender;
        _planet.population = 50000;
    } else {
        _planet.space_junk = get_planet_default_space_junk(_planet, space_junk_config);
        if is_half_space_junk(args.location) {
            _planet.space_junk = _planet.space_junk / 2;
        }
    }
    _planet
}

/// Noir port of Solidity `LibPlanet.checkPlayerInit`.
pub fn check_player_init(
    location: Field,
    perlin: u8,
    radius: u128,
    sender: AztecAddress,
    player: Player,
    world: World,
    game_config_core: GameConfigCore,
    world_config: WorldConfig,
) -> bool {
    assert(player.init_timestamp == 0, "Player is already initialized");
    let world_radius = world.radius;
    assert(radius <= world_radius, "Init radius is bigger than the current world radius");

    if world_config.spawn_rim_area != 0 {
        let radius_squared_times_pi: u128 = (radius * radius * 314) / 100;
        let world_radius_squared_times_pi: u128 = (world_radius * world_radius * 314) / 100;
        assert(
            radius_squared_times_pi + world_config.spawn_rim_area >= world_radius_squared_times_pi,
            "Player can only spawn at the universe rim",
        );
    }

    assert(
        perlin >= game_config_core.init_perlin_min,
        "Init not allowed in perlin value less than INIT_PERLIN_MIN",
    );

    assert(
        perlin < game_config_core.init_perlin_max,
        "Init not allowed in perlin value greater than or equal to the INIT_PERLIN_MAX",
    );

    true
}

pub fn validate_upgrade_planet(
    planet: Planet,
    branch: u8,
    sender: AztecAddress,
    upgrade_config: UpgradeConfig,
) -> (u8, u128) {
    assert(planet.owner == sender, "Only owner can upgrade");
    assert(planet.planet_level > 0, "Cannot upgrade level 0 planets");
    assert(planet.planet_type == PlanetType::Planet(), "Can only upgrade regular planets");
    assert(!planet.destroyed, "Planet is destroyed");
    assert(branch <= UpgradeBranch::Speed(), "Invalid branch");

    let current_branch_level = if branch == UpgradeBranch::Defense() {
        planet.upgrade_state_0
    } else if branch == UpgradeBranch::Range() {
        planet.upgrade_state_1
    } else {
        planet.upgrade_state_2
    };
    assert(current_branch_level < upgrade_config.max_branch_level, "Branch level maxed");

    let total_level: u8 = planet.upgrade_state_0 + planet.upgrade_state_1 + planet.upgrade_state_2;
    let max_total_level = if planet.space_type == SpaceType::Nebula() {
        upgrade_config.max_total_level_nebula
    } else if planet.space_type == SpaceType::Space() {
        upgrade_config.max_total_level_space
    } else if planet.space_type == SpaceType::DeepSpace() {
        upgrade_config.max_total_level_deep_space
    } else if planet.space_type == SpaceType::DeadSpace() {
        upgrade_config.max_total_level_dead_space
    } else {
        assert(false, "Invalid space type");
        0
    };
    assert(total_level < max_total_level, "Planet is maxed");

    let silver_cost: u128 = (
        planet.silver_cap * upgrade_config.silver_cost_percent * ((total_level as u128) + 1)
    )
        / 100;
    assert(planet.silver >= silver_cost, "Not enough silver");

    (current_branch_level, silver_cost)
}

pub fn validate_withdraw_silver(planet: Planet, silver_to_withdraw: u128, sender: AztecAddress) {
    assert(planet.owner == sender, "Only owner can withdraw");
    assert(planet.planet_type == PlanetType::TradingPost(), "Only trading posts can withdraw");
    assert(!planet.destroyed, "Planet is destroyed");
    assert(silver_to_withdraw > 0, "Must withdraw positive silver");
    assert(planet.silver >= silver_to_withdraw, "Not enough silver");
}

/// Noir port of Solidity `LibPlanet.getRefreshedPlanet`.
/// artifacts[i] corresponds to arrivals[i].carried_artifact_id (aligned with arrivals).
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

/// Noir port of Solidity `LibPlanet.applySpaceshipArrive`.
pub fn apply_spaceship_arrive(artifact: Artifact, mut planet: Planet) -> Planet {
    if !planet.is_home_planet {
        if artifact.artifact_type == ArtifactType::ShipMothership() {
            if planet.energy_gro_doublers == 0 {
                planet.population_growth = planet.population_growth * 2;
            }
            planet.energy_gro_doublers += 1;
        } else if artifact.artifact_type == ArtifactType::ShipWhale() {
            if planet.silver_gro_doublers == 0 {
                planet.silver_growth = planet.silver_growth * 2;
            }
            planet.silver_gro_doublers += 1;
        } else if artifact.artifact_type == ArtifactType::ShipTitan() {
            planet.pausers += 1;
        }
    }
    planet
}

/// Noir port of Solidity `LibPlanet.refreshPlanet`.
/// artifacts[i] and artifact_locations[i] correspond to arrivals[i].carried_artifact_id.
pub fn refresh_planet(
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

    // Use fixed array size 20 as compile-time constant for loop bound
    // Runtime count check is done inside the loop
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

// ========== Shared refresh helpers (used by artifact/move systems) ==========

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
