use artifact_action::ArtifactAction;
use artifact_find::ArtifactFind;
use artifact_prospect::ArtifactProspect;
use artifact_valut::ArtifactValut;
use aztec::{
    protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    test::helpers::test_environment::TestEnvironment,
};
use config::Config;
use core::Core;
use libs::batch_utils::{
    compute_config_hashes, compute_planet_state_hash, compute_player_hash, compute_world_hash,
};
use move_system::Move;
use planet_revealed_coords_storage::PlanetRevealedCoordsStorage;
use planet_storage::PlanetStorage;
use player_storage::PlayerStorage;
use types::{
    config::{
        artifacts::ArtifactsConfig,
        default_stats::PlanetDefaultStats,
        game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
        snark::SnarkConfig,
        space_junk::SpaceJunkConfig,
        spaceships::SpaceshipsConfig,
        world::WorldConfig,
    },
    storage::{
        arrival::Arrival,
        artifact::{Artifact, ArtifactLocation, ArtifactType},
        planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetRevealedCoords},
        player::Player,
        world::World,
    },
};
use world_storage::WorldStorage;

// Public-handler tests deliberately impersonate the contract inside TXE to
// isolate public storage validation. Private-entry tests use normal callers.
// No production account can bypass #[only_self] in this way.
fn stats() -> PlanetDefaultStats {
    PlanetDefaultStats {
        population_cap: 100000,
        population_growth: 1,
        range: 100,
        speed: 100,
        defense: 100,
        silver_growth: 0,
        silver_cap: 10000,
        barbarian_percentage: 0,
    }
}

unconstrained fn configured(env: &mut TestEnvironment, admin: AztecAddress) -> AztecAddress {
    let address = env.deploy("@config/Config").with_public_initializer(
        admin,
        Config::interface().constructor(admin),
    );
    let config = Config::at(address);
    env.call_public(admin, config.set_default_configs_batch_1());
    env.call_public(admin, config.set_default_configs_batch_2());
    for tier in 0..4 {
        env.call_public(admin, config.set_default_game_config_planet_type_weights_tier(tier as u8));
    }
    env.call_public(admin, config.set_planet_default_stats(0, stats()));
    address
}

struct Fixture {
    core: AztecAddress,
    planets: AztecAddress,
    players: AztecAddress,
    world: World,
    player: Player,
    planet: Planet,
    config_hashes: [Field; 9],
    stats_hash: Field,
}

unconstrained fn core_fixture(env: &mut TestEnvironment, admin: AztecAddress) -> Fixture {
    let config = configured(env, admin);
    let core_addr = env.deploy("@core/Core").with_public_initializer(
        admin,
        Core::interface().constructor(admin),
    );
    let core = Core::at(core_addr);
    let planets = env.deploy("@planet/PlanetStorage").with_public_initializer(
        admin,
        PlanetStorage::interface().constructor(admin),
    );
    let players = env.deploy("@player/PlayerStorage").with_public_initializer(
        admin,
        PlayerStorage::interface().constructor(admin),
    );
    let worlds = env.deploy("@world/WorldStorage").with_public_initializer(
        admin,
        WorldStorage::interface().constructor(admin),
    );
    let coords = env
        .deploy("@planet_revealed_coords/PlanetRevealedCoordsStorage")
        .with_public_initializer(admin, PlanetRevealedCoordsStorage::interface().constructor(admin))
        ;
    env.call_public(admin, core.set_config_storage_address(config));
    env.call_public(admin, core.set_planet_storage_address(planets));
    env.call_public(admin, core.set_player_storage_address(players));
    env.call_public(admin, core.set_world_storage_address(worlds));
    env.call_public(admin, core.set_planet_revealed_coords_storage_address(coords));
    env.call_public(admin, PlanetStorage::at(planets).add_authorized_contract(core_addr));
    env.call_public(admin, PlayerStorage::at(players).add_authorized_contract(core_addr));
    env.call_public(
        admin,
        PlanetRevealedCoordsStorage::at(coords).add_authorized_contract(core_addr),
    );
    let mut world = World::zero();
    world.misc_nonce = 1;
    env.call_public(admin, WorldStorage::at(worlds).set(0, world));
    let mut player = Player::zero();
    player.last_updated = 1;
    env.call_public(admin, PlayerStorage::at(players).set(admin, player));
    let mut planet = Planet::zero();
    planet.owner = admin;
    planet.population = 100;
    planet.population_cap = 100000;
    planet.population_growth = 1;
    planet.last_updated = 100;
    planet.is_initialized = true;
    env.call_public(admin, PlanetStorage::at(planets).set(1, planet));
    let (stats_hash, config_hashes) = compute_config_hashes(
        SnarkConfig::zero(),
        stats(),
        WorldConfig::zero(),
        GameConfigCore::zero(),
        PlanetLevelThresholds::zero(),
        SpaceJunkConfig::zero(),
        PlanetTypeWeightsTier::zero(0),
        PlanetTypeWeightsTier::zero(1),
        PlanetTypeWeightsTier::zero(2),
        PlanetTypeWeightsTier::zero(3),
    );
    Fixture { core: core_addr, planets, players, world, player, planet, config_hashes, stats_hash }
}

