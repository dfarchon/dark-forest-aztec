use ::aztec::macros::aztec;

#[aztec]
contract Move {
    use ::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, only_self, view},
            storage::storage,
        },
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };
    use ::aztec::state_vars::{Map, PublicMutable};

    use ::types::args::{
        AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs,
    };

    use ::types::config::{
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

    use ::types::storage::{
        arrival::{Arrival, ArrivalType},
        artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType},
        planet::{
            Planet, PlanetArtifacts, PlanetEventMetadata, PlanetEvents, PlanetEventType,
            PlanetRevealedCoords, PlanetType, SpaceType, UpgradeBranch,
        },
        player::Player,
        world::World,
    };

    use ::libs::game_utils::{
        _buff_planet, _debuff_planet, _get_upgrade_for_artifact, _take_artifact_off_planet,
        is_activated, is_artifact_on_planet, revert_if_bad_snark_perlin_flags,
    };

    use ::libs::batch_utils::{
        assert_artifact_timestamp_freshness, assert_planet_timestamp_freshness,
        assert_public_timestamp, compute_artifact_and_location_hashes, compute_artifact_hash,
        compute_config_hashes, compute_planet_hashes, compute_world_hash,
    };
    use ::libs::planet::{
        apply_spaceship_depart, check_player_init, initialize_planet_with_defaults,
        refresh_planet_v1, refresh_planet_v2,
    };

    use ::arrival_storage::ArrivalStorage;
    use ::artifact_location_storage::ArtifactLocationStorage;
    use ::artifact_storage::ArtifactStorage;
    use ::config::Config;
    use ::planet_artifacts_storage::PlanetArtifactsStorage;
    use ::planet_events_storage::PlanetEventsStorage;
    use ::planet_storage::PlanetStorage;
    use ::player_storage::PlayerStorage;
    use ::world_storage::WorldStorage;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        // Global
        config_storage_address: PublicMutable<AztecAddress, Context>,
        world_storage_address: PublicMutable<AztecAddress, Context>,
        // Actor
        player_storage_address: PublicMutable<AztecAddress, Context>,
        // Planet and its sub-entities
        planet_storage_address: PublicMutable<AztecAddress, Context>,
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,
        planet_artifacts_storage_address: PublicMutable<AztecAddress, Context>,
        // Voyages between planets
        arrivals_storage_address: PublicMutable<AztecAddress, Context>,
        // Artifacts and their locations
        artifact_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_location_storage_address: PublicMutable<AztecAddress, Context>,
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
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

    /// Batch set all storage addresses in a single transaction.
    #[external("public")]
    fn set_all_storage_addresses(
        config_addr: AztecAddress,
        world_addr: AztecAddress,
        player_addr: AztecAddress,
        planet_addr: AztecAddress,
        planet_events_addr: AztecAddress,
        planet_artifacts_addr: AztecAddress,
        arrivals_addr: AztecAddress,
        artifact_addr: AztecAddress,
        artifact_location_addr: AztecAddress,
    ) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_addr);
        self.storage.world_storage_address.write(world_addr);
        self.storage.player_storage_address.write(player_addr);
        self.storage.planet_storage_address.write(planet_addr);
        self.storage.planet_events_storage_address.write(planet_events_addr);
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_addr);
        self.storage.arrivals_storage_address.write(arrivals_addr);
        self.storage.artifact_storage_address.write(artifact_addr);
        self.storage.artifact_location_storage_address.write(artifact_location_addr);
    }

    #[external("private")]
    fn move(
        // --- Location & target properties ---
        source_loc: Field,
        target_loc: Field,
        target_perlin: u8,
        target_level: u8,
        max_dist: u128,
        // --- Private coordinates (ZK proof inputs) ---
        x1: Field,
        y1: Field,
        x2: Field,
        y2: Field,
        // --- Move action parameters ---
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        source_activated_artifact_id: Field,
        target_activated_artifact_id: Field,
        is_abandoning: bool,
        timestamp: u64,
        // --- Config inputs (validated via hash in public) ---
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
        artifacts_config: ArtifactsConfig,
        // --- Source planet state (validated via hash in public) ---
        source_planet: Planet,
        source_planet_artifacts_state: PlanetArtifacts,
        source_planet_events_state: PlanetEvents,
        source_arrivals: [Arrival; 20],
        source_arrival_artifacts: [Artifact; 20],
        source_arrival_artifact_locations: [ArtifactLocation; 20],
        // --- Target planet state (validated via hash in public) ---
        target_planet: Planet,
        target_planet_artifacts_state: PlanetArtifacts,
        target_planet_events_state: PlanetEvents,
        target_arrivals: [Arrival; 20],
        target_arrival_artifacts: [Artifact; 20],
        target_arrival_artifact_locations: [ArtifactLocation; 20],
        // --- World & artifact state (validated via hash in public) ---
        world: World,
        moved_artifact: Artifact,
        source_activated_artifact: Artifact,
        target_activated_artifact: Artifact,
    ) {
        if !snark_config.disable_zk_checks {
            // Verify move proof: coords (x1,y1)->(x2,y2) produce source_loc, target_loc, target_perlin
            let r = world.radius as Field;
            let dist_max = max_dist as Field;
            let planet_hash_key = snark_config.planethash_key as Field;
            let space_type_key = snark_config.spacetype_key as Field;
            let scale = snark_config.perlin_length_scale;
            let (expected_source, expected_target, expected_perlin) = circuits::move::move_proof(
                r,
                dist_max,
                planet_hash_key,
                space_type_key,
                scale,
                snark_config.perlin_mirror_x,
                snark_config.perlin_mirror_y,
                x1,
                y1,
                x2,
                y2,
            );
            assert(expected_source == source_loc, "Move proof: source location hash mismatch");
            assert(expected_target == target_loc, "Move proof: target location hash mismatch");
            assert(expected_perlin == target_perlin, "Move proof: target perlin mismatch");
        }

        let sender = self.msg_sender();
        assert(!world.paused, "Game is paused");

        // Verify timestamp freshness for source planet
        assert_planet_timestamp_freshness(
            timestamp,
            source_planet,
            source_planet_artifacts_state,
            source_planet_events_state,
            source_arrivals,
            source_arrival_artifacts,
            source_arrival_artifact_locations,
        );

        // Verify timestamp freshness for target planet
        assert_planet_timestamp_freshness(
            timestamp,
            target_planet,
            target_planet_artifacts_state,
            target_planet_events_state,
            target_arrivals,
            target_arrival_artifacts,
            target_arrival_artifact_locations,
        );

        if moved_artifact_id != 0 {
            assert_artifact_timestamp_freshness(timestamp, moved_artifact);
        }

        if source_activated_artifact_id != 0 {
            assert_artifact_timestamp_freshness(timestamp, source_activated_artifact);
        }

        if target_activated_artifact_id != 0 {
            assert_artifact_timestamp_freshness(timestamp, target_activated_artifact);
        }

        // Compute config hashes for public verification
        let (planet_default_stats_hash, config_hashes) = compute_config_hashes(
            snark_config,
            planet_default_stats,
            world_config,
            game_config_core,
            planet_level_thresholds,
            space_junk_config,
            planet_type_weights_tier_0,
            planet_type_weights_tier_1,
            planet_type_weights_tier_2,
            planet_type_weights_tier_3,
        );
        let artifacts_config_hash = poseidon2_hash(artifacts_config.serialize());

        // Compute state hashes for public verification
        let (_, source_planet_hash, source_planet_artifacts_state_hash, source_planet_events_state_hash, source_arrival_ids, source_arrival_hashes, source_arrival_artifact_ids, source_arrival_artifact_hashes, source_arrival_artifact_location_hashes, original_source_arrivals_count) = compute_planet_hashes(
            source_loc,
            source_planet,
            source_planet_artifacts_state,
            source_planet_events_state,
            source_arrivals,
            source_arrival_artifacts,
            source_arrival_artifact_locations,
        );

        let (_, target_planet_hash, target_planet_artifacts_state_hash, target_planet_events_state_hash, target_arrival_ids, target_arrival_hashes, target_arrival_artifact_ids, target_arrival_artifact_hashes, target_arrival_artifact_location_hashes, original_target_arrivals_count) = compute_planet_hashes(
            target_loc,
            target_planet,
            target_planet_artifacts_state,
            target_planet_events_state,
            target_arrivals,
            target_arrival_artifacts,
            target_arrival_artifact_locations,
        );

        let world_hash = compute_world_hash(world);

        let moved_artifact_hash = compute_artifact_hash(moved_artifact_id, moved_artifact);
        let source_activated_artifact_hash =
            compute_artifact_hash(source_activated_artifact_id, source_activated_artifact);
        let target_activated_artifact_hash =
            compute_artifact_hash(target_activated_artifact_id, target_activated_artifact);

        let source_planet_is_initialized = source_planet != Planet::zero();
        assert(source_planet_is_initialized, "Source planet is not initialized");

        let new_source_planet_state = refresh_planet_v1(
            timestamp,
            source_loc,
            source_planet,
            source_planet_events_state,
            source_arrivals,
            source_arrival_artifacts,
            source_arrival_artifact_locations,
            source_planet_artifacts_state,
        );

        let mut new_source_planet = new_source_planet_state.0;
        let mut new_source_planet_events_state = new_source_planet_state.1;
        let mut new_source_planet_artifacts_state = new_source_planet_state.2;
        let mut new_source_arrival_artifact_locations = new_source_planet_state.3;

        let mut new_source_activated_artifact = source_activated_artifact;
        let mut new_source_activated_artifact_location = ArtifactLocation::zero();

        let target_planet_is_initialized = target_planet != Planet::zero();

        let mut new_target_planet = target_planet;
        let mut new_target_planet_events_state = target_planet_events_state;
        let mut new_target_planet_artifacts_state = target_planet_artifacts_state;
        let mut new_target_arrival_artifact_locations = target_arrival_artifact_locations;

        if target_planet_is_initialized {
            let new_target_states = refresh_planet_v1(
                timestamp,
                target_loc,
                target_planet,
                target_planet_events_state,
                target_arrivals,
                target_arrival_artifacts,
                target_arrival_artifact_locations,
                target_planet_artifacts_state,
            );

            new_target_planet = new_target_states.0;
            new_target_planet_events_state = new_target_states.1;
            new_target_planet_artifacts_state = new_target_states.2;
            new_target_arrival_artifact_locations = new_target_states.3;

            // checkPlanetDOS - Rate limiting check for planet arrivals
            let mut arrivals_from_owner: u8 = 0;
            let mut arrivals_from_others: u8 = 0;

            // After refresh_planet, event indices may have been rearranged via
            // swap-and-pop. Look up each remaining event's arrival by matching
            // event id against the arrivals array instead of using index directly.
            for i in 0..20 {
                if i < new_target_planet_events_state.count {
                    let event_id: Field = new_target_planet_events_state.events[i].id;
                    let mut arrival_player_address = AztecAddress::zero();

                    let mut found = false;
                    for j in 0..20 {
                        if (target_arrivals[j].id == event_id) & (found == false) {
                            arrival_player_address = target_arrivals[j].player;
                            found = true;
                        }
                    }
                    assert(found, "Arrival not found for event");

                    if arrival_player_address == new_target_planet.owner {
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
        }

        // Verify moved artifact is on the (refreshed) source planet
        if moved_artifact_id != 0 {
            assert(
                is_artifact_on_planet(
                    source_loc,
                    new_source_planet_artifacts_state,
                    moved_artifact_id,
                ),
                "Moved artifact is not on source planet",
            );
        }

        // Verify activated artifact is on the (refreshed) source planet
        if source_activated_artifact_id != 0 {
            assert(
                is_artifact_on_planet(
                    source_loc,
                    new_source_planet_artifacts_state,
                    source_activated_artifact_id,
                ),
                "Activated artifact is not on source planet",
            );
        }

        // Verify target activated artifact is on the (refreshed) target planet
        if target_activated_artifact_id != 0 {
            assert(
                is_artifact_on_planet(
                    target_loc,
                    new_target_planet_artifacts_state,
                    target_activated_artifact_id,
                ),
                "Target activated artifact is not on target planet",
            );
        }

        // Target planet artifact count limit - fixes Solidity bug where only
        // on-planet artifacts were checked, ignoring in-transit ones carried by
        // pending arrivals. Uses pre-refresh state so we can iterate arrivals
        // directly without the 20x20 event-to-arrival lookup.
        if moved_artifact_id != 0 {
            let mut carried_artifacts: u32 = 0;
            for i in 0..20 {
                if target_arrivals[i].carried_artifact_id != 0 {
                    carried_artifacts += 1;
                }
            }
            assert(
                target_planet_artifacts_state.count + carried_artifacts + 1 < 6,
                "Too many artifacts on target planet",
            );
        }

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

        // Check if this is a spaceship move
        let is_spaceship_move = if moved_artifact_id != 0 {
            let artifact_type = moved_artifact.artifact_type;

            (artifact_type == ArtifactType::ShipMothership)
                | (artifact_type == ArtifactType::ShipCrescent)
                | (artifact_type == ArtifactType::ShipWhale)
                | (artifact_type == ArtifactType::ShipGear)
                | (artifact_type == ArtifactType::ShipTitan)
        } else {
            false
        };

        if is_spaceship_move {
            args.sender = AztecAddress::zero();
        }

        // Check move validity
        if is_spaceship_move {
            assert(pop_moved == 0, "ship moves must move 0 energy");
            assert(silver_moved == 0, "ship moves must move 0 silver");
            assert(moved_artifact.controller == sender, "you can only move your own ships");
        } else {
            assert(
                !new_target_planet.destroyed & !new_source_planet.destroyed,
                "planet is destroyed",
            );
            assert(
                new_source_planet.owner == sender,
                "Only owner account can perform that operation on planet.",
            );

            // note: this is fine because energy and silver now grow linearly
            assert(
                new_source_planet.population >= pop_moved,
                "Tried to move more population that what exists",
            );

            assert(
                new_source_planet.silver >= silver_moved,
                "Tried to move more silver than what exists",
            );
        }

        let mut effectiveDistTimesHundred: u128 = args.max_dist * 100;
        let mut arrival_type = ArrivalType::Normal;
        let mut temporary_upgrade = Upgrade::zero();

        // _checkWormhole: if an active Wormhole artifact on either planet
        // points to the other, shorten effective distance based on rarity.
        let source_has_wormhole = if source_activated_artifact_id != 0 {
            is_activated(source_activated_artifact)
                & (source_activated_artifact.artifact_type == ArtifactType::Wormhole)
                & (source_activated_artifact.wormhole_to == target_loc)
        } else {
            false
        };

        let target_has_wormhole = if target_activated_artifact_id != 0 {
            is_activated(target_activated_artifact)
                & (target_activated_artifact.artifact_type == ArtifactType::Wormhole)
                & (target_activated_artifact.wormhole_to == source_loc)
        } else {
            false
        };

        if source_has_wormhole | target_has_wormhole {
            let wormhole_rarity = if source_has_wormhole {
                source_activated_artifact.rarity
            } else {
                target_activated_artifact.rarity
            };
            let speed_boosts: [u128; 6] = [1, 2, 4, 8, 16, 32];
            effectiveDistTimesHundred /= speed_boosts[wormhole_rarity as u32];
            arrival_type = ArrivalType::Wormhole;
        }

        // _checkPhotoid: if the source planet has an active PhotoidCannon whose
        // activation delay has elapsed, apply a temporary speed/range boost and
        // deactivate it. Only applies to non-spaceship moves.
        if !is_spaceship_move & (source_activated_artifact_id != 0) {
            let is_photoid = is_activated(source_activated_artifact)
                & (source_activated_artifact.artifact_type == ArtifactType::PhotoidCannon)
                & (
                    timestamp - source_activated_artifact.last_activated
                        >= artifacts_config.photoid_activation_delay
                );

            if is_photoid {
                let r = source_activated_artifact.rarity as u32;
                let range_boosts: [u128; 6] = [100, 200, 200, 200, 200, 200];
                let speed_boosts: [u128; 6] = [100, 500, 1000, 1500, 2000, 2500];
                temporary_upgrade = Upgrade {
                    pop_cap_multiplier: 100,
                    pop_gro_multiplier: 100,
                    range_multiplier: range_boosts[r],
                    speed_multiplier: speed_boosts[r],
                    def_multiplier: 100,
                };
                arrival_type = ArrivalType::Photoid;

                // Deactivate the photoid artifact
                new_source_activated_artifact.last_deactivated = timestamp;
                new_source_activated_artifact.last_updated = timestamp;

                // Burn: remove from source planet artifacts (swap-and-pop)
                let art_count = new_source_planet_artifacts_state.count;
                let mut burn_index: u32 = 0;
                let mut burn_found = false;
                for i in 0..20 {
                    if (i < art_count) & !burn_found {
                        if new_source_planet_artifacts_state.ids[i] == source_activated_artifact_id {
                            burn_index = i;
                            burn_found = true;
                        }
                    }
                }
                assert(burn_found, "Photoid artifact not found on source planet");
                let burn_last = art_count - 1;
                new_source_planet_artifacts_state.ids[burn_index] =
                    new_source_planet_artifacts_state.ids[burn_last];
                new_source_planet_artifacts_state.ids[burn_last] = 0;
                new_source_planet_artifacts_state.count -= 1;

                // Clear artifact location (no longer on any planet)
                new_source_activated_artifact_location = ArtifactLocation {
                    planet_id: 0 as Field,
                    voyage_id: 0 as Field,
                    last_updated: timestamp,
                };

                // Reverse the permanent artifact buff (defense reduction) that was
                // applied when the PhotoidCannon was activated on this planet.
                let permanent_upgrade = _get_upgrade_for_artifact(new_source_activated_artifact);
                let debuff_result =
                    _debuff_planet(args.old_loc, new_source_planet, permanent_upgrade);
                new_source_planet = debuff_result.1;
            }
        }

        // Remove spaceship effects from origin planet when a ship departs
        if is_spaceship_move {
            new_source_planet =
                apply_spaceship_depart(moved_artifact, new_source_planet, timestamp);
        }

        let pop_moved = args.pop_moved;
        let silver_moved = args.silver_moved;
        let remaining_origin_planet_population = new_source_planet.population - pop_moved;

        // todo: how to handle SPACE_JUNK_ENABLE = true

        let buff_planet_result = _buff_planet(args.old_loc, new_source_planet, temporary_upgrade);
        new_source_planet = buff_planet_result.1;

        let mut travel_time: u64 = (effectiveDistTimesHundred / new_source_planet.speed) as u64;

        if travel_time == 0 {
            travel_time = 1;
        }

        // All checks pass. Execute move
        // Push the new event into the planetEvents array for target location
        assert(new_target_planet_events_state.count < 20, "Too many events on target planet");

        new_target_planet_events_state.events[new_target_planet_events_state.count] = PlanetEventMetadata {
            id: 0, // placeholder; allocated atomically in move_public
            // event_type: PlanetEventType::Arrival,
            // time_trigger: timestamp + travel_time,
            // time_created: timestamp,
        };
        new_target_planet_events_state.count += 1;

        // _createArrival - Enter the arrival data for event id

        // Piecewise linear decay: max reachable distance D_max depends on energy percentage.
        // Constraint points: (0%,0L) (25%,0.5L) (50%,0.75L) (100%,L) where L = range * 432/100.
        // Within D_max, arriving pop decays linearly: popMoved * (D_max - dist) / D_max.
        let pop_arriving = if is_spaceship_move {
            0
        } else {
            let percent = pop_moved * 100 / new_source_planet.population_cap;

            let d_max_percent = if percent <= 25 {
                percent * 2
            } else if percent <= 50 {
                25 + percent
            } else {
                (100 + percent) / 2
            };

            let d_factor = new_source_planet.range * 432 * d_max_percent;
            let dist_scaled = effectiveDistTimesHundred * 100;

            if (dist_scaled >= d_factor) | (d_factor == 0) {
                0
            } else {
                pop_moved * (d_factor - dist_scaled) / d_factor
            }
        };

        // Spaceship moves must be 0 energy moves
        assert(pop_arriving > 0 | is_spaceship_move, "Not enough forces to make move");
        assert(!is_spaceship_move | (pop_moved == 0), "spaceship moves must be 0 energy moves");

        // Create the new arrival (id is a placeholder; allocated in move_public)
        let new_arrival = Arrival {
            id: 0,
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

        let mut new_moved_artifact_location = ArtifactLocation::zero();

        // Handle artifact movement
        if moved_artifact_id != 0 {
            // Take artifact off the source planet
            let take_artifact_result = _take_artifact_off_planet(
                moved_artifact_id,
                new_moved_artifact_location,
                moved_artifact,
                source_loc,
                new_source_planet_artifacts_state,
            );

            // Unpack the results
            new_moved_artifact_location = take_artifact_result.1;
            new_source_planet_artifacts_state = take_artifact_result.3;

            // voyage_id is patched in move_public after event ID allocation
            new_moved_artifact_location.last_updated = timestamp;
        }

        let debuff_planet_result =
            _debuff_planet(args.old_loc, new_source_planet, temporary_upgrade);
        new_source_planet = debuff_planet_result.1;

        new_source_planet.silver -= silver_moved;
        new_source_planet.population = remaining_origin_planet_population;

        // Set last_updated on all new state tables before passing to public
        new_source_planet.last_updated = timestamp;
        new_source_planet_events_state.last_updated = timestamp;
        new_source_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < original_source_arrivals_count & (source_arrivals[i].carried_artifact_id != 0) {
                new_source_arrival_artifact_locations[i].last_updated = timestamp;
            }
        }

        new_target_planet.last_updated = timestamp;
        new_target_planet_events_state.last_updated = timestamp;
        new_target_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < original_target_arrivals_count & (target_arrivals[i].carried_artifact_id != 0) {
                new_target_arrival_artifact_locations[i].last_updated = timestamp;
            }
        }

        new_source_activated_artifact.last_updated = timestamp;
        new_source_activated_artifact_location.last_updated = timestamp;

        // Pass hashes and computed results to public for verification and storage
        self.enqueue_self.move_public(
            source_loc,
            target_loc,
            target_level,
            moved_artifact_id,
            source_activated_artifact_id,
            target_activated_artifact_id,
            timestamp,
            // Config hashes: [snark, world, game_core, thresholds, space_junk, tier0, tier1, tier2, tier3]
            config_hashes,
            artifacts_config_hash,
            planet_default_stats_hash,
            // State hashes from private function for verification
            source_planet_hash,
            source_planet_artifacts_state_hash,
            source_planet_events_state_hash,
            source_arrival_ids,
            source_arrival_hashes,
            source_arrival_artifact_ids,
            source_arrival_artifact_hashes,
            source_arrival_artifact_location_hashes,
            original_source_arrivals_count,
            target_planet_hash,
            target_planet_artifacts_state_hash,
            target_planet_events_state_hash,
            target_arrival_ids,
            target_arrival_hashes,
            target_arrival_artifact_ids,
            target_arrival_artifact_hashes,
            target_arrival_artifact_location_hashes,
            original_target_arrivals_count,
            world_hash,
            moved_artifact_hash,
            source_activated_artifact_hash,
            target_activated_artifact_hash,
            new_source_planet,
            new_source_planet_artifacts_state,
            new_source_planet_events_state,
            new_source_arrival_artifact_locations,
            new_target_planet,
            new_target_planet_artifacts_state,
            new_target_planet_events_state,
            new_target_arrival_artifact_locations,
            new_arrival,
            new_moved_artifact_location,
            new_source_activated_artifact,
            new_source_activated_artifact_location,
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
        source_activated_artifact_id: Field,
        target_activated_artifact_id: Field,
        timestamp: u64,
        // Config hashes: [snark, world, game_core, thresholds, space_junk, tier0, tier1, tier2, tier3]
        config_hashes: [Field; 9],
        artifacts_config_hash: Field,
        planet_default_stats_hash: Field,
        // State hashes from private function for verification
        source_planet_hash: Field,
        source_planet_artifacts_state_hash: Field,
        source_planet_events_state_hash: Field,
        source_arrival_ids: [Field; 20],
        source_arrival_hashes: [Field; 20],
        source_arrival_artifact_ids: [Field; 20],
        source_arrival_artifact_hashes: [Field; 20],
        source_arrival_artifact_location_hashes: [Field; 20],
        original_source_arrivals_count: u32,
        target_planet_hash: Field,
        target_planet_artifacts_state_hash: Field,
        target_planet_events_state_hash: Field,
        target_arrival_ids: [Field; 20],
        target_arrival_hashes: [Field; 20],
        target_arrival_artifact_ids: [Field; 20],
        target_arrival_artifact_hashes: [Field; 20],
        target_arrival_artifact_location_hashes: [Field; 20],
        original_target_arrivals_count: u32,
        world_hash: Field,
        moved_artifact_hash: Field,
        source_activated_artifact_hash: Field,
        target_activated_artifact_hash: Field,
        // New states to write (computed in private function)
        new_source_planet: Planet,
        new_source_planet_artifacts_state: PlanetArtifacts,
        new_source_planet_events_state: PlanetEvents,
        new_source_arrival_artifact_locations: [ArtifactLocation; 20],
        new_target_planet: Planet,
        new_target_planet_artifacts_state: PlanetArtifacts,
        new_target_planet_events_state_input: PlanetEvents,
        new_target_arrival_artifact_locations: [ArtifactLocation; 20],
        new_arrival_input: Arrival,
        new_moved_artifact_location_input: ArtifactLocation,
        new_source_activated_artifact: Artifact,
        new_source_activated_artifact_location: ArtifactLocation,
    ) {
        let mut new_target_planet_events_state = new_target_planet_events_state_input;
        let mut new_arrival = new_arrival_input;
        let mut new_moved_artifact_location = new_moved_artifact_location_input;

        // Verify timestamp
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let config = Config::at(self.storage.config_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let arrivals_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());

        // Verify base config hashes in a single cross-contract call
        assert(
            self.view(config.verify_config_hashes(
                target_level,
                planet_default_stats_hash,
                config_hashes,
            )),
            "Config hash mismatch",
        );
        assert(
            self.view(config.verify_artifacts_config_hash(artifacts_config_hash)),
            "Artifacts config hash mismatch",
        );

        // Verify source planet state hashes
        assert(
            self.view(planet_storage.verify_hash(source_loc, source_planet_hash)),
            "Source planet hash mismatch",
        );

        assert(
            self.view(planet_artifacts_storage.verify_hash(
                source_loc,
                source_planet_artifacts_state_hash,
            )),
            "Source planet artifacts hash mismatch",
        );

        assert(
            self.view(planet_events_storage.verify_hash(source_loc, source_planet_events_state_hash)),
            "Source planet events hash mismatch",
        );

        assert(
            self.view(arrivals_storage.verify_hashes_batch(
                source_arrival_ids,
                source_arrival_hashes,
                original_source_arrivals_count,
            )),
            "Source arrival hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hashes_batch(
                source_arrival_artifact_ids,
                source_arrival_artifact_hashes,
                original_source_arrivals_count,
            )),
            "Source artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                source_arrival_artifact_ids,
                source_arrival_artifact_location_hashes,
                original_source_arrivals_count,
            )),
            "Source artifact location hash mismatch",
        );

        // Verify target planet state hashes
        assert(
            self.view(planet_storage.verify_hash(target_loc, target_planet_hash)),
            "Target planet hash mismatch",
        );

        assert(
            self.view(planet_artifacts_storage.verify_hash(
                target_loc,
                target_planet_artifacts_state_hash,
            )),
            "Target planet artifacts hash mismatch",
        );

        assert(
            self.view(planet_events_storage.verify_hash(target_loc, target_planet_events_state_hash)),
            "Target planet events hash mismatch",
        );

        // Batch verify target arrivals, artifacts, artifact_locations (3 calls instead of 60)
        assert(
            self.view(arrivals_storage.verify_hashes_batch(
                target_arrival_ids,
                target_arrival_hashes,
                original_target_arrivals_count,
            )),
            "Target arrival hash mismatch",
        );

        assert(
            self.view(artifact_storage.verify_hashes_batch(
                target_arrival_artifact_ids,
                target_arrival_artifact_hashes,
                original_target_arrivals_count,
            )),
            "Target artifact hash mismatch",
        );

        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                target_arrival_artifact_ids,
                target_arrival_artifact_location_hashes,
                original_target_arrivals_count,
            )),
            "Target artifact location hash mismatch",
        );

        // Verify world, moved artifact, and activated artifact hashes
        assert(self.view(world_storage.verify_hash(0, world_hash)), "World hash mismatch");

        assert(
            self.view(artifact_storage.verify_hash(moved_artifact_id, moved_artifact_hash)),
            "Moved artifact hash mismatch",
        );

        assert(
            self.view(artifact_storage.verify_hash(
                source_activated_artifact_id,
                source_activated_artifact_hash,
            )),
            "Activated artifact hash mismatch",
        );

        assert(
            self.view(artifact_storage.verify_hash(
                target_activated_artifact_id,
                target_activated_artifact_hash,
            )),
            "Target activated artifact hash mismatch",
        );

        // Allocate a unique event ID from the atomic counter in ArrivalStorage,
        // then patch the placeholder IDs in arrival, planet events, and artifact location.
        let event_id: Field = self.call(arrivals_storage.allocate_event_id());
        new_arrival.id = event_id;

        // Patch the last event in target planet events (the one just added in private)
        assert(new_target_planet_events_state.count > 0, "Expected at least one planet event");
        new_target_planet_events_state.events[new_target_planet_events_state.count - 1].id =
            event_id;

        if moved_artifact_id != 0 {
            new_moved_artifact_location.voyage_id = event_id;
        }

        // Write new states to storage
        self.call(planet_storage.set(source_loc, new_source_planet));
        self.call(planet_artifacts_storage.set(source_loc, new_source_planet_artifacts_state));
        self.call(planet_events_storage.set(source_loc, new_source_planet_events_state));

        // Batch write source arrival artifact locations (1 call instead of up to 20)
        self.call(artifact_location_storage.set_arrival_locations_max20(
            source_arrival_artifact_ids,
            new_source_arrival_artifact_locations,
            original_source_arrivals_count,
        ));

        self.call(planet_storage.set(target_loc, new_target_planet));
        self.call(planet_artifacts_storage.set(target_loc, new_target_planet_artifacts_state));
        self.call(planet_events_storage.set(target_loc, new_target_planet_events_state));

        // Batch write target arrival artifact locations (1 call instead of up to 20)
        self.call(artifact_location_storage.set_arrival_locations_max20(
            target_arrival_artifact_ids,
            new_target_arrival_artifact_locations,
            original_target_arrivals_count,
        ));

        self.call(arrivals_storage.set(new_arrival.id, new_arrival));

        if moved_artifact_id != 0 {
            self.call(artifact_location_storage.set(moved_artifact_id, new_moved_artifact_location));
        }

        // Write back deactivated/burned source activated artifact
        if source_activated_artifact_id != 0 {
            self.call(artifact_storage.set(
                source_activated_artifact_id,
                new_source_activated_artifact,
            ));

            // PhotoidCannon and PlanetaryShield are burned on deactivation
            let is_burn_type = (
                new_source_activated_artifact.artifact_type == ArtifactType::PhotoidCannon
            )
                | (new_source_activated_artifact.artifact_type == ArtifactType::PlanetaryShield);

            let was_deactivated = new_source_activated_artifact.last_deactivated
                >= new_source_activated_artifact.last_activated;
            if is_burn_type & was_deactivated {
                self.call(artifact_location_storage.set(
                    source_activated_artifact_id,
                    new_source_activated_artifact_location,
                ));
            }
        }
    }
}
