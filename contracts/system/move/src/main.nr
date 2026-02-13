use dep::aztec::macros::aztec;

#[aztec]
contract Move {
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
    use dep::planet_events_storage::PlanetEventsStorage;
    use dep::player_storage::PlayerStorage;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        config_storage_address: PublicMutable<AztecAddress, Context>,
        world_storage_address: PublicMutable<AztecAddress, Context>,
        player_storage_address: PublicMutable<AztecAddress, Context>,
        planet_storage_address: PublicMutable<AztecAddress, Context>,
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
    
    
    #[external("private")]
    fn move(
        source_loc: Field,
        target_loc: Field,
        target_perlin: u8,
        target_level: u8,
        target_radius: u128,
        max_dist: u128, 
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        is_abandoning: bool,
        timestamp: u64,
        // Config inputs (to be validated via hash in public)
        provided_snark_config: SnarkConfig,
        planet_default_stats: PlanetDefaultStats,
        world_config: WorldConfig,
        game_config_core: GameConfigCore,
        planet_level_thresholds: PlanetLevelThresholds,
        space_junk_config: SpaceJunkConfig,
        planet_type_weights_tier_0: PlanetTypeWeightsTier,
        planet_type_weights_tier_1: PlanetTypeWeightsTier,
        planet_type_weights_tier_2: PlanetTypeWeightsTier,
        planet_type_weights_tier_3: PlanetTypeWeightsTier,
        // State inputs (to be validated via hash in public)
        source_planet: Planet,
        source_planet_events:  PlanetEvents,
        source_arrivals: [Arrival; 20],
        source_artifacts: [Artifact; 20],
        source_artifact_locations: [ArtifactLocation; 20],
        source_planet_artifacts: PLanetArtifacts,
        target_planet: Planet,
        target_planet_events:  PlanetEvents,
        target_arrivals: [Arrival; 20],
        target_artifacts: [Artifact; 20],
        target_artifact_locations: [ArtifactLocation; 20],
        target_planet_artifacts: PlanetArtifacts,
    ){
        if !provided_snark_config.disable_zk_checks {
            // todo: implement zk checks
        }

        let sender = self.msg_sender().unwrap();
            
        // Verify timestamp
        assert(timestamp >= source_planet.last_updated, "Timestamp must be >= source planet's last_updated");
        assert(timestamp >= source_planet_events.last_updated, "Timestamp must be >= source planet events' last_updated");
        for i in 0..source_planet_events.count {
            let arrival = source_arrivals[i];
            assert(timestamp >= arrival.departure_time, "Timestamp must be >= source arrivals' departure_time");
            if arrival.carried_artifact_id != 0 {
                let artifact = source_artifacts[i];
                let artifact_location = source_artifact_locations[i];
                assert(timestamp >= artifact.last_updated, "Timestamp must be >= source arrivals' last_updated");
                assert(timestamp >= artifact_location.last_updated, "Timestamp must be >= source artifact locations' last_updated");
            }
        }
        assert(timestamp >= source_planet_artifacts.last_updated, "Source planet artifacts state is newer than timestamp");

        assert(timestamp >= target_planet.last_updated, "Timestamp must be >= target planet's last_updated");
        assert(timestamp >= target_planet_events.last_updated, "Timestamp must be >= target planet events' last_updated");
        for i in 0..target_planet_events.count {
            let arrival = target_arrivals[i];
            assert(timestamp >= arrival.departure_time, "Timestamp must be >= target arrivals' departure_time");
            if arrival.carried_artifact_id != 0 {
                let artifact = target_artifacts[i];
                let artifact_location = target_artifact_locations[i];
                assert(timestamp >= artifact.last_updated, "Timestamp must be >= target arrivals' last_updated");
                assert(timestamp >= artifact_location.last_updated, "Timestamp must be >= target artifact locations' last_updated");
            }
        }
        assert(timestamp >= target_planet_artifacts.last_updated, "Target planet artifacts state is newer than timestamp");

        // Compute config hashes for public verification
        let snark_config_hash = poseidon2_hash(provided_snark_config.serialize());
        let planet_default_stats_hash = poseidon2_hash(planet_default_stats.serialize());
        let world_config_hash = poseidon2_hash(world_config.serialize());
        let game_config_core_hash = poseidon2_hash(game_config_core.serialize());
        let planet_level_thresholds_hash = poseidon2_hash(planet_level_thresholds.serialize());
        let space_junk_config_hash = poseidon2_hash(space_junk_config.serialize());
        let planet_type_weights_tier_0_hash = poseidon2_hash(planet_type_weights_tier_0.serialize());
        let planet_type_weights_tier_1_hash = poseidon2_hash(planet_type_weights_tier_1.serialize());
        let planet_type_weights_tier_2_hash = poseidon2_hash(planet_type_weights_tier_2.serialize());
        let planet_type_weights_tier_3_hash = poseidon2_hash(planet_type_weights_tier_3.serialize());
        

        // Compute state hashes for public verification
        let source_planet_hash = if planet_state == Planet::zero() {
            0
        } else {
            poseidon2_hash(source_planet.serialize())
        };

        let source_planet_events_hash = if source_planet_events == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(source_planet_events.serialize())
        };

        let source_arrivals_ids: [Fields; 20] = [0; 20];
        let source_arrivals_hash: [Fields; 20] = [0; 20];
        let source_artifacts_ids: [Fields; 20] = [0; 20];
        let source_artifacts_hash: [Fields; 20] = [0; 20];
        let source_artifact_locations_hash: [Fields; 20] = [0; 20];

        for i in 0..source_planet_events.count {
            let source_arrival_id = source_arrivals[i].id;
            let source_artifact_id = source_artifacts[i].id;
            source_arrivals_ids[i] = source_arrival_id;
            source_artifacts_ids[i] = source_artifact_id;
            if source_arrival_id != 0 {
                source_arrivals_hash[i] = poseidon2_hash(source_arrivals[i].serialize());

                if source_artifact_id != 0 {
                    source_artifacts_hash[i] = poseidon2_hash(source_artifacts[i].serialize());
                    source_artifact_locations_hash[i] = poseidon2_hash(source_artifact_locations[i].serialize());
                }
            }
        }

        let target_arrivals_ids: [Fields; 20] = [0; 20];
        let target_arrivals_hash: [Fields; 20] = [0; 20];
        let target_artifacts_ids: [Fields; 20] = [0; 20];
        let target_artifacts_hash: [Fields; 20] = [0; 20];
        let target_artifact_locations_hash: [Fields; 20] = [0; 20];

        for i in 0..target_planet_events.count {
            let target_arrival_id = target_arrivals[i].id;
            let target_artifact_id = target_artifacts[i].id;
            target_arrivals_ids[i] = target_arrival_id;
            target_artifacts_ids[i] = target_artifact_id;
            if target_arrival_id != 0 {
                target_arrivals_hash[i] = poseidon2_hash(target_arrivals[i].serialize());

                if target_artifact_id != 0 {
                    target_artifacts_hash[i] = poseidon2_hash(target_artifacts[i].serialize());
                    target_artifact_locations_hash[i] = poseidon2_hash(target_artifact_locations[i].serialize());
                }
            }
        }

        let source_planet_is_initialized = source_planet != Planet::zero();
        assert(source_planet_is_initialized, "Source planet is not initialized");

        let new_source_states = refresh_planet(
            timestamp,
            source_loc,
            source_planet,
            source_planet_events,
            source_arrivals,
            source_artifacts,
            source_artifact_locations,
            source_planet_artifacts,
        );

        let new_source_planet = new_source_states.0;
        let new_source_planet_events = new_source_states.1;
        let new_source_planet_artifacts = new_source_states.2;
        let new_source_artifact_locations = new_source_states.3;

        new_source_planet.last_updated = timestamp;
        new_source_planet_events.last_updated = timestamp;
        new_source_planet_artifacts.last_updated = timestamp;
        for i in 0..new_source_artifact_locations.count {
            new_source_artifact_locations[i].last_updated = timestamp;
        }

        let target_planet_is_initialized = target_planet != Planet::zero();

        let mut new_target_planet = target_planet;
        let mut new_target_planet_events = target_planet_events;
        let mut new_target_planet_artifacts = target_planet_artifacts;
        let mut new_target_artifact_locations = target_artifact_locations;

        if target_planet_is_initialized {
            let new_target_states = refresh_planet(
                timestamp,
                target_loc,
                target_planet,
                target_planet_events,
                target_arrivals,
                target_artifacts,
                target_artifact_locations,
                target_planet_artifacts,
            );

            new_target_planet = new_target_states.0;
            new_target_planet_events = new_target_states.1;
            new_target_planet_artifacts = new_target_states.2;
            new_target_artifact_locations = new_target_states.3;

            new_target_planet.last_updated = timestamp;
            new_target_planet_events.last_updated = timestamp;
            new_target_planet_artifacts.last_updated = timestamp;
            for i in 0..new_target_artifact_locations.count {
                new_target_artifact_locations[i].last_updated = timestamp;
            }
        }else {
            new_target_planet = initialize_planet_with_defaults(
                target_loc,
                target_perlin,
                false,
                timestamp,
                sender,
                target_level,
            );

            new_target_planet.last_updated = timestamp;
            new_target_planet_events.last_updated = timestamp;
            new_target_planet_artifacts.last_updated = timestamp;
            for i in 0..new_target_artifact_locations.count {
                new_target_artifact_locations[i].last_updated = timestamp;
            }
        }


        //wip: move

    }





    


    
}