unconstrained fn reveal(
    env: TestEnvironment,
    admin: AztecAddress,
    f: Fixture,
    location: Field,
    old_hash: Field,
    new_planet: Planet,
) {
    env.call_public(
        f.core,
        Core::at(f.core).reveal_location_public(
            location, // location
            admin, // sender
            env.last_block_timestamp(), // timestamp
            false, // is_admin
            f.config_hashes, // config_hashes
            f.stats_hash, // planet_default_stats_hash
            old_hash, // planet_state_hash
            0, // planet_revealed_coords_hash
            compute_player_hash(f.player), // player_state_hash
            compute_world_hash(f.world), // world_hash
            new_planet, // new_planet
            PlanetRevealedCoords::zero(), // new_planet_revealed_coords
            f.player, // new_player_state
        ),
    );
}

#[test(should_fail_with = "Planet state hash mismatch")]
unconstrained fn reveal_rejects_zero_witness_for_occupied_planet() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let f = core_fixture(&mut env, admin);
    reveal(env, admin, f, 1, 0, f.planet);
}

#[test]
unconstrained fn reveal_preserves_existing_planet_clock_and_state() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let f = core_fixture(&mut env, admin);
    let old_hash = compute_planet_state_hash(f.planet);
    let mut would_advance_clock = f.planet;
    would_advance_clock.last_updated = 120;
    reveal(env, admin, f, 1, old_hash, would_advance_clock);
    assert(env.view_public(PlanetStorage::at(f.planets).get_state_root(1)) == old_hash);
    // Pending arrivals remain safely processable at their original timestamp.
    let settled = libs::lazy_update::update_planet(110, f.planet);
    assert(settled.last_updated == 110);
    assert(settled.population == 110);
}

#[test]
unconstrained fn reveal_can_create_a_genuinely_absent_planet() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let f = core_fixture(&mut env, admin);
    reveal(env, admin, f, 2, 0, f.planet);
    assert(env.view_public(PlanetStorage::at(f.planets).verify_hash(
        2,
        compute_planet_state_hash(f.planet),
    )));
}

#[test(should_fail_with = "Planet already initialized")]
unconstrained fn initialize_rejects_zero_witness_for_occupied_planet() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let f = core_fixture(&mut env, admin);
    let attacker = env.create_light_account();
    env.call_public(
        f.core,
        Core::at(f.core).initialize_player_public(
            attacker, // sender
            1, // location_id
            env.last_block_timestamp(), // timestamp
            f.config_hashes, // config_hashes
            f.stats_hash, // planet_default_stats_hash
            0, // planet_state_hash
            0, // planet_artifacts_state_hash
            0, // planet_events_state_hash
            0, // original_arrivals_count
            [0; 20], // arrival_ids
            [0; 20], // arrival_hashes
            [0; 20], // arrival_artifact_ids
            [0; 20], // arrival_artifact_hashes
            [0; 20], // arrival_artifact_location_hashes
            0, // player_state_hash
            compute_world_hash(f.world), // world_hash
            f.planet, // new_planet
            PlanetEvents::zero(), // new_planet_events_state
            PlanetArtifacts::zero(), // new_planet_artifacts_state
            [ArtifactLocation::zero(); 20], // new_arrival_artifact_locations
            f.player, // new_player
        ),
    );
}

