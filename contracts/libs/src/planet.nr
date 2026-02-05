use dep::aztec::protocol_types::address::AztecAddress;
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

/// Noir port of Solidity `LibPlanet.revealLocation`.
pub fn reveal_location(
    location: Field,
    perlin: u8,
    x: Field,
    y: Field,
    check_timestamp: bool,
    timestamp: u64,
    sender: AztecAddress,
    mut player_state: Player,
    world_config: WorldConfig,
    mut revealed_coords: RevealedCoords,
) -> (Player, RevealedCoords) {
    if check_timestamp {
        assert(
            timestamp
                > player_state.last_reveal_timestamp + world_config.location_reveal_cooldown_s,
            "wait for cooldown before revealing again",
        );
    }
    assert(revealed_coords.location_id == 0 as Field, "Location already revealed");

    revealed_coords = RevealedCoords { location_id: location, x: x, y: y, revealer: sender };

    player_state.last_reveal_timestamp = timestamp;

    (player_state, revealed_coords)
}

/// Noir port of Solidity `LibPlanet.getDefaultInitPlanetArgs`.
pub fn get_default_init_planet_args(
    location: Field,
    perlin: u8,
    is_home_planet: bool,
    time_factor_hundredths: u128,
) -> DFPInitPlanetArgs {
    let (level, planet_type, space_type) = get_planet_level_type_and_space_type(location, perlin);

    if is_home_planet {
        assert(level == 0, "Can only initialize on planet level 0");
        assert(planet_type == 0, "Can only initialize on regular planets"); // PlanetType::Planet = 0
    }

    DFPInitPlanetArgs {
        location,
        perlin,
        level,
        time_factor_hundredths,
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
    max_location_id: Field,
    time_factor_hundredths: u128,
    sender: AztecAddress,
) -> Planet {
    assert(location_id_valid(location, max_location_id), "Not a valid planet location");
    let init_args =
        get_default_init_planet_args(location, perlin, is_home_planet, time_factor_hundredths);

    _initialize_planet(init_args, timestamp, sender)
}

/// Noir port of Solidity `LibPlanet._initializePlanet`.
pub fn _initialize_planet(args: DFPInitPlanetArgs, timestamp: u64, sender: AztecAddress) -> Planet {
    let default_planet =
        default_planet(args.location, args.level, args.planet_type, args.space_type);

    let mut _planet = Planet::zero();
    _planet.location_id = location_id;
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
        _planet.space_junk = get_planet_default_space_junk(args.location);
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
    player_state: Player,
    global_state: GlobalState,
    game_config: GameConfig,
) -> bool {
    assert(!player.is_initialized, "Player is already initialized");
    let world_radius = global_state.world_radius;
    assert(radius <= world_radius, "Init radius is bigger than the current world radius");

    if game_config.spawn_rim_area != 0 {
        let radius_squared_times_pi: u128 = (radius * radius * 314) / 100;
        let world_radius_squared_times_pi: u128 = (world_radius * world_radius * 314) / 100;
        assert(
            radius_squared_times_pi + game_config.spawn_rim_area >= world_radius_squared_times_pi,
            "Player can only spawn at the universe rim",
        );
    }

    assert(
        perlin >= game_config.init_perlin_min,
        "Init not allowed in perlin value less than INIT_PERLIN_MIN",
    );

    assert(
        perlin < game_config.init_perlin_max,
        "Init not allowed in perlin value greater than or equal to the INIT_PERLIN_MAX",
    );

    true
}

/// Noir port of Solidity `LibPlanet.getRefreshedPlanet`.
pub fn get_refreshed_planet(
    location_id: Field,
    timestamp: u64,
    planet: Planet,
    planet_events_state: PlanetEvents,
    planet_artifacts_state: PlanetArtifacts,
    arrivals: [Arrival; 20],
    artifact_states: [ArtifactState; 20],
) -> (Planet, PlanetEvents, PlanetArtifacts) {
    let (planet, events_to_remove, artifacts_to_add) = apply_pending_events(
        timestamp,
        planet,
        planet_events_state,
        planet_artifacts_state,
        arrivals,
    );

    for i in 0..artifacts_to_add.artifacts_count {
        let artifact_id = artifacts_to_add.artifacts[i];
        let mut artifact: Artifact = Artifact::zero();

        for j in 0..artifact_states.length {
            if artifact_states[j].artifact.id == artifact_id {
                artifact = artifact_states[j].artifact;
            }
        }
        planet = apply_spaceship_arrive(artifact, planet);
    }
    planet = update_planet(timestamp, planet);

    (planet, events_to_remove, artifacts_to_add)
}

/// Noir port of Solidity `LibPlanet.applySpaceshipArrive`.
pub fn apply_spaceship_arrive(artifact: Artifact, planet: Planet) -> Planet {
    if !planet.is_home_planet {
        if artifact.artifact_type == ArtifactType::ShipMothership {
            if planet.energy_gro_doublers == 0 {
                planet.population_growth = planet.population_growth * 2;
            }
            planet.energy_gro_doublers += 1;
        } else if artifact.artifact_type == ArtifactType::ShipWhale {
            if planet.silver_gro_doublers == 0 {
                planet.silver_growth = planet.silver_growth * 2;
            }
            planet.silver_gro_doublers += 1;
        } else if artifact.artifact_type == ArtifactType::ShipTitan {
            planet.pausers += 1;
        }
    }
    planet
}

/// Noir port of Solidity `LibPlanet.refreshPlanet`.
pub fn refresh_planet(
    timestamp: u64,
    location_id: Field,
    mut planet: Planet,
    planet_events_state: PlanetEvents,
    planet_artifacts_state: PlanetArtifacts,
    arrivals: [Arrival; 20],
    artifact_states: [ArtifactState; 20],
) -> (Planet, PlanetEvents, PlanetArtifacts, [Arrival; 20], [ArtifactState; 20]) {
    assert(planet.is_initialized, "Planet is not initialized");

    let result = get_refreshed_planet(
        location_id,
        timestamp,
        planet,
        planet_events_state,
        planet_artifacts_state,
        arrivals,
        artifact_states,
    );

    planet = result.0;
    events_to_remove = result.1;
    artifacts_to_add = result.2;

    for i in 0..events_to_remove.events_count {
        let event_id = events_to_remove.events[i];

        for j in 0..planet_events_state.events_count {
            if planet_events_state.events[j].id == event_id {
                planet_events_state.events[j] =
                    planet_events_state.events[planet_events_state.events_count];
                planet_events_state.events[planet_events_state.events_count] =
                    PlanetEventMetadata::zero();
                planet_events_state.events_count -= 1;
            }
        }
    }

    for i in 0..artifacts_to_add.artifacts_count {
        let artifact_id = artifacts_to_add.artifacts[i];

        let artifact_state_idx: u32 = 0;
        for j in 0..artifact_states.artifacts_count {
            if artifact_states[j].artifact.id == artifact_id {
                artifact_state_idx = j;
            }
        }
        artifact_states[artifact_state_idx].voyage_id = 0;
        let res = _put_artifact_on_planet(
            artifact_id,
            artifact_states[artifact_state_idx],
            location_id,
            planet_artifacts_state,
        );
        planet_artifacts_state = res.3;
        artifact_states[artifact_state_idx] = res.1;
    }

    (planet, planet_events_state, planet_artifacts_state, arrivals, artifact_states)
}
