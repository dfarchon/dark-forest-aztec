use dep::aztec::macros::aztec;

#[aztec]
contract Core {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, only_self, view},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};

    use dep::types::args::{
        AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs,
    };

    use dep::types::config::{
        artifacts::ArtifactsConfig,
        capture_zones::CaptureZonesConfig,
        default_stats::PlanetDefaultStats,
        game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
        snark::SnarkConfig,
        space_junk::SpaceJunkConfig,
        spaceships::SpaceshipsConfig,
        upgrade::Upgrade,
        world::WorldConfig,
    };

    use dep::types::storage::{
        arrival::{Arrival, ArrivalType},
        artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType},
        planet::{
            Planet, PlanetArtifacts, PlanetEventMetadata, PlanetEvents, PlanetEventType,
            PlanetRevealedCoords, PlanetType, SpaceType, UpgradeBranch,
        },
        player::Player,
        world::World,
    };

    use dep::libs::game_utils::{revert_if_bad_snark_perlin_flags, update_world_radius};

    use dep::libs::planet::{check_player_init, initialize_planet_with_defaults, refresh_planet};

    use dep::arrival_storage::ArrivalStorage;
    use dep::artifact_storage::ArtifactStorage;
    use dep::artifact_location_storage::ArtifactLocationStorage;
    use dep::config::Config;
    use dep::world_storage::WorldStorage;
    use dep::planet_storage::PlanetStorage;
    use dep::planet_artifacts_storage::PlanetArtifactsStorage;
    use dep::planet_revealed_coords_storage::PlanetRevealedCoordsStorage;
    use dep::planet_events_storage::PlanetEventsStorage;
    use dep::player_storage::PlayerStorage;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        config_storage_address: PublicMutable<AztecAddress, Context>,
        world_storage_address: PublicMutable<AztecAddress, Context>,
        player_storage_address: PublicMutable<AztecAddress, Context>,
        planet_storage_address: PublicMutable<AztecAddress, Context>,
        planet_revealed_coords_storage_address: PublicMutable<AztecAddress, Context>,
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,
        planet_artifacts_storage_address: PublicMutable<AztecAddress, Context>,
        arrivals_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_location_storage_address: PublicMutable<AztecAddress, Context>,
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    fn get_config_storage_address() -> AztecAddress {
        self.storage.config_storage_address.read()
    }

    #[internal("public")]
    fn get_player_storage_address() -> AztecAddress {
        self.storage.player_storage_address.read()
    }

    #[internal("public")]
    fn get_world_storage_address() -> AztecAddress {
        self.storage.world_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_storage_address() -> AztecAddress {
        self.storage.planet_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_revealed_coords_storage_address() -> AztecAddress {
        self.storage.planet_revealed_coords_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_events_storage_address() -> AztecAddress {
        self.storage.planet_events_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_artifacts_storage_address() -> AztecAddress {
        self.storage.planet_artifacts_storage_address.read()
    }

    #[internal("public")]
    fn get_arrivals_storage_address() -> AztecAddress {
        self.storage.arrivals_storage_address.read()
    }

    #[internal("public")]
    fn get_artifact_storage_address() -> AztecAddress {
        self.storage.artifact_storage_address.read()
    }

    #[internal("public")]
    fn get_artifact_location_storage_address() -> AztecAddress {
        self.storage.artifact_location_storage_address.read()
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        self.internal.assert_admin();
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    fn set_config_storage_address(config_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_storage_address);
    }

    #[external("public")]
    fn set_world_storage_address(world_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.world_storage_address.write(world_storage_address);
    }

    #[external("public")]
    fn set_player_storage_address(player_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.player_storage_address.write(player_storage_address);
    }

    #[external("public")]
    fn set_planet_storage_address(planet_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_storage_address.write(planet_storage_address);
    }

    #[external("public")]
    fn set_planet_revealed_coords_storage_address(
        planet_revealed_coords_storage_address: AztecAddress,
    ) {
        self.internal.assert_admin();
        self.storage
            .planet_revealed_coords_storage_address
            .write(planet_revealed_coords_storage_address);
    }

    #[external("public")]
    fn set_planet_events_storage_address(planet_events_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_events_storage_address.write(planet_events_storage_address);
    }

    #[external("public")]
    fn set_planet_artifacts_storage_address(planet_artifacts_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_storage_address);
    }

    #[external("public")]
    fn set_arrivals_storage_address(arrivals_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.arrivals_storage_address.write(arrivals_storage_address);
    }

    #[external("public")]
    fn set_artifact_storage_address(artifact_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.artifact_storage_address.write(artifact_storage_address);
    }

    #[external("public")]
    fn set_artifact_location_storage_address(artifact_location_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.artifact_location_storage_address.write(artifact_location_storage_address);
    }

    #[internal("public")]
    fn refresh_planet_internal(
        location: Field,
        planet_state: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
    ) {
        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_events_storage_address = self.internal.get_planet_events_storage_address();
        let planet_artifacts_storage_address = self.internal.get_planet_artifacts_storage_address();

        let planet_storage = PlanetStorage::at(planet_storage_address);
        let planet_events_storage = PlanetEventsStorage::at(planet_events_storage_address);
        let planet_artifacts_storage = PlanetArtifactsStorage::at(planet_artifacts_storage_address);

        let planet_is_valid: bool = self.view(planet_storage.verify(location, planet_state));
        let planet_events_is_valid: bool =
            self.view(planet_events_storage.verify(location, planet_events_state));
        let planet_artifacts_is_valid: bool =
            self.view(planet_artifacts_storage.verify(location, planet_artifacts_state));

        assert(planet_is_valid, "Planet is not valid");
        assert(planet_events_is_valid, "Planet events is not valid");
        assert(planet_artifacts_is_valid, "Planet artifacts is not valid");

        let arrivals_storage_address = self.internal.get_arrivals_storage_address();
        let artifact_storage_address = self.internal.get_artifact_storage_address();
        let artifact_location_storage_address =
            self.internal.get_artifact_location_storage_address();

        let arrival_storage = ArrivalStorage::at(arrivals_storage_address);
        let artifact_storage = ArtifactStorage::at(artifact_storage_address);
        let artifact_location_storage =
            ArtifactLocationStorage::at(artifact_location_storage_address);

        let cnt = planet_events_state.count;

        for i in 0..cnt {
            let event = planet_events_state.events[i];
            let arrival = arrivals[i];
            let artifact = artifacts[i];
            let artifact_location = artifact_locations[i];
            assert(event.id == arrival.id, "Event id does not match arrival id");

            let arrival_is_valid: bool =
                self.view(arrival_storage.verify(arrival.id as Field, arrival));
            assert(arrival_is_valid, "Arrival is not valid");

            // Verify artifact if carried
            if arrival.carried_artifact_id != 0 {
                let artifact_is_valid: bool = self.view(artifact_storage.verify(
                    arrival.carried_artifact_id,
                    artifact,
                ));
                assert(artifact_is_valid, "Artifact is not valid");

                let artifact_location_is_valid: bool = self.view(artifact_location_storage.verify(
                    arrival.carried_artifact_id,
                    artifact_location,
                ));
                assert(artifact_location_is_valid, "Artifact location is not valid");
            }
        }

        let res = refresh_planet(
            self.context.timestamp(),
            location,
            planet_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let new_planet = res.0;
        let new_planet_events_state = res.1;
        let new_planet_artifacts_state = res.2;
        let new_artifact_locations = res.3;

        self.call(planet_storage.set(location, new_planet));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));

        for i in 0..cnt {
            if artifact_locations[i] != new_artifact_locations[i] {
                let arrival = arrivals[i];
                if arrival.carried_artifact_id != 0 {
                    self.call(artifact_location_storage.set(
                        arrival.carried_artifact_id,
                        new_artifact_locations[i],
                    ));
                }
            }
        }
    }

    #[external("public")]
    fn refresh_planet_public(
        location: Field,
        planet_state: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
    ) {
        self.internal.refresh_planet_internal(
            location,
            planet_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );
    }

    /// Noir port of Solidity `DFCoreFacet.revealLocation`.
    #[external("public")]
    fn reveal_location(
        location: Field,
        perlin: u8,
        level: u8,
        x: Field,
        y: Field,
        planet_state: Planet,
        player_state: Player,
        world: World,
    ) {
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let snark_config = self.view(config.get_snark_config());
        if !snark_config.disable_zk_checks {
            //todo: implement zk checks
        }

        let planet_default_stats = self.view(config.get_planet_default_stats(level));
        let world_config = self.view(config.get_world_config());
        let game_config_core = self.view(config.get_game_config_core());
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds());
        let space_junk_config = self.view(config.get_space_junk_config());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier(3));

        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        let planet_is_valid: bool = self.view(planet_storage.verify(location, planet_state));
        assert(planet_is_valid, "Planet is not valid");
        assert(planet_state.is_home_planet, "Planet is not home planet");

        let sender = self.msg_sender().unwrap();

        if !planet_state.is_initialized {
            let planet = initialize_planet_with_defaults(
                location,
                perlin,
                false, // is_home_planet
                self.context.timestamp(),
                sender,
                level,
                planet_default_stats,
                world_config,
                planet_level_thresholds,
                game_config_core,
                space_junk_config,
                planet_type_weights_tier_0,
                planet_type_weights_tier_1,
                planet_type_weights_tier_2,
                planet_type_weights_tier_3,
            );

            self.call(planet_storage.set(location, planet));

            let world_storage_address = self.internal.get_world_storage_address();
            let world_storage = WorldStorage::at(world_storage_address);
            let world_valid: bool = self.view(world_storage.verify(0, world));
            assert(world_valid, "World state is not valid");
            let mut new_world = world;
            new_world.planet_events_count += 1;
            self.call(world_storage.set(0, new_world));
        }

        let check_timestamp = true;

        if check_timestamp {
            let player_storage_address = self.internal.get_player_storage_address();
            let player_storage = PlayerStorage::at(player_storage_address);
            let player_state_is_valid = self.view(player_storage.verify(sender, player_state));
            assert(player_state_is_valid, "Player is not valid");

            let timestamp = self.context.timestamp();
            assert(
                player_state.last_reveal_timestamp + world_config.location_reveal_cooldown
                    < timestamp,
                "Wait for cooldown before revealing again",
            );

            let mut new_player_state = player_state;
            new_player_state.last_reveal_timestamp = timestamp;

            self.call(player_storage.set(sender, new_player_state));

            let planet_revealed_coords_storage_address =
                self.internal.get_planet_revealed_coords_storage_address();
            let planet_revealed_coords_storage =
                PlanetRevealedCoordsStorage::at(planet_revealed_coords_storage_address);

            let planet_coords_is_initialized: bool =
                self.view(planet_revealed_coords_storage.is_initialized(location));
            assert(!planet_coords_is_initialized, "Location already revealed");

            let new_planet_coords =
                PlanetRevealedCoords { location_id: location, x: x, y: y, revealer: sender };
            self.call(planet_revealed_coords_storage.set(location, new_planet_coords));
        }
    }

    /// Noir port of Solidity `DFCoreFacet.initializePlayer`.
    #[external("private")]
    fn initialize_player(
        x: Field, //private
        y: Field, //private
        radius: u128,
        location_id: Field,
        perlin: u8,
        level: u8,
        provided_snark_config: SnarkConfig,
        planet_state: Planet,
        player_state: Player,
        world: World,
    ) {
        if !provided_snark_config.disable_zk_checks {
            //todo: implement zk checks
        }

        let sender = self.msg_sender().unwrap();

        self.enqueue_self.initialize_player_public(
            sender,
            location_id,
            perlin,
            level,
            radius,
            provided_snark_config,
            planet_state,
            player_state,
            world,
        );
    }

    #[external("public")]
    #[only_self]
    fn initialize_player_public(
        sender: AztecAddress,
        location_id: Field,
        perlin: u8,
        level: u8,
        radius: u128,
        provided_snark_config: SnarkConfig,
        planet_state: Planet,
        player_state: Player,
        world: World,
    ) {
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let snark_config = self.view(config.get_snark_config());
        assert(
            provided_snark_config.disable_zk_checks == snark_config.disable_zk_checks,
            "Disable zk checks is not valid",
        );

        revert_if_bad_snark_perlin_flags(provided_snark_config, snark_config);

        let planet_default_stats = self.view(config.get_planet_default_stats(level));

        let world_config = self.view(config.get_world_config());
        let game_config_core = self.view(config.get_game_config_core());
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds());
        let space_junk_config = self.view(config.get_space_junk_config());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier(3));

        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        let planet_is_valid = self.view(planet_storage.verify(location_id, planet_state));

        assert(planet_is_valid, "Planet is not valid");

        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);
        let world_is_valid = self.view(world_storage.verify(0, world));
        assert(world_is_valid, "World state is not valid");
        let mut new_world = world;

        if !planet_state.is_initialized {
            let planet = initialize_planet_with_defaults(
                location_id,
                perlin,
                true, // is_home_planet
                self.context.timestamp(),
                sender,
                level,
                planet_default_stats,
                world_config,
                planet_level_thresholds,
                game_config_core,
                space_junk_config,
                planet_type_weights_tier_0,
                planet_type_weights_tier_1,
                planet_type_weights_tier_2,
                planet_type_weights_tier_3,
            );

            self.call(planet_storage.set(location_id, planet));

            new_world.planet_ids_count += 1;
        }

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);
        let player_state_is_valid = self.view(player_storage.verify(sender, player_state));
        assert(player_state_is_valid, "Player is not valid");

        // check player state
        let check_player_init_result = check_player_init(
            location_id,
            perlin,
            radius,
            sender,
            player_state,
            world,
            game_config_core,
            world_config,
        );

        assert(check_player_init_result, "Player init is not valid");

        let player: Player = Player {
            init_timestamp: self.context.timestamp(),
            home_planet_id: location_id,
            last_reveal_timestamp: 0,
            score: 0,
            space_junk: 0,
            space_junk_limit: space_junk_config.space_junk_limit,
            claimed_ships: false,
        };

        self.call(player_storage.set(sender, player));

        new_world.player_ids_count += 1;
        new_world = update_world_radius(new_world, world_config);
        self.call(world_storage.set(0, new_world));
    }
}