#[test(should_fail_with = "Source and target planets must differ")]
unconstrained fn move_rejects_self_move() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let address = env.deploy("@move/Move").with_public_initializer(
        admin,
        Move::interface().constructor(admin),
    );
    env.call_private(
        admin,
        Move::at(address).move(
            1, // source_loc
            1, // target_loc
            0, // target_perlin
            0, // target_level
            0, // max_dist
            0, // x1
            0, // y1
            0, // x2
            0, // y2
            0, // pop_moved
            0, // silver_moved
            0, // moved_artifact_id
            0, // source_activated_artifact_id
            0, // target_activated_artifact_id
            false, // is_abandoning
            0, // timestamp
            SnarkConfig::zero(), // snark_config
            stats(), // planet_default_stats
            WorldConfig::zero(), // world_config
            GameConfigCore::zero(), // game_config_core
            PlanetLevelThresholds::zero(), // planet_level_thresholds
            SpaceJunkConfig::zero(), // space_junk_config
            PlanetTypeWeightsTier::zero(0), // planet_type_weights_tier_0
            PlanetTypeWeightsTier::zero(1), // planet_type_weights_tier_1
            PlanetTypeWeightsTier::zero(2), // planet_type_weights_tier_2
            PlanetTypeWeightsTier::zero(3), // planet_type_weights_tier_3
            ArtifactsConfig::zero(), // artifacts_config
            Planet::zero(), // source_planet
            PlanetArtifacts::zero(), // source_planet_artifacts_state
            PlanetEvents::zero(), // source_planet_events_state
            [Arrival::zero(); 20], // source_arrivals
            [Artifact::zero(); 20], // source_arrival_artifacts
            [ArtifactLocation::zero(); 20], // source_arrival_artifact_locations
            Planet::zero(), // target_planet
            PlanetArtifacts::zero(), // target_planet_artifacts_state
            PlanetEvents::zero(), // target_planet_events_state
            [Arrival::zero(); 20], // target_arrivals
            [Artifact::zero(); 20], // target_arrival_artifacts
            [ArtifactLocation::zero(); 20], // target_arrival_artifact_locations
            World::zero(), // world
            Artifact::zero(), // moved_artifact
            Artifact::zero(), // source_activated_artifact
            Artifact::zero(), // target_activated_artifact
        ),
    );
}

#[test(should_fail_with = "Source and target planets must differ")]
unconstrained fn move_public_rejects_self_move() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let address = env.deploy("@move/Move").with_public_initializer(
        admin,
        Move::interface().constructor(admin),
    );
    env.call_public(
        address,
        Move::at(address).move_public(
            1, // source_loc
            1, // target_loc
            0, // target_level
            0, // moved_artifact_id
            0, // source_activated_artifact_id
            0, // target_activated_artifact_id
            0, // timestamp
            [0; 9], // config_hashes
            0, // artifacts_config_hash
            0, // planet_default_stats_hash
            0, // source_planet_hash
            0, // source_planet_artifacts_state_hash
            0, // source_planet_events_state_hash
            [0; 20], // source_arrival_ids
            [0; 20], // source_arrival_hashes
            [0; 20], // source_arrival_artifact_ids
            [0; 20], // source_arrival_artifact_hashes
            [0; 20], // source_arrival_artifact_location_hashes
            0, // original_source_arrivals_count
            0, // target_planet_hash
            0, // target_planet_artifacts_state_hash
            0, // target_planet_events_state_hash
            [0; 20], // target_arrival_ids
            [0; 20], // target_arrival_hashes
            [0; 20], // target_arrival_artifact_ids
            [0; 20], // target_arrival_artifact_hashes
            [0; 20], // target_arrival_artifact_location_hashes
            0, // original_target_arrivals_count
            0, // world_hash
            0, // moved_artifact_hash
            0, // source_activated_artifact_hash
            0, // target_activated_artifact_hash
            Planet::zero(), // new_source_planet
            PlanetArtifacts::zero(), // new_source_planet_artifacts_state
            PlanetEvents::zero(), // new_source_planet_events_state
            [ArtifactLocation::zero(); 20], // new_source_arrival_artifact_locations
            Planet::zero(), // new_target_planet
            PlanetArtifacts::zero(), // new_target_planet_artifacts_state
            PlanetEvents::zero(), // new_target_planet_events_state_input
            [ArtifactLocation::zero(); 20], // new_target_arrival_artifact_locations
            Arrival::zero(), // new_arrival_input
            ArtifactLocation::zero(), // new_moved_artifact_location_input
            Artifact::zero(), // new_source_activated_artifact
            ArtifactLocation::zero(), // new_source_activated_artifact_location
        ),
    );
}

