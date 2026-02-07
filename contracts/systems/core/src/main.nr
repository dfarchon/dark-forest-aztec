use dep::aztec::macros::aztec;

#[aztec]
contract Core {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, view, only_self},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Packable},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};

    use dep::types::args::{
        AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs,
    };

    use dep::types::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetDefaultStats,
        PlanetLevelThresholds, PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig,
        SpaceshipsConfig, Upgrade, WorldConfig,
    };

    use dep::types::storage::{
        Arrival, ArrivalType, Artifact, ArtifactRarity, ArtifactState, ArtifactType, GlobalState,
        Planet, PlanetArtifacts, PlanetCaps, PlanetData, PlanetEventMetadata, PlanetEvents,
        PlanetEventType, PlanetFullState, PlanetMeta, PlanetMods, PlanetOwner, PlanetResources,
        PlanetType, Player, RevealedCoords, SpaceType, StateRoot, UpgradeBranch,
    };

    use dep::libs::game_utils::{
        update_world_radius,
        check_player_init,
        revert_if_bad_snark_perlin_flags
    };

    use dep::libs::planet::{
        initialize_planet_with_defaults,
    };

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        planet_meta_storage_address: PublicMutable<AztecAddress, Context>,
        planet_owner_storage_address: PublicMutable<AztecAddress, Context>,
        planet_caps_storage_address: PublicMutable<AztecAddress, Context>,
        planet_resources_storage_address: PublicMutable<AztecAddress, Context>,
        planet_mods_storage_address: PublicMutable<AztecAddress, Context>,
        planet_coords_storage_address: PublicMutable<AztecAddress, Context>,
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,
        planet_artifacts_storage_address: PublicMutable<AztecAddress, Context>,
        arrivals_storage_address: PublicMutable<AztecAddress, Context>,
        artifacts_storage_address: PublicMutable<AztecAddress, Context>,
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
    }

    #[internal("public")]
    fn get_planet_meta_storage_address() -> AztecAddress {
        self.storage.planet_meta_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_owner_storage_address() -> AztecAddress {
        self.storage.planet_owner_storage_address.read()
    }
    
    #[internal("public")]
    fn get_planet_caps_storage_address() -> AztecAddress {
        self.storage.planet_caps_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_resources_storage_address() -> AztecAddress {
        self.storage.planet_resources_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_mods_storage_address() -> AztecAddress {
        self.storage.planet_mods_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_coords_storage_address() -> AztecAddress {
        self.storage.planet_coords_storage_address.read()
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
    fn get_artifacts_storage_address() -> AztecAddress {
        self.storage.artifacts_storage_address.read()
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
    fn set_planet_meta_storage_address(planet_meta_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_meta_storage_address.write(planet_meta_storage_address);
    }

    #[external("public")]
    fn set_planet_owner_storage_address(planet_owner_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_owner_storage_address.write(planet_owner_storage_address);
    }

    #[external("public")]
    fn set_planet_caps_storage_address(planet_caps_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_caps_storage_address.write(planet_caps_storage_address);
    }

    #[external("public")]
    fn set_planet_resources_storage_address(planet_resources_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_resources_storage_address.write(planet_resources_storage_address);
    }

    #[external("public")]
    fn set_planet_mods_storage_address(planet_mods_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_mods_storage_address.write(planet_mods_storage_address);
    }

    #[external("public")]
    fn set_planet_coords_storage_address(planet_coords_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_coords_storage_address.write(planet_coords_storage_address);
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
    fn set_artifacts_storage_address(artifacts_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.artifacts_storage_address.write(artifacts_storage_address);
    }

    #[internal("public")]
    fn refresh_planet_internal(
        location: Field,
        planet_meta_state: PlanetMeta,
        planet_owner_state: PlanetOwner,
        planet_caps_state: PlanetCaps,
        planet_resources_state: PlanetResources,
        planet_mods_state: PlanetMods,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts_state: [ArtifactState; 20],
        planet_artifacts_state: PlanetArtifacts,
    ) {
        let planet_meta_storage_address = self.internal.get_planet_meta_storage_address();
        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
        let planet_resources_storage_address = self.internal.get_planet_resources_storage_address();
        let planet_mods_storage_address = self.internal.get_planet_mods_storage_address();
        let planet_events_storage_address = self.internal.get_planet_events_storage_address();
        let planet_artifacts_storage_address = self.internal.get_planet_artifacts_storage_address();
       
        let planet_meta_storage = PlanetMetaStorage::at(planet_meta_storage_address);
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
        let planet_resources_storage = PlanetResourcesStorage::at(planet_resources_storage_address);
        let planet_mods_storage = PlanetModsStorage::at(planet_mods_storage_address);
        let planet_events_storage = PlanetEventsStorage::at(planet_events_storage_address);
        let planet_artifacts_storage = PlanetArtifactsStorage::at(planet_artifacts_storage_address);
       
        let planet_meta_is_valid: bool = self.view(planet_meta_storage.verify(location, planet_meta_state));
        let planet_owner_is_valid: bool = self.view(planet_owner_storage.verify(location, planet_owner_state));
        let planet_caps_is_valid: bool = self.view(planet_caps_storage.verify(location, planet_caps_state));
        let planet_resources_is_valid: bool = self.view(planet_resources_storage.verify(location, planet_resources_state));
        let planet_mods_is_valid: bool = self.view(planet_mods_storage.verify(location, planet_mods_state));
        let planet_events_is_valid: bool = self.view(planet_events_storage.verify(location, planet_events_state));
        let planet_artifacts_is_valid: bool = self.view(planet_artifacts_storage.verify(location, planet_artifacts_state));
        
        assert(planet_meta_is_valid, "Planet meta is not valid");
        assert(planet_owner_is_valid, "Planet owner is not valid");
        assert(planet_caps_is_valid, "Planet caps is not valid");
        assert(planet_resources_is_valid, "Planet resources is not valid");
        assert(planet_mods_is_valid, "Planet mods is not valid");
        assert(planet_events_is_valid, "Planet events is not valid");
        assert(planet_artifacts_is_valid, "Planet artifacts is not valid");

        let arrivals_storage_address = self.internal.get_arrivals_storage_address();
        let artifacts_storage_address = self.internal.get_artifacts_storage_address();

        let arrivals_storage = ArrivalsStorage::at(arrivals_storage_address);
        let artifacts_storage = ArtifactsStorage::at(artifacts_storage_address);

        let cnt = planet_events_state.events_count;

        for i in 0..cnt {

            let event = planet_events_state.events[i];
            let arrival = arrivals[i];
            let artifact = artifacts_state[i];
            assert(event.id == arrival.id, "Event id does not match arrival id");
            assert(artifact.id == arrival.carried_artifact_id, "Artifact id does not match arrival carried artifact id");

            let arrival_is_valid: bool = self.view(arrivals_storage.verify(arrival.id, arrival));
            assert(arrival_is_valid, "Arrival is not valid");
            let artifact_is_valid: bool = self.view(artifacts_storage.verify(artifact.id, artifact));
            assert(artifact_is_valid, "Artifact is not valid");
        }

        let planet: Planet = Planet::from_parts(planet_meta_state, planet_owner_state, planet_caps_state, planet_resources_state, planet_mods_state);

        let res = refresh_planet(
            self.context.timestamp(),
            location,
            planet,
            planet_events_state,
            arrivals,
            artifacts_state,
            planet_artifacts_state,
        );

        let new_planet = res.0;
        let (meta,owner,caps,resources,mods) = new_planet.to_meta_owner_caps_resources_mods();
        self.call(planet_meta_storage.set(location, meta));
        self.call(planet_owner_storage.set(location, owner));
        self.call(planet_caps_storage.set(location, caps));
        self.call(planet_resources_storage.set(location, resources));
        self.call(planet_mods_storage.set(location, mods));

        let new_planet_events_state = res.1;
        self.call(planet_events_storage.set(location, new_planet_events_state));

        let new_planet_artifacts_state = res.2;
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));

        let new_artifacts_state = res.3;

        for i in 0..cnt {
            let artifact = artifacts_state[i];
            let new_artifact = new_artifacts_state[i];

            if artifact.id != new_artifact.id {
                self.call(artifacts_storage.set(artifact.id, new_artifact));
            }   
        }
    } 

    #[external("public")]
    fn refresh_planet(
        location: Field, 
        planet_meta_state: PlanetMeta, 
        planet_owner_state: PlanetOwner, 
        planet_caps_state: PlanetCaps, 
        planet_resources_state: PlanetResources, 
        planet_mods_state: PlanetMods, 
        planet_events_state: PlanetEvents, 
        arrivals: [Arrival; 20], 
        artifacts_state: [ArtifactState; 20], 
        planet_artifacts_state: PlanetArtifacts
    ) {
        self.internal.refresh_planet_internal(
            location, 
            planet_meta_state, 
            planet_owner_state, 
            planet_caps_state, 
            planet_resources_state, 
            planet_mods_state, 
            planet_events_state, 
            arrivals, 
            artifacts_state, 
            planet_artifacts_state
        );
    }

    /// Noir port of Solidity `DFCoreFacet.revealLocation`.
    #[external("public")]
    fn reveal_location(
        location: Field, 
        perlin: u8, 
        x: Field, 
        y: Field,
        planet_owner_state: PlanetOwner,
        player_state: Player,
    ) {
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let snark_constants = self.view(config.get_snark_constants_public());
        if !snark_constants.disable_zk_checks {
           //todo: implement zk checks
        }

        let world_config = self.view(config.get_world_config_public());
        let game_config_core = self.view(config.get_game_config_core_public());
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds_public());
        let space_junk_config = self.view(config.get_space_junk_config_public());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier_public(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier_public(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier_public(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier_public(3));
        
        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        let planet_owner_state = self.view(planet_owner_storage.get(location));
        assert(planet_owner_state.is_initialized, "Planet owner is not initialized");
        assert(planet_owner_state.is_home_planet, "Planet is not home planet");

        if !planet_owner_state.is_initialized {
            let planet = initialize_planet_with_defaults(
                location,
                perlin,
                false, // is_home_planet
                self.context.timestamp(),
                self.msg_sender().unwrap(),
                planet_owner_state.level,
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

            let (meta, owner, caps, resources, mods) = planet.to_meta_owner_caps_resources_mods();
            
            let planet_meta_storage_address = self.internal.get_planet_meta_storage_address();
            let planet_meta_storage = PlanetMetaStorage::at(planet_meta_storage_address);   
            self.call(planet_meta_storage.set(location, meta));
            let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
            let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
            self.call(planet_owner_storage.set(location, owner));
            let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
            let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
            self.call(planet_caps_storage.set(location, caps));
            let planet_resources_storage_address = self.internal.get_planet_resources_storage_address();
            let planet_resources_storage = PlanetResourcesStorage::at(planet_resources_storage_address);
            self.call(planet_resources_storage.set(location, resources));
            let planet_mods_storage_address = self.internal.get_planet_mods_storage_address();
            let planet_mods_storage = PlanetModsStorage::at(planet_mods_storage_address);
            self.call(planet_mods_storage.set(location, mods));
        }

        let check_timestamp = true;

        if check_timestamp {

            let player_storage_address = self.internal.get_player_storage_address();
            let player_storage = PlayerStorage::at(player_storage_address);
            let mut player_state: Player = self.view(player_storage.get(self.msg_sender().unwrap()));
            assert(player_state.is_initialized, "Player is not initialized");

            let timestamp = self.context.timestamp();
            assert(player_state.last_reveal_timestamp + world_config.location_reveal_cooldown_s < timestamp, "Wait for cooldown before revealing again");
            player_state.last_reveal_timestamp = time;

            self.call(player_storage.set(self.msg_sender().unwrap(), player_state));

            let planet_coords_storage_address = self.internal.get_planet_coords_storage_address();
            let planet_coords_storage = PlanetCoordsStorage::at(planet_coords_storage_address);

            let planet_coords_is_initialized: bool = self.view(planet_coords_storage.is_initialized(location));
            assert(!planet_coords_is_initialized, "Location already revealed");
            
            let new_planet_coords = RevealedCoords {
                location_id: location,
                x: x,
                y: y,
                revealer: self.msg_sender().unwrap(),
            };
            self.call(planet_coords_storage.set(location, new_planet_coords));
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
        provided_snark_constants: SnarkConstants,
        planet_owner_state: PlanetOwner,
        player_state: Player,
       global_state: GlobalState,
    ) {
        if !provided_snark_constants.disable_zk_checks {
            //todo: implement zk checks
        }

        self.enqueue_self.initialize_player_public(
            x,
            y,
            radius,
            location_id,
            perlin,
            disable_zk_checks,
            planet_hash_key,
            space_type_key,
            scale,
            x_mirror,
            y_mirror,
            planet_owner_state,
            player_state,
            global_state,
        );
    }     

    #[external("public")] 
    fn initialize_player_public(
       location_id: Field,
       perlin: u8,
       radius: u128,
       provided_snark_constants: SnarkConstants,
       planet_owner_state: PlanetOwner,
       player_state: Player,
       global_state: GlobalState,
    ) {
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let snark_constants = self.view(config.get_snark_constants_public());
        assert(provided_snark_constants.disable_zk_checks == snark_constants.disable_zk_checks, "Disable zk checks is not valid");
  
        let _ = revert_if_bad_snark_perlin_flags(provided_snark, false, snark_constants);

        let planet_default_stats = self.view(config.get_planet_default_stats_public(planet_owner_state.level));

        let world_config = self.view(config.get_world_config_public());
        let game_config_core = self.view(config.get_game_config_core_public());
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds_public());
        let space_junk_config = self.view(config.get_space_junk_config_public());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier_public(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier_public(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier_public(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier_public(3));

        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        let planet_owner_is_valid = self.view(planet_owner_storage.verify(location_id, planet_owner_state));        
        assert(planet_owner_is_valid, "Planet owner is not valid");

        assert(!planet_owner_state.is_initialized, "Planet owner is initialized");

        let planet = initialize_planet_with_defaults(
            location_id,
            perlin,
            true, // is_home_planet
            self.context.timestamp(),
            self.msg_sender().unwrap(),
            planet_owner_state.level,
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

        let (meta, owner, caps, resources, mods) = planet.to_meta_owner_caps_resources_mods();

        let planet_meta_storage_address = self.internal.get_planet_meta_storage_address();
        let planet_meta_storage = PlanetMetaStorage::at(planet_meta_storage_address);
        self.call(planet_meta_storage.set(location_id, meta));

        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        self.call(planet_owner_storage.set(location_id, owner));

        let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
        let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
        self.call(planet_caps_storage.set(location_id, caps));

        let planet_resources_storage_address =
            self.internal.get_planet_resources_storage_address();
        let planet_resources_storage =
            PlanetResourcesStorage::at(planet_resources_storage_address);
        self.call(planet_resources_storage.set(location_id, resources));

        let planet_mods_storage_address = self.internal.get_planet_mods_storage_address();
        let planet_mods_storage = PlanetModsStorage::at(planet_mods_storage_address);
        self.call(planet_mods_storage.set(location_id, mods));


        let global_state_storage_address = self.internal.get_global_state_storage_address();
        let global_state_storage = GlobalStateStorage::at(global_state_storage_address);
        let global_state_is_valid = self.view(global_state_storage.verify(global_state));
        assert(global_state_is_valid, "Global state is not valid");

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);
        let player_state_is_valid = self.view(player_storage.verify(self.msg_sender().unwrap(), player_state));
        assert(player_state_is_valid, "Player state is not valid");
        
        // check player state

        let check_player_init_result = check_player_init(
            location_id,
            perlin,
            radius,
            self.msg_sender().unwrap(),
            player_state,
            global_state,
            game_config_core,
            world_config,
        );

        assert(check_player_init_result, "Player init is not valid");

        let player: Player = Player {
            is_initialized: true,
            player: self.msg_sender().unwrap(),
            init_timestamp: self.context.timestamp(),
            home_planet_id: location_id,
            last_reveal_timestamp: 0,
            score: 0,
            space_junk: 0,
            space_junk_limit: space_junk_config.space_junk_limit,
            claimed_ships: false,
        };

        self.call(player_storage.set(self.msg_sender().unwrap(), player));

        let new_global_state = update_world_radius(global_state, world_config);
        self.call(global_state_storage.set(new_global_state));
    }


}