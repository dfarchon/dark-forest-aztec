use dep::aztec::protocol_types::address::AztecAddress;
use dep::types::args::{AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs};

use dep::types::config::{
    ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetDefaultStats,
    PlanetLevelThresholds, PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig,
    Upgrade, UpgradeConfig, WorldConfig,
};

use dep::types::storage::{
    Arrival, ArrivalType, Artifact, ArtifactRarity, ArtifactState, ArtifactType, GlobalState,
    Planet, PlanetArtifacts, PlanetCaps, PlanetData, PlanetEventMetadata, PlanetEvents,
    PlanetEventType, PlanetFullState, PlanetMeta, PlanetMods, PlanetOwner, PlanetResources,
    PlanetType, Player, RevealedCoords, SpaceType, StateRoot, UpgradeBranch,
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
    _planet.location_id = args.location;
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
    player_state: Player,
    global_state: GlobalState,
    game_config_core: GameConfigCore,
    world_config: WorldConfig,
) -> bool {
    assert(!player_state.is_initialized, "Player is already initialized");
    let world_radius = global_state.world_radius;
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

fn apply_upgrade_multiplier(mut planet_caps: PlanetCaps, upgrade: Upgrade) -> PlanetCaps {
    planet_caps.population_cap =
        (planet_caps.population_cap * upgrade.pop_cap_multiplier) / 100;
    planet_caps.population_growth =
        (planet_caps.population_growth * upgrade.pop_gro_multiplier) / 100;
    planet_caps.range = (planet_caps.range * upgrade.range_multiplier) / 100;
    planet_caps.speed = (planet_caps.speed * upgrade.speed_multiplier) / 100;
    planet_caps.defense = (planet_caps.defense * upgrade.def_multiplier) / 100;

    planet_caps
}

/// Noir port of Solidity `LibPlanet.upgradePlanet` validation checks.
pub fn validate_upgrade(
    planet_owner: PlanetOwner,
    planet_resources: PlanetResources,
    sender: AztecAddress,
    defense_upgrades: u8,
    range_upgrades: u8,
    speed_upgrades: u8,
    upgrade_config: UpgradeConfig,
) {
    assert(planet_owner.owner == sender, "Only owner can upgrade planet");
    assert(planet_owner.planet_type == PlanetType::Planet(), "Can only upgrade regular planets");
    assert(planet_owner.planet_level > 0, "Planet level must be greater than 0");

    assert(
        defense_upgrades <= upgrade_config.max_single_level,
        "Defense upgrades exceed max single level",
    );
    assert(
        range_upgrades <= upgrade_config.max_single_level,
        "Range upgrades exceed max single level",
    );
    assert(
        speed_upgrades <= upgrade_config.max_single_level,
        "Speed upgrades exceed max single level",
    );

    let new_defense_level = planet_resources.upgrade_state_0 + defense_upgrades;
    let new_range_level = planet_resources.upgrade_state_1 + range_upgrades;
    let new_speed_level = planet_resources.upgrade_state_2 + speed_upgrades;

    assert(
        new_defense_level <= upgrade_config.max_single_level,
        "Defense branch exceeds max level",
    );
    assert(
        new_range_level <= upgrade_config.max_single_level,
        "Range branch exceeds max level",
    );
    assert(
        new_speed_level <= upgrade_config.max_single_level,
        "Speed branch exceeds max level",
    );

    let space_type_idx: u32 = planet_owner.space_type as u32;
    assert(space_type_idx < 4, "Invalid space type");

    let new_total_level = new_defense_level + new_range_level + new_speed_level;
    let max_total_level = upgrade_config.max_total_level[space_type_idx];
    assert(new_total_level <= max_total_level, "Total upgrade level exceeds space limit");
}

/// Noir port of Solidity `LibPlanet.upgradePlanet` silver cost calculation.
pub fn calculate_upgrade_cost(
    planet_resources: PlanetResources,
    planet_caps: PlanetCaps,
    defense_upgrades: u8,
    range_upgrades: u8,
    speed_upgrades: u8,
    upgrade_config: UpgradeConfig,
) -> u128 {
    let current_total_level =
        planet_resources.upgrade_state_0 + planet_resources.upgrade_state_1
            + planet_resources.upgrade_state_2;
    let new_total_level =
        current_total_level + defense_upgrades + range_upgrades + speed_upgrades;

    let mut silver_cost_percent_sum: u128 = 0;
    for level in (current_total_level as u32)..(new_total_level as u32) {
        silver_cost_percent_sum += upgrade_config.silver_cost_percent[level] as u128;
    }

    (silver_cost_percent_sum * planet_caps.silver_cap) / 100
}

/// Noir port of Solidity `LibPlanet.upgradePlanet` state updates.
pub fn apply_upgrade(
    mut planet_caps: PlanetCaps,
    mut planet_resources: PlanetResources,
    defense_upgrades: u8,
    range_upgrades: u8,
    speed_upgrades: u8,
    upgrades: [[Upgrade; 4]; 3],
    silver_cost: u128,
) -> (PlanetCaps, PlanetResources) {
    assert(planet_resources.silver >= silver_cost, "Insufficient silver for upgrade");
    planet_resources.silver -= silver_cost;

    let defense_start = planet_resources.upgrade_state_0;
    for i in 0..(defense_upgrades as u32) {
        let level = defense_start + i as u8;
        let upgrade = upgrades[UpgradeBranch::Defense() as u32][level as u32];
        planet_caps = apply_upgrade_multiplier(planet_caps, upgrade);
    }

    let range_start = planet_resources.upgrade_state_1;
    for i in 0..(range_upgrades as u32) {
        let level = range_start + i as u8;
        let upgrade = upgrades[UpgradeBranch::Range() as u32][level as u32];
        planet_caps = apply_upgrade_multiplier(planet_caps, upgrade);
    }

    let speed_start = planet_resources.upgrade_state_2;
    for i in 0..(speed_upgrades as u32) {
        let level = speed_start + i as u8;
        let upgrade = upgrades[UpgradeBranch::Speed() as u32][level as u32];
        planet_caps = apply_upgrade_multiplier(planet_caps, upgrade);
    }

    planet_resources.upgrade_state_0 = defense_start + defense_upgrades;
    planet_resources.upgrade_state_1 = range_start + range_upgrades;
    planet_resources.upgrade_state_2 = speed_start + speed_upgrades;

    (planet_caps, planet_resources)
}

/// Noir port of Solidity `LibPlanet.getRefreshedPlanet`.
pub fn get_refreshed_planet(
    location_id: Field,
    timestamp: u64,
    mut planet: Planet,
    planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    artifact_states: [ArtifactState; 20],
    planet_artifacts_state: PlanetArtifacts,
) -> (Planet, PlanetEvents, PlanetArtifacts) {
    let res = apply_pending_events(timestamp, planet, planet_events_state, arrivals);

    planet = res.0;
    let events_to_remove = res.1;
    let artifacts_to_add = res.2;

    for i in 0..artifacts_to_add.artifacts_count {
        let artifact_id = artifacts_to_add.artifacts[i];
        let mut artifact: Artifact = Artifact::zero();

        for j in 0..planet_artifacts_state.artifacts_count {
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
pub fn refresh_planet(
    timestamp: u64,
    location_id: Field,
    mut planet: Planet,
    mut planet_events_state: PlanetEvents,
    arrivals: [Arrival; 20],
    mut artifact_states: [ArtifactState; 20],
    mut planet_artifacts_state: PlanetArtifacts,
) -> (Planet, PlanetEvents, PlanetArtifacts, [ArtifactState; 20]) {
    assert(planet.is_initialized, "Planet is not initialized");

    let result = get_refreshed_planet(
        location_id,
        timestamp,
        planet,
        planet_events_state,
        arrivals,
        artifact_states,
        planet_artifacts_state,
    );

    planet = result.0;
    let events_to_remove = result.1;
    let artifacts_to_add = result.2;

    for i in 0..events_to_remove.events_count {
        let event_id = events_to_remove.events[i].id;

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

        let mut artifact_state_idx: u32 = 0;
        for j in 0..planet_artifacts_state.artifacts_count {
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

    (planet, planet_events_state, planet_artifacts_state, artifact_states)
}