#[test(should_fail_with = "Artifact already activated")]
unconstrained fn active_artifact_cannot_be_activated_again() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let address = env.deploy("@artifact_action/ArtifactAction").with_public_initializer(
        admin,
        ArtifactAction::interface().constructor(admin),
    );
    let mut planet = Planet::zero();
    planet.owner = admin;
    planet.population = 100000;
    planet.population_cap = 100000;
    let mut artifact = Artifact::zero();
    artifact.artifact_type = ArtifactType::Monolith;
    artifact.last_activated = 1;
    let mut artifacts = PlanetArtifacts::zero();
    artifacts.count = 1;
    artifacts.ids[0] = 2;
    let mut location = ArtifactLocation::zero();
    location.planet_id = 1;
    env.call_private(
        admin,
        ArtifactAction::at(address).activate_artifact(
            1, // location_id
            2, // artifact_id
            0, // wormhole_to
            2, // timestamp
            planet, // planet
            PlanetEvents::zero(), // planet_events_state
            [Arrival::zero(); 20], // arrivals
            [Artifact::zero(); 20], // arrival_artifacts
            [ArtifactLocation::zero(); 20], // arrival_artifact_locations
            artifacts, // planet_artifacts_state
            artifact, // artifact
            location, // artifact_location
            World::zero(), // world
            WorldConfig::zero(), // world_config
            stats(), // planet_default_stats
        ),
    );
}

#[test(should_fail_with = "Spaceships config hash mismatch")]
unconstrained fn artifact_prospect_rejects_uncommitted_ship_config() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let config = configured(&mut env, admin);
    let address = env.deploy("@artifact_prospect/ArtifactProspect").with_public_initializer(
        admin,
        ArtifactProspect::interface().constructor(admin),
    );
    env.call_public(admin, ArtifactProspect::at(address).set_config_storage_address(config));
    let mut ships = SpaceshipsConfig::zero();
    ships.gear = false;
    let mut planet = Planet::zero();
    planet.prospected_block_number = env.last_block_number();
    env.mine_block();
    env.call_public(
        address,
        ArtifactProspect::at(address).prospect_planet_public(
            0, // location_id
            env.last_block_timestamp(), // timestamp
            poseidon2_hash(ships.serialize()), // spaceships_config_hash
            0, // planet_hash
            0, // planet_artifacts_state_hash
            0, // planet_events_state_hash
            0, // origin_arrivals_count
            [0; 20], // arrival_ids
            [0; 20], // arrival_hashes
            [0; 20], // artifact_ids
            [0; 20], // artifact_hashes
            [0; 20], // artifact_location_hashes
            0, // world_hash
            planet, // new_planet
            PlanetArtifacts::zero(), // new_planet_artifacts_state
            PlanetEvents::zero(), // new_planet_events_state
            0, // change_artifact_location_count
            [0; 20], // change_artifact_location_ids
            [ArtifactLocation::zero(); 20], // change_artifact_locations
            [0; 20], // owned_artifact_ids
            [0; 20], // owned_artifact_hashes
            [0; 20], // owned_artifact_location_hashes
            0, // owned_artifact_count
        ),
    );
}

