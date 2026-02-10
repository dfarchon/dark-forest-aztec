use dep::aztec::macros::aztec;

#[aztec]
contract move {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, only_self, view},
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

    use dep::libs::game_utils::{revert_if_bad_snark_perlin_flags, update_world_radius};

    use dep::libs::planet::{check_player_init, initialize_planet_with_defaults, refresh_planet};

    use dep::arrival_storage::ArrivalStorage;
    use dep::artifact_state_storage::ArtifactStateStorage;
    use dep::config::Config;
    use dep::global_state_storage::GlobalStateStorage;
    use dep::planet_artifacts_storage::PlanetArtifactsStorage;
    use dep::planet_caps_storage::PlanetCapsStorage;
    use dep::planet_coords_storage::PlanetCoordsStorage;
    use dep::planet_events_storage::PlanetEventsStorage;
    use dep::planet_meta_storage::PlanetMetaStorage;
    use dep::planet_mods_storage::PlanetModsStorage;
    use dep::planet_owner_storage::PlanetOwnerStorage;
    use dep::planet_resources_storage::PlanetResourcesStorage;
    use dep::player_storage::PlayerStorage;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        config_storage_address: PublicMutable<AztecAddress, Context>,
        global_state_storage_address: PublicMutable<AztecAddress, Context>,
        player_storage_address: PublicMutable<AztecAddress, Context>,
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
    fn get_config_storage_address() -> AztecAddress {
        self.storage.config_storage_address.read()
    }

    #[internal("public")]
    fn get_player_storage_address() -> AztecAddress {
        self.storage.player_storage_address.read()
    }

    #[internal("public")]
    fn get_global_state_storage_address() -> AztecAddress {
        self.storage.global_state_storage_address.read()
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
    fn set_config_storage_address(config_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_storage_address);
    }

    #[external("public")]
    fn set_global_state_storage_address(global_state_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.global_state_storage_address.write(global_state_storage_address);
    }

    #[external("public")]
    fn set_player_storage_address(player_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.player_storage_address.write(player_storage_address);
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
        arrivals: [Arrival; 12],
        artifacts_state: [ArtifactState; 12],
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

        let planet_meta_is_valid: bool =
            self.view(planet_meta_storage.verify(location, planet_meta_state));
        let planet_owner_is_valid: bool =
            self.view(planet_owner_storage.verify(location, planet_owner_state));
        let planet_caps_is_valid: bool =
            self.view(planet_caps_storage.verify(location, planet_caps_state));
        let planet_resources_is_valid: bool =
            self.view(planet_resources_storage.verify(location, planet_resources_state));
        let planet_mods_is_valid: bool =
            self.view(planet_mods_storage.verify(location, planet_mods_state));
        let planet_events_is_valid: bool =
            self.view(planet_events_storage.verify(location, planet_events_state));
        let planet_artifacts_is_valid: bool =
            self.view(planet_artifacts_storage.verify(location, planet_artifacts_state));

        assert(planet_meta_is_valid, "Planet meta is not valid");
        assert(planet_owner_is_valid, "Planet owner is not valid");
        assert(planet_caps_is_valid, "Planet caps is not valid");
        assert(planet_resources_is_valid, "Planet resources is not valid");
        assert(planet_mods_is_valid, "Planet mods is not valid");
        assert(planet_events_is_valid, "Planet events is not valid");
        assert(planet_artifacts_is_valid, "Planet artifacts is not valid");

        let arrivals_storage_address = self.internal.get_arrivals_storage_address();
        let artifacts_storage_address = self.internal.get_artifacts_storage_address();

        let arrival_storage = ArrivalStorage::at(arrivals_storage_address);
        let artifacts_storage = ArtifactStateStorage::at(artifacts_storage_address);

        let cnt = planet_events_state.events_count;

        for i in 0..cnt {
            let event = planet_events_state.events[i];
            let arrival = arrivals[i];
            let artifact = artifacts_state[i].artifact;
            assert(event.id == arrival.id, "Event id does not match arrival id");
            assert(
                artifact.id == arrival.carried_artifact_id,
                "Artifact id does not match arrival carried artifact id",
            );

            let arrival_is_valid: bool = self.view(arrival_storage.verify(arrival.id, arrival));
            assert(arrival_is_valid, "Arrival is not valid");
            let artifact_is_valid: bool =
                self.view(artifacts_storage.verify(artifact.id, artifacts_state[i]));
            assert(artifact_is_valid, "Artifact is not valid");
        }

        let planet: Planet = Planet::from_parts(
            planet_meta_state,
            planet_owner_state,
            planet_caps_state,
            planet_resources_state,
            planet_mods_state,
        );

        let res = refresh_planet(
            self.context.timestamp(),
            location,
            planet,
            planet_events_state,
            arrivals,
            artifacts_state,
            planet_artifacts_state,
        );

        let mut new_planet = res.0;
        let (meta, owner, caps, resources, mods) = new_planet.to_meta_owner_caps_resources_mods();
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
            if artifacts_state[i] != new_artifacts_state[i] {
                self.call(artifacts_storage.set(
                    artifacts_state[i].artifact.id,
                    new_artifacts_state[i],
                ));
            }
        }
    }


   #[external("private")]
    fn move(
        old_loc: Field,
        new_loc: Field,
        new_perlin: u8,
        new_level: u8,
        new_radius: u128,
        max_dist: u128,
        x1: Field,
        y1: Field,
        x2: Field,
        y2: Field,
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        is_abandoning: u128,
        provided_snark_constants: SnarkConstants,  
        global_state: GlobalState,
        source_planet_meta_state: PlanetMeta,
        source_planet_owner_state: PlanetOwner,
        source_planet_caps_state: PlanetCaps,
        source_planet_resources_state: PlanetResources,
        source_planet_mods_state: PlanetMods,
        source_planet_events_state: PlanetEvents,
        source_arrivals: [Arrival; 12],
        source_artifacts_state: [ArtifactState; 12],
        source_planet_artifacts_state: PlanetArtifacts,
        target_planet_meta_state: PlanetMeta,
        target_planet_owner_state: PlanetOwner,
        target_planet_caps_state: PlanetCaps,
        target_planet_resources_state: PlanetResources,
        target_planet_mods_state: PlanetMods,
        target_planet_events_state: PlanetEvents,
        target_arrivals: [Arrival; 12],
        target_artifacts_state: [ArtifactState; 12],
        target_planet_artifacts_state: PlanetArtifacts,
    ) {
        if !provided_snark_constants.disable_zk_checks {
            //todo: implement zk checks
        }
        let sender = self.msg_sender().unwrap();

        self.enqueue_self.move_public(
            sender,
            old_loc,
            new_loc,
            new_perlin,
            new_level,
            new_radius,
            max_dist,
            global_state,
            source_planet_meta_state,
            source_planet_owner_state,
            source_planet_caps_state,
            source_planet_resources_state,
            source_planet_mods_state,
            source_planet_events_state,
            source_arrivals,
            source_artifacts_state,
            source_planet_artifacts_state,
            target_planet_meta_state,
            target_planet_owner_state,
            target_planet_caps_state,
            target_planet_resources_state,
            target_planet_mods_state,
            target_planet_events_state,
            target_arrivals,
            target_artifacts_state,
            target_planet_artifacts_state,
        );

    }

    #[external("public")]
    fn move_public(
        sender: AztecAddress,
        old_loc: Field,
        new_loc: Field,
        new_perlin: u8,
        new_level: u8,
        new_radius: u128,
        max_dist: u128,
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        is_abandoning: u128,
        provided_snark_constants: SnarkConstants,
        global_state: GlobalState,
        source_planet_meta_state: PlanetMeta,
        source_planet_owner_state: PlanetOwner,
        source_planet_caps_state: PlanetCaps,
        source_planet_resources_state: PlanetResources,
        source_planet_mods_state: PlanetMods,
        source_planet_events_state: PlanetEvents,
        source_arrivals: [Arrival; 12],
        source_artifacts_state: [ArtifactState; 12],
        source_planet_artifacts_state: PlanetArtifacts,
        target_planet_meta_state: PlanetMeta,
        target_planet_owner_state: PlanetOwner,
        target_planet_caps_state: PlanetCaps,
        target_planet_resources_state: PlanetResources,
        target_planet_mods_state: PlanetMods,
        target_planet_events_state: PlanetEvents,
        target_arrivals: [Arrival; 12],
        target_artifacts_state: [ArtifactState; 12],
        target_planet_artifacts_state: PlanetArtifacts,
    ){
        let global_state_storage_address = self.internal.get_global_state_storage_address();
        let global_state_storage = GlobalStateStorage::at(global_state_storage_address);
        let global_state_is_valid: bool = self.view(global_state_storage.verify(global_state));
        assert(global_state_is_valid, "Global state is not valid");

        assert(!global_state.paused, "World is paused");

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let snark_constants = self.view(config.get_snark_constants_public());

        assert(
            provided_snark_constants.disable_zk_checks == snark_constants.disable_zk_checks,
            "Disable zk checks is not valid",
        );

        let _ = revert_if_bad_snark_perlin_flags(provided_snark_constants, false, snark_constants);

        let world_radius = global_state.world_radius;
        assert(new_radius <= world_radius, "Attempting to move out of bounds");
        


    }

}
