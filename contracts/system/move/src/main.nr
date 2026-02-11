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

    use dep::libs::game_utils::{
        _buff_planet, _debuff_planet, _take_artifact_off_planet, revert_if_bad_snark_perlin_flags,
        update_world_radius,
    };

    use dep::libs::planet::{check_player_init, initialize_planet_with_defaults, refresh_planet};

    use dep::arrival_storage::ArrivalStorage;
    use dep::artifact_location_storage::ArtifactLocationStorage;
    use dep::artifact_storage::ArtifactStorage;
    use dep::config::Config;
    use dep::planet_artifacts_storage::PlanetArtifactsStorage;
    use dep::planet_events_storage::PlanetEventsStorage;
    use dep::planet_storage::PlanetStorage;
    use dep::player_storage::PlayerStorage;
    use dep::world_storage::WorldStorage;

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
        x1: Field, // private
        y1: Field, // private
        x2: Field, // private
        y2: Field, // private
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        activated_artifact_id: Field,
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
        source_planet_events: PlanetEvents,
        source_arrivals: [Arrival; 20],
        source_artifacts: [Artifact; 20],
        source_artifact_locations: [ArtifactLocation; 20],
        source_planet_artifacts: PlanetArtifacts,
        target_planet: Planet,
        target_planet_events: PlanetEvents,
        target_arrivals: [Arrival; 20],
        target_artifacts: [Artifact; 20],
        target_artifact_locations: [ArtifactLocation; 20],
        target_planet_artifacts: PlanetArtifacts,
        world: World,
        moved_artifact: Artifact,
        moved_artifact_location: ArtifactLocation,
        activated_artifact: Artifact,
    ) {
        if !provided_snark_config.disable_zk_checks {
            // todo: implement zk checks
        }

        let sender = self.msg_sender().unwrap();

        assert(target_radius <= world.radius, "Attempting to move out of bounds");

        // Verify timestamp
        assert(
            timestamp >= source_planet.last_updated,
            "Timestamp must be >= source planet's last_updated",
        );
        assert(
            timestamp >= source_planet_events.last_updated,
            "Timestamp must be >= source planet events' last_updated",
        );
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < source_planet_events.count {
                let arrival = source_arrivals[i];
                assert(
                    timestamp >= arrival.departure_time,
                    "Timestamp must be >= source arrivals' departure_time",
                );
                if arrival.carried_artifact_id != 0 {
                    let artifact = source_artifacts[i];
                    let artifact_location = source_artifact_locations[i];
                    assert(
                        timestamp >= artifact.last_updated,
                        "Timestamp must be >= source arrivals' last_updated",
                    );
                    assert(
                        timestamp >= artifact_location.last_updated,
                        "Timestamp must be >= source artifact locations' last_updated",
                    );
                }
            }
        }
        assert(
            timestamp >= source_planet_artifacts.last_updated,
            "Source planet artifacts state is newer than timestamp",
        );

        assert(
            timestamp >= target_planet.last_updated,
            "Timestamp must be >= target planet's last_updated",
        );
        assert(
            timestamp >= target_planet_events.last_updated,
            "Timestamp must be >= target planet events' last_updated",
        );
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < target_planet_events.count {
                let arrival = target_arrivals[i];
                assert(
                    timestamp >= arrival.departure_time,
                    "Timestamp must be >= target arrivals' departure_time",
                );
                if arrival.carried_artifact_id != 0 {
                    let artifact = target_artifacts[i];
                    let artifact_location = target_artifact_locations[i];
                    assert(
                        timestamp >= artifact.last_updated,
                        "Timestamp must be >= target arrivals' last_updated",
                    );
                    assert(
                        timestamp >= artifact_location.last_updated,
                        "Timestamp must be >= target artifact locations' last_updated",
                    );
                }
            }
        }
        assert(
            timestamp >= target_planet_artifacts.last_updated,
            "Target planet artifacts state is newer than timestamp",
        );

        if moved_artifact_id != 0 {
            assert(
                timestamp > moved_artifact.last_updated,
                "Timestamp must be > moved artifact's last_updated",
            );
            assert(
                timestamp > moved_artifact_location.last_updated,
                "Timestamp must be > moved artifact location's last_updated",
            );
        }

        if activated_artifact_id != 0 {
            assert(
                timestamp > activated_artifact.last_updated,
                "Timestamp must be > activated artifact's last_updated",
            );
        }

        // Compute config hashes for public verification
        let snark_config_hash = poseidon2_hash(provided_snark_config.serialize());
        let planet_default_stats_hash = poseidon2_hash(planet_default_stats.serialize());
        let world_config_hash = poseidon2_hash(world_config.serialize());
        let game_config_core_hash = poseidon2_hash(game_config_core.serialize());
        let planet_level_thresholds_hash = poseidon2_hash(planet_level_thresholds.serialize());
        let space_junk_config_hash = poseidon2_hash(space_junk_config.serialize());
        let planet_type_weights_tier_0_hash =
            poseidon2_hash(planet_type_weights_tier_0.serialize());
        let planet_type_weights_tier_1_hash =
            poseidon2_hash(planet_type_weights_tier_1.serialize());
        let planet_type_weights_tier_2_hash =
            poseidon2_hash(planet_type_weights_tier_2.serialize());
        let planet_type_weights_tier_3_hash =
            poseidon2_hash(planet_type_weights_tier_3.serialize());

        // Compute state hashes for public verification
        let source_planet_hash = if source_planet == Planet::zero() {
            0
        } else {
            poseidon2_hash(source_planet.serialize())
        };

        let source_planet_events_hash = if source_planet_events == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(source_planet_events.serialize())
        };

        let mut source_arrivals_ids: [Field; 20] = [0; 20];
        let mut source_arrivals_hash: [Field; 20] = [0; 20];
        let mut source_artifacts_ids: [Field; 20] = [0; 20];
        let mut source_artifacts_hash: [Field; 20] = [0; 20];
        let mut source_artifact_locations_hash: [Field; 20] = [0; 20];

        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < source_planet_events.count {
                let source_arrival_id = source_planet_events.events[i].id;
                let source_arrival = source_arrivals[i];
                let source_artifact_id = source_arrival.carried_artifact_id;

                source_arrivals_ids[i] = source_arrival_id;
                source_artifacts_ids[i] = source_artifact_id;
                if source_arrival_id != 0 {
                    source_arrivals_hash[i] = poseidon2_hash(source_arrivals[i].serialize());

                    if source_artifact_id != 0 {
                        source_artifacts_hash[i] = poseidon2_hash(source_artifacts[i].serialize());
                        source_artifact_locations_hash[i] =
                            poseidon2_hash(source_artifact_locations[i].serialize());
                    }
                }
            }
        }

        let source_planet_artifacts_hash = if source_planet_artifacts == PlanetArtifacts::zero() {
            0
        } else {
            poseidon2_hash(source_planet_artifacts.serialize())
        };

        let target_planet_hash = if target_planet == Planet::zero() {
            0
        } else {
            poseidon2_hash(target_planet.serialize())
        };

        let target_planet_events_hash = if target_planet_events == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(target_planet_events.serialize())
        };

        let mut target_arrivals_ids: [Field; 20] = [0; 20];
        let mut target_arrivals_hash: [Field; 20] = [0; 20];
        let mut target_artifacts_ids: [Field; 20] = [0; 20];
        let mut target_artifacts_hash: [Field; 20] = [0; 20];
        let mut target_artifact_locations_hash: [Field; 20] = [0; 20];

        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < target_planet_events.count {
                let target_arrival_id = target_planet_events.events[i].id;
                let target_arrival = target_arrivals[i];
                let target_artifact_id = target_arrival.carried_artifact_id;

                target_arrivals_ids[i] = target_arrival_id;
                target_artifacts_ids[i] = target_artifact_id;
                if target_arrival_id != 0 {
                    target_arrivals_hash[i] = poseidon2_hash(target_arrivals[i].serialize());

                    if target_artifact_id != 0 {
                        target_artifacts_hash[i] = poseidon2_hash(target_artifacts[i].serialize());
                        target_artifact_locations_hash[i] =
                            poseidon2_hash(target_artifact_locations[i].serialize());
                    }
                }
            }
        }

        let target_planet_artifacts_hash = if target_planet_artifacts == PlanetArtifacts::zero() {
            0
        } else {
            poseidon2_hash(target_planet_artifacts.serialize())
        };

        let world_hash = if world == World::zero() {
            0
        } else {
            poseidon2_hash(world.serialize())
        };

        let moved_artifact_hash = if moved_artifact == Artifact::zero() {
            0
        } else {
            poseidon2_hash(moved_artifact.serialize())
        };

        let moved_artifact_location_hash = if moved_artifact_location == ArtifactLocation::zero() {
            0
        } else {
            poseidon2_hash(moved_artifact_location.serialize())
        };

        let activated_artifact_hash = if activated_artifact == Artifact::zero() {
            0
        } else {
            poseidon2_hash(activated_artifact.serialize())
        };

        let mut args: DFPMoveArgs = DFPMoveArgs {
            old_loc: source_loc,
            new_loc: target_loc,
            max_dist,
            pop_moved,
            silver_moved,
            moved_artifact_id,
            is_abandoning,
            sender,
        };

        // todo: modify args when moving artifact is spaceship

        // Check if this is a spaceship move
        let is_spaceship_move = if moved_artifact_id != 0 {
            let artifact_type = moved_artifact.artifact_type;
            (artifact_type == ArtifactType::Spaceship())
                | (artifact_type == ArtifactType::ShipMothership())
                | (artifact_type == ArtifactType::ShipCrescent())
                | (artifact_type == ArtifactType::ShipWhale())
                | (artifact_type == ArtifactType::ShipGear())
                | (artifact_type == ArtifactType::ShipTitan())
        } else {
            false
        };

        if is_spaceship_move {
            args.sender = AztecAddress::zero();
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

        let mut new_source_planet = new_source_states.0;
        let mut new_source_planet_events = new_source_states.1;
        let mut new_source_planet_artifacts = new_source_states.2;
        let mut new_source_artifact_locations = new_source_states.3;

        new_source_planet.last_updated = timestamp;
        new_source_planet_events.last_updated = timestamp;
        new_source_planet_artifacts.last_updated = timestamp;

        // Update artifact_locations for arrivals (input count, not output artifacts count)
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < source_planet_events.count {
                new_source_artifact_locations[i].last_updated = timestamp;
            }
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
            // Update artifact_locations for arrivals (input count, not output artifacts count)
            // Use fixed array size 20 as compile-time constant for loop bound
            for i in 0..20 {
                if i < target_planet_events.count {
                    new_target_artifact_locations[i].last_updated = timestamp;
                }
            }

            // checkPlanetDOS - Rate limiting check for planet arrivals
            let mut arrivals_from_owner: u8 = 0;
            let mut arrivals_from_others: u8 = 0;

            // Count arrivals from owner vs others
            // Use fixed array size 20 as compile-time constant for loop bound
            for i in 0..20 {
                if i < new_target_planet_events.count {
                    let arrival = target_arrivals[i];

                    if arrival.player == new_target_planet.owner {
                        arrivals_from_owner += 1;
                    } else {
                        arrivals_from_others += 1;
                    }
                }
            }

            // Apply rate limits based on sender
            if sender == new_target_planet.owner {
                assert(arrivals_from_owner < 10, "Planet is rate-limited");
            } else {
                assert(arrivals_from_others < 10, "Planet is rate-limited");
            }

            // Apply total arrivals limit
            assert((arrivals_from_owner + arrivals_from_others) < 20, "Planet is rate-limited");
        } else {
            new_target_planet = initialize_planet_with_defaults(
                target_loc,
                target_perlin,
                false,
                timestamp,
                sender,
                target_level,
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

            new_target_planet.last_updated = timestamp;
            new_target_planet_events.last_updated = timestamp;
            new_target_planet_artifacts.last_updated = timestamp;
            // For newly initialized planet, artifact_locations count should be 0
            // Use fixed array size 20 as compile-time constant for loop bound
            for i in 0..20 {
                if i < new_target_planet_artifacts.count {
                    new_target_artifact_locations[i].last_updated = timestamp;
                }
            }
        }

        let mut new_world = world;
        new_world.planet_events_count += 1;

        // Check move validity
        if is_spaceship_move {
            assert(pop_moved == 0, "ship moves must move 0 energy");
            assert(silver_moved == 0, "ship moves must move 0 silver");
            assert(moved_artifact.controller == sender, "you can only move your own ships");
        } else {
            // we want strict > so that the population can't go to 0
            assert(
                new_source_planet.population > pop_moved,
                "Tried to move more population that what exists",
            );
            assert(
                !new_target_planet.destroyed & !new_source_planet.destroyed,
                "planet is destroyed",
            );
            assert(
                new_source_planet.owner == sender,
                "Only owner account can perform that operation on planet.",
            );
        }

        assert(
            new_source_planet.silver >= silver_moved,
            "Tried to move more silver than what exists",
        );

        if moved_artifact_id != 0 {
            assert(new_target_planet_artifacts.count < 5, "too many artifacts on this planet");
        }

        let effectiveDistTimesHundred = args.max_dist * 100;
        let arrival_type = ArrivalType::Normal();
        let mut temporary_upgrade = Upgrade::zero();
        let mut dist_modifier = 1;
        let mut wormhole_present = false;
        let mut photoid_present = false;
        let mut new_temp_upgrade = Upgrade::zero();

        // todo: handle with _checkWormhole and _checkPhotoid

        // todo: _removeSpaceshipEffectsFromOriginPlanet

        let pop_moved = args.pop_moved;
        let silver_moved = args.silver_moved;
        let remaining_origin_planet_population = new_source_planet.population - pop_moved;

        // todo: think about SPACE_JUNK_ENABLED and is_spaceship_move

        let buff_planet_result = _buff_planet(args.old_loc, new_source_planet, temporary_upgrade);
        new_source_planet = buff_planet_result.1;

        let mut travel_time: u64 = (effectiveDistTimesHundred / new_source_planet.speed) as u64;
        if travel_time == 0 {
            travel_time = 1;
        }

        // All checks pass. Execute move
        // Push the new event into the planetEvents array for target location
        assert(new_target_planet_events.count < 20, "Too many events on target planet");

        new_target_planet_events.events[new_target_planet_events.count] = PlanetEventMetadata {
            id: new_world.planet_events_count,
            // event_type: PlanetEventType::Arrival(),
            // time_trigger: timestamp + travel_time,
            // time_created: timestamp,
        };
        new_target_planet_events.count += 1;

        // _createArrival - Enter the arrival data for event id

        // Calculate decayed population that will arrive
        // Linear decay based on distance/range ratio
        // When distance = range and popMoved = populationCap, arrival = 0
        let pop_arriving = if is_spaceship_move {
            0 // Spaceship moves are 0-energy moves
        } else {
            let range_times_hundred = new_source_planet.range * 100;

            // Calculate linear decay: remaining = popMoved * (1 - distance/range)
            // Using fixed-point math to avoid division loss
            let distance_ratio = if effectiveDistTimesHundred >= range_times_hundred {
                100 // Distance >= range, 100% decay (0% remaining)
            } else {
                // distance_ratio = (distance * 100) / range (percentage)
                (effectiveDistTimesHundred * 100) / range_times_hundred
            };

            let remaining_ratio = 100 - distance_ratio; // percentage remaining (0-100)
            let pop_after_distance_decay = (pop_moved * remaining_ratio) / 100;

            // Apply big planet debuff (5% of target planet's population cap)
            let big_planet_debuff = new_source_planet.population_cap / 20;

            if pop_after_distance_decay > big_planet_debuff {
                pop_after_distance_decay - big_planet_debuff
            } else {
                0 // Not enough forces after decay and debuff
            }
        };

        // Spaceship moves must be 0 energy moves
        assert(pop_arriving > 0 | is_spaceship_move, "Not enough forces to make move");
        assert(!is_spaceship_move | (pop_moved == 0), "spaceship moves must be 0 energy moves");

        // Create the new arrival
        let new_arrival = Arrival {
            id: new_world.planet_events_count,
            player: sender,
            from_planet: source_loc,
            to_planet: target_loc,
            pop_arriving,
            silver_moved,
            departure_time: timestamp,
            arrival_time: timestamp + travel_time,
            arrival_type,
            carried_artifact_id: moved_artifact_id,
            distance: args.max_dist,
        };

        let mut new_moved_artifact_location = moved_artifact_location;

        // Handle artifact movement
        if moved_artifact_id != 0 {
            // Take artifact off the source planet
            let take_artifact_result = _take_artifact_off_planet(
                moved_artifact_id,
                moved_artifact_location,
                moved_artifact,
                source_loc,
                new_source_planet_artifacts,
            );

            // Unpack the results
            new_moved_artifact_location = take_artifact_result.1;
            new_source_planet_artifacts = take_artifact_result.3;

            // Update artifact location to indicate it's in transit
            new_moved_artifact_location.voyage_id = new_arrival.id;
            new_moved_artifact_location.last_updated = timestamp;

            // TODO: Store new_moved_artifact_location and new_source_planet_artifacts to storage in public function
        }

        let debuff_planet_result =
            _debuff_planet(args.old_loc, new_source_planet, temporary_upgrade);
        new_source_planet = debuff_planet_result.1;

        new_source_planet.silver -= silver_moved;
        new_source_planet.population = remaining_origin_planet_population;

        new_world = update_world_radius(new_world, world_config);

        // Pass hashes and computed results to public for verification and storage
        self.enqueue_self.move_public(
            source_loc,
            target_loc,
            target_level,
            moved_artifact_id,
            activated_artifact_id,
            timestamp,
            snark_config_hash,
            planet_default_stats_hash,
            world_config_hash,
            game_config_core_hash,
            planet_level_thresholds_hash,
            space_junk_config_hash,
            planet_type_weights_tier_0_hash,
            planet_type_weights_tier_1_hash,
            planet_type_weights_tier_2_hash,
            planet_type_weights_tier_3_hash,
            source_planet_hash,
            source_planet_events_hash,
            source_arrivals_ids,
            source_arrivals_hash,
            source_artifacts_ids,
            source_artifacts_hash,
            source_artifact_locations_hash,
            source_planet_artifacts_hash,
            target_planet_hash,
            target_planet_events_hash,
            target_arrivals_ids,
            target_arrivals_hash,
            target_artifacts_ids,
            target_artifacts_hash,
            target_artifact_locations_hash,
            target_planet_artifacts_hash,
            world_hash,
            moved_artifact_hash,
            moved_artifact_location_hash,
            activated_artifact_hash,
            new_source_planet,
            new_source_planet_events,
            new_source_planet_artifacts,
            new_source_artifact_locations,
            new_target_planet,
            new_target_planet_events,
            new_target_planet_artifacts,
            new_target_artifact_locations,
            new_world,
            new_arrival,
            new_moved_artifact_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn move_public(
        // Basic move parameters
        source_loc: Field,
        target_loc: Field,
        target_level: u8,
        moved_artifact_id: Field,
        activated_artifact_id: Field,
        timestamp: u64,
        // Config hashes from private function
        snark_config_hash: Field,
        planet_default_stats_hash: Field,
        world_config_hash: Field,
        game_config_core_hash: Field,
        planet_level_thresholds_hash: Field,
        space_junk_config_hash: Field,
        planet_type_weights_tier_0_hash: Field,
        planet_type_weights_tier_1_hash: Field,
        planet_type_weights_tier_2_hash: Field,
        planet_type_weights_tier_3_hash: Field,
        // State hashes from private function for verification
        source_planet_hash: Field,
        source_planet_events_hash: Field,
        source_arrivals_ids: [Field; 20],
        source_arrivals_hash: [Field; 20],
        source_artifacts_ids: [Field; 20],
        source_artifacts_hash: [Field; 20],
        source_artifact_locations_hash: [Field; 20],
        source_planet_artifacts_hash: Field,
        target_planet_hash: Field,
        target_planet_events_hash: Field,
        target_arrivals_ids: [Field; 20],
        target_arrivals_hash: [Field; 20],
        target_artifacts_ids: [Field; 20],
        target_artifacts_hash: [Field; 20],
        target_artifact_locations_hash: [Field; 20],
        target_planet_artifacts_hash: Field,
        world_hash: Field,
        moved_artifact_hash: Field,
        moved_artifact_location_hash: Field,
        activated_artifact_hash: Field,
        // New states to write (computed in private function)
        new_source_planet: Planet,
        new_source_planet_events: PlanetEvents,
        new_source_planet_artifacts: PlanetArtifacts,
        new_source_artifact_locations: [ArtifactLocation; 20],
        new_target_planet: Planet,
        new_target_planet_events: PlanetEvents,
        new_target_planet_artifacts: PlanetArtifacts,
        new_target_artifact_locations: [ArtifactLocation; 20],
        new_world: World,
        new_arrival: Arrival,
        new_moved_artifact_location: ArtifactLocation,
    ) {
        // Verify timstamp
        let actual_timestamp = self.context.timestamp();
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");

        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        // Verify all config hashes match on-chain state
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);

        assert(
            self.view(config.verify_snark_config_hash(snark_config_hash)),
            "Snark config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_default_stats_hash(
                target_level,
                planet_default_stats_hash,
            )),
            "Planet default stats hash mismatch",
        );
        assert(
            self.view(config.verify_world_config_hash(world_config_hash)),
            "World config hash mismatch",
        );
        assert(
            self.view(config.verify_game_config_core_hash(game_config_core_hash)),
            "Game config core hash mismatch",
        );
        assert(
            self.view(config.verify_planet_level_thresholds_hash(planet_level_thresholds_hash)),
            "Planet level thresholds hash mismatch",
        );
        assert(
            self.view(config.verify_space_junk_config_hash(space_junk_config_hash)),
            "Space junk config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                0,
                planet_type_weights_tier_0_hash,
            )),
            "Planet type weights tier 0 hash mismatch",
        );

        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                1,
                planet_type_weights_tier_1_hash,
            )),
            "Planet type weights tier 1 hash mismatch",
        );

        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                2,
                planet_type_weights_tier_2_hash,
            )),
            "Planet type weights tier 2 hash mismatch",
        );

        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                3,
                planet_type_weights_tier_3_hash,
            )),
            "Planet type weights tier 3 hash mismatch",
        );

        // Get storage contract addresses
        let world_storage_address = self.internal.get_world_storage_address();
        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_events_storage_address = self.internal.get_planet_events_storage_address();
        let planet_artifacts_storage_address = self.internal.get_planet_artifacts_storage_address();
        let arrivals_storage_address = self.internal.get_arrivals_storage_address();
        let artifact_location_storage_address =
            self.internal.get_artifact_location_storage_address();
        let artifact_storage_address = self.internal.get_artifact_storage_address();

        let world_storage = WorldStorage::at(world_storage_address);
        let planet_storage = PlanetStorage::at(planet_storage_address);
        let planet_events_storage = PlanetEventsStorage::at(planet_events_storage_address);
        let planet_artifacts_storage = PlanetArtifactsStorage::at(planet_artifacts_storage_address);
        let arrivals_storage = ArrivalStorage::at(arrivals_storage_address);
        let artifact_location_storage =
            ArtifactLocationStorage::at(artifact_location_storage_address);
        let artifact_storage = ArtifactStorage::at(artifact_storage_address);

        // Verify source planet state hashes

        assert(
            self.view(planet_storage.verify_hash(source_loc, source_planet_hash)),
            "Source planet hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(source_loc, source_planet_events_hash)),
            "Source planet events hash mismatch",
        );

        for i in 0..20 {
            let arrival_id = source_arrivals_ids[i];
            let arrival_hash = source_arrivals_hash[i];
            assert(
                self.view(arrivals_storage.verify_hash(arrival_id, arrival_hash)),
                "Source arrival hash mismatch",
            );

            let artifact_id = source_artifacts_ids[i];
            let artifact_hash = source_artifacts_hash[i];
            let artifact_location_hash = source_artifact_locations_hash[i];
            assert(
                self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
                "Source artifact hash mismatch",
            );
            assert(
                self.view(artifact_location_storage.verify_hash(artifact_id, artifact_location_hash)),
                "Source artifact location hash mismatch",
            );
        }
        assert(
            self.view(planet_artifacts_storage.verify_hash(source_loc, source_planet_artifacts_hash)),
            "Source planet artifacts hash mismatch",
        );

        assert(
            self.view(planet_storage.verify_hash(target_loc, target_planet_hash)),
            "Target planet hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(target_loc, target_planet_events_hash)),
            "Target planet events hash mismatch",
        );
        for i in 0..20 {
            let arrival_id = target_arrivals_ids[i];
            let arrival_hash = target_arrivals_hash[i];
            assert(
                self.view(arrivals_storage.verify_hash(arrival_id, arrival_hash)),
                "Target arrival hash mismatch",
            );

            let artifact_id = target_artifacts_ids[i];
            let artifact_hash = target_artifacts_hash[i];
            let artifact_location_hash = target_artifact_locations_hash[i];
            assert(
                self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
                "Target artifact hash mismatch",
            );
            assert(
                self.view(artifact_location_storage.verify_hash(artifact_id, artifact_location_hash)),
                "Target artifact location hash mismatch",
            );
        }
        assert(
            self.view(planet_artifacts_storage.verify_hash(target_loc, target_planet_artifacts_hash)),
            "Target planet artifacts hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "World hash mismatch");

        assert(
            self.view(artifact_storage.verify_hash(moved_artifact_id, moved_artifact_hash)),
            "Moved artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hash(
                moved_artifact_id,
                moved_artifact_location_hash,
            )),
            "Moved artifact location hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hash(activated_artifact_id, activated_artifact_hash)),
            "Activated artifact hash mismatch",
        );

        // Write new states to storage
        self.call(planet_storage.set(source_loc, new_source_planet));
        self.call(planet_events_storage.set(source_loc, new_source_planet_events));
        self.call(planet_artifacts_storage.set(source_loc, new_source_planet_artifacts));
        // Write artifact_locations for artifacts on source planet
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < new_source_planet_artifacts.count {
                self.call(artifact_location_storage.set(
                    new_source_planet_artifacts.ids[i],
                    new_source_artifact_locations[i],
                ));
            }
        }

        self.call(planet_storage.set(target_loc, new_target_planet));
        self.call(planet_events_storage.set(target_loc, new_target_planet_events));
        self.call(planet_artifacts_storage.set(target_loc, new_target_planet_artifacts));
        // Write artifact_locations for artifacts on target planet
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < new_target_planet_artifacts.count {
                self.call(artifact_location_storage.set(
                    new_target_planet_artifacts.ids[i],
                    new_target_artifact_locations[i],
                ));
            }
        }

        self.call(world_storage.set(0, new_world));

        self.call(arrivals_storage.set(new_arrival.id, new_arrival));
        if moved_artifact_id != 0 {
            self.call(artifact_location_storage.set(moved_artifact_id, new_moved_artifact_location));
        }
    }
}