#[test(should_fail_with = "Spaceships config hash mismatch")]
unconstrained fn artifact_find_rejects_uncommitted_ship_config() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let config = configured(&mut env, admin);
    let address = env.deploy("@artifact_find/ArtifactFind").with_public_initializer(
        admin,
        ArtifactFind::interface().constructor(admin),
    );
    env.call_public(admin, ArtifactFind::at(address).set_config_storage_address(config));
    let mut ships = SpaceshipsConfig::zero();
    ships.gear = false;
    let mut planet = Planet::zero();
    planet.prospected_block_number = env.last_block_number();
    env.mine_block();
    env.call_public(
        address,
        ArtifactFind::at(address).find_artifact_public(
            0, // location_id
            0, // artifact_id
            env.last_block_timestamp(), // timestamp
            0, // snark_config_hash
            0, // game_config_core_hash
            0, // world_config_hash
            0, // artifacts_config_hash
            poseidon2_hash(ships.serialize()), // spaceships_config_hash
            0, // player_hash
            0, // planet_hash
            0, // planet_events_state_hash
            [0; 20], // arrival_ids
            [0; 20], // arrival_hashes
            [0; 20], // arrival_artifact_ids
            [0; 20], // arrival_artifact_hashes
            [0; 20], // arrival_artifact_location_hashes
            0, // origin_arrivals_count
            0, // planet_artifacts_state_hash
            [0; 20], // owned_artifact_ids
            [0; 20], // owned_artifact_hashes
            [0; 20], // owned_artifact_location_hashes
            0, // owned_artifact_count
            0, // world_hash
            planet, // new_planet
            PlanetEvents::zero(), // new_planet_events_state
            PlanetArtifacts::zero(), // new_planet_artifacts_state
            0, // change_artifact_location_count
            [0; 20], // change_artifact_location_ids
            [ArtifactLocation::zero(); 20], // change_artifact_locations
            Artifact::zero(), // new_artifact
            ArtifactLocation::zero(), // new_artifact_location
            Player::zero(), // new_player
        ),
    );
}

#[test(should_fail_with = "Spaceships config hash mismatch")]
unconstrained fn artifact_valut_rejects_uncommitted_ship_config() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let config = configured(&mut env, admin);
    let address = env.deploy("@artifact_valut/ArtifactValut").with_public_initializer(
        admin,
        ArtifactValut::interface().constructor(admin),
    );
    env.call_public(admin, ArtifactValut::at(address).set_config_storage_address(config));
    let mut ships = SpaceshipsConfig::zero();
    ships.gear = false;
    let mut planet = Planet::zero();
    planet.prospected_block_number = env.last_block_number();
    env.mine_block();
    env.call_public(
        address,
        ArtifactValut::at(address).give_spaceships_public(
            admin, // sender
            0, // location_id
            env.last_block_timestamp(), // timestamp
            poseidon2_hash(ships.serialize()), // spaceships_config_hash
            0, // planet_hash
            0, // planet_artifacts_state_hash
            0, // planet_events_state_hash
            [0; 20], // arrival_ids
            [0; 20], // arrival_hashes
            [0; 20], // artifact_ids
            [0; 20], // artifact_hashes
            [0; 20], // artifact_location_hashes
            0, // origin_arrivals_count
            0, // player_hash
            planet, // new_planet
            PlanetEvents::zero(), // new_planet_events_state
            PlanetArtifacts::zero(), // new_planet_artifacts_state
            [ArtifactLocation::zero(); 20], // new_artifact_locations
            Player::zero(), // new_player
            [0; 5], // spaceships_ids
            [Artifact::zero(); 5], // spaceships
            [ArtifactLocation::zero(); 5], // spaceships_locations
        ),
    );
}
