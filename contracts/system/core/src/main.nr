use ::aztec::macros::aztec;

#[aztec]
contract Core {
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
        upgrade::{Upgrade, UpgradeConfig},
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

    use ::libs::game_utils::{_buff_planet, revert_if_bad_snark_perlin_flags, update_world_radius};

    use ::libs::planet::{
        check_player_init, initialize_planet_with_defaults, refresh_planet, validate_upgrade_planet,
        validate_withdraw_silver,
    };

    use ::arrival_storage::ArrivalStorage;
    use ::artifact_location_storage::ArtifactLocationStorage;
    use ::artifact_storage::ArtifactStorage;
    use ::config::Config;
    use ::planet_artifacts_storage::PlanetArtifactsStorage;
    use ::planet_events_storage::PlanetEventsStorage;
    use ::planet_revealed_coords_storage::PlanetRevealedCoordsStorage;
    use ::planet_storage::PlanetStorage;
    use ::player_storage::PlayerStorage;
    use ::world_storage::WorldStorage;

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
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
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
        self.storage.planet_revealed_coords_storage_address.write(
            planet_revealed_coords_storage_address,
        );
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
        planet_revealed_coords_addr: AztecAddress,
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
        self.storage.planet_revealed_coords_storage_address.write(planet_revealed_coords_addr);
        self.storage.planet_events_storage_address.write(planet_events_addr);
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_addr);
        self.storage.arrivals_storage_address.write(arrivals_addr);
        self.storage.artifact_storage_address.write(artifact_addr);
        self.storage.artifact_location_storage_address.write(artifact_location_addr);
    }

    #[external("private")]
    fn refresh_planet_private(
        location: Field,
        planet_state: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        timestamp: u64,
    ) {
        // Assert timestamps for main states
        assert(
            timestamp >= planet_state.last_updated,
            "Timestamp must be >= planet's last_updated",
        );
        assert(
            timestamp >= planet_events_state.last_updated,
            "Timestamp must be >= planet_events' last_updated",
        );
        assert(
            timestamp >= planet_artifacts_state.last_updated,
            "Timestamp must be >= planet_artifacts' last_updated",
        );

        // Assert timestamps for artifacts in arrivals
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < planet_events_state.count {
                let arrival = arrivals[i];

                assert(
                    timestamp >= arrival.departure_time,
                    "Timestamp must be >= arrival's departure_time",
                );

                if arrival.carried_artifact_id != 0 {
                    let artifact = artifacts[i];
                    let artifact_location = artifact_locations[i];

                    assert(
                        timestamp >= artifact.last_updated,
                        "Timestamp must be >= artifact's last_updated",
                    );
                    assert(
                        timestamp >= artifact_location.last_updated,
                        "Timestamp must be >= artifact_location's last_updated",
                    );
                }
            }
        }

        let planet_is_initialized: bool = planet_state != Planet::zero();
        assert(planet_is_initialized, "Planet is not initialized");

        let planet_state_hash = if planet_state == Planet::zero() {
            0
        } else {
            poseidon2_hash(planet_state.serialize())
        };
        let planet_events_state_hash = if planet_events_state == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(planet_events_state.serialize())
        };

        // Extract arrival_ids and artifact_ids by order: [id_0, id_1, ..., id_19]
        let mut arrival_ids: [Field; 20] = [0; 20];
        let mut arrivals_hash: [Field; 20] = [0; 20];
        let mut artifact_ids: [Field; 20] = [0; 20];
        let mut artifacts_hash: [Field; 20] = [0; 20];
        let mut artifact_locations_hash: [Field; 20] = [0; 20];
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < planet_events_state.count {
                arrival_ids[i] = arrivals[i].id;
                let arrival = arrivals[i];
                artifact_ids[i] = arrival.carried_artifact_id; // or pick artifact_id if it exists, here planet_discovered_on as unique id

                let arrival_id = arrival_ids[i];
                let artifact_id = artifact_ids[i];
                if arrival_id != 0 {
                    arrivals_hash[i] = poseidon2_hash(arrivals[i].serialize());

                    if artifact_id != 0 {
                        artifacts_hash[i] = poseidon2_hash(artifacts[i].serialize());
                        artifact_locations_hash[i] =
                            poseidon2_hash(artifact_locations[i].serialize());
                    }
                }
            }
        }

        let res = refresh_planet(
            timestamp,
            location,
            planet_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = res.0;
        let mut new_planet_events_state = res.1;
        let mut new_planet_artifacts_state = res.2;
        let mut new_artifact_locations = res.3;

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        // Update artifact_locations that correspond to the arrivals
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if i < planet_events_state.count {
                new_artifact_locations[i].last_updated = timestamp;
            }
        }

        let planet_artifacts_state_hash = if new_planet_artifacts_state == PlanetArtifacts::zero() {
            0
        } else {
            poseidon2_hash(new_planet_artifacts_state.serialize())
        };

        self.enqueue_self.refresh_planet_public(
            location,
            planet_state_hash,
            planet_events_state_hash,
            planet_events_state.count as u8,
            arrival_ids,
            arrivals_hash,
            artifact_ids,
            artifacts_hash,
            artifact_locations_hash,
            planet_artifacts_state_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_artifact_locations,
            timestamp,
        );
    }

    #[external("public")]
    #[only_self]
    fn refresh_planet_public(
        location: Field,
        planet_state_hash: Field,
        planet_events_state_hash: Field,
        planet_event_count: u8,
        arrivals_ids: [Field; 20],
        arrivals_hash: [Field; 20],
        artifacts_ids: [Field; 20],
        artifacts_hash: [Field; 20],
        artifact_locations_hash: [Field; 20],
        planet_artifacts_state_hash: Field,
        // Computed results to write
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
        timestamp: u64,
    ) {
        // Verify timestamp is within a reasonable time window
        // Users can't know the exact on-chain timestamp in advance, so we allow a time window
        let actual_timestamp = self.context.timestamp();

        // Timestamp cannot be in the future
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");

        // Timestamp cannot be too old (e.g., 5 minutes = 300 seconds)
        // This prevents replay attacks with outdated timestamps
        let max_time_drift: u64 = 300; // 5 minutes tolerance
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        // Verify all hashes match on-chain state
        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        assert(
            self.view(planet_storage.verify_hash(location, planet_state_hash)),
            "Planet state hash mismatch",
        );

        let planet_events_storage_address = self.internal.get_planet_events_storage_address();
        let planet_events_storage = PlanetEventsStorage::at(planet_events_storage_address);
        assert(
            self.view(planet_events_storage.verify_hash(location, planet_events_state_hash)),
            "Planet events state hash mismatch",
        );

        let arrival_storage_address = self.internal.get_arrivals_storage_address();
        let arrival_storage = ArrivalStorage::at(arrival_storage_address);
        let artifact_storage_address = self.internal.get_artifact_storage_address();
        let artifact_storage = ArtifactStorage::at(artifact_storage_address);
        let artifact_location_storage_address =
            self.internal.get_artifact_location_storage_address();
        let artifact_location_storage =
            ArtifactLocationStorage::at(artifact_location_storage_address);

        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if (i as u8) < planet_event_count {
                let arrival_id = arrivals_ids[i];
                let artifact_id = artifacts_ids[i];
                if arrival_id != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_id, arrivals_hash[i])),
                        "Arrival hash mismatch",
                    );
                }
                if artifact_id != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifact_id, artifacts_hash[i])),
                        "Artifact hash mismatch",
                    );
                    assert(
                        self.view(artifact_location_storage.verify_hash(
                            artifact_id,
                            artifact_locations_hash[i],
                        )),
                        "Artifact location hash mismatch",
                    );
                }
            }
        }

        let planet_artifacts_storage_address = self.internal.get_planet_artifacts_storage_address();
        let planet_artifacts_storage = PlanetArtifactsStorage::at(planet_artifacts_storage_address);
        assert(
            self.view(planet_artifacts_storage.verify_hash(location, planet_artifacts_state_hash)),
            "Planet artifacts state hash mismatch",
        );

        // Write verified computed states to storage
        self.call(planet_storage.set(location, new_planet));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));
        // Write artifact_locations for arrivals that have artifacts
        // Use fixed array size 20 as compile-time constant for loop bound
        for i in 0..20 {
            if (i < planet_event_count as u32) & (artifacts_ids[i] != 0) {
                self.call(artifact_location_storage.set(artifacts_ids[i], new_artifact_locations[i]));
            }
        }
    }

    #[external("private")]
    fn upgrade_planet(
        location: Field,
        branch: u8,
        timestamp: u64,
        upgrade_config: UpgradeConfig,
        upgrade: Upgrade,
        planet_state: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
    ) {
        let sender = self.msg_sender();

        assert(planet_state != Planet::zero(), "Planet is not initialized");
        assert(
            timestamp >= planet_state.last_updated,
            "Timestamp must be >= planet's last_updated",
        );
        assert(
            timestamp >= planet_events_state.last_updated,
            "Timestamp must be >= planet_events' last_updated",
        );
        assert(
            timestamp >= planet_artifacts_state.last_updated,
            "Timestamp must be >= planet_artifacts' last_updated",
        );

        for i in 0..20 {
            if i < planet_events_state.count {
                let arrival = arrivals[i];

                assert(
                    timestamp >= arrival.departure_time,
                    "Timestamp must be >= arrival's departure_time",
                );

                if arrival.carried_artifact_id != 0 {
                    let artifact = artifacts[i];
                    let artifact_location = artifact_locations[i];

                    assert(
                        timestamp >= artifact.last_updated,
                        "Timestamp must be >= artifact's last_updated",
                    );
                    assert(
                        timestamp >= artifact_location.last_updated,
                        "Timestamp must be >= artifact_location's last_updated",
                    );
                }
            }
        }

        let planet_state_hash = poseidon2_hash(planet_state.serialize());
        let planet_events_state_hash = if planet_events_state == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(planet_events_state.serialize())
        };

        let mut arrivals_ids: [Field; 20] = [0; 20];
        let mut arrivals_hash: [Field; 20] = [0; 20];
        let mut artifacts_ids: [Field; 20] = [0; 20];
        let mut artifacts_hash: [Field; 20] = [0; 20];
        let mut artifact_locations_hash: [Field; 20] = [0; 20];
        for i in 0..20 {
            if i < planet_events_state.count {
                let arrival_id = planet_events_state.events[i].id;
                let arrival = arrivals[i];
                let artifact_id = arrival.carried_artifact_id;

                arrivals_ids[i] = arrival_id;
                artifacts_ids[i] = artifact_id;
                if arrival_id != 0 {
                    arrivals_hash[i] = poseidon2_hash(arrivals[i].serialize());

                    if artifact_id != 0 {
                        artifacts_hash[i] = poseidon2_hash(artifacts[i].serialize());
                        artifact_locations_hash[i] =
                            poseidon2_hash(artifact_locations[i].serialize());
                    }
                }
            }
        }

        let planet_artifacts_state_hash = if planet_artifacts_state == PlanetArtifacts::zero() {
            0
        } else {
            poseidon2_hash(planet_artifacts_state.serialize())
        };

        let refreshed_states = refresh_planet(
            timestamp,
            location,
            planet_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let mut refreshed_planet = refreshed_states.0;
        let mut new_planet_events_state = refreshed_states.1;
        let mut new_planet_artifacts_state = refreshed_states.2;
        let mut new_artifact_locations = refreshed_states.3;

        refreshed_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < planet_events_state.count {
                new_artifact_locations[i].last_updated = timestamp;
            }
        }

        let (current_branch_level, silver_cost) =
            validate_upgrade_planet(refreshed_planet, branch, sender, upgrade_config);

        let mut new_planet = refreshed_planet;
        new_planet.silver -= silver_cost;
        if branch == UpgradeBranch::Defense() {
            new_planet.upgrade_state_0 += 1;
        } else if branch == UpgradeBranch::Range() {
            new_planet.upgrade_state_1 += 1;
        } else {
            new_planet.upgrade_state_2 += 1;
        }
        new_planet = _buff_planet(location, new_planet, upgrade).1;
        new_planet.last_updated = timestamp;

        let upgrade_config_hash = poseidon2_hash(upgrade_config.serialize());
        let upgrade_hash = poseidon2_hash(upgrade.serialize());

        self.enqueue_self.upgrade_planet_public(
            location,
            sender,
            branch,
            current_branch_level,
            timestamp,
            planet_state_hash,
            planet_events_state_hash,
            planet_events_state.count as u8,
            arrivals_ids,
            arrivals_hash,
            artifacts_ids,
            artifacts_hash,
            artifact_locations_hash,
            planet_artifacts_state_hash,
            upgrade_config_hash,
            upgrade_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_artifact_locations,
        );
    }

    #[external("public")]
    #[only_self]
    fn upgrade_planet_public(
        location: Field,
        sender: AztecAddress,
        branch: u8,
        current_branch_level: u8,
        timestamp: u64,
        planet_state_hash: Field,
        planet_events_state_hash: Field,
        planet_event_count: u8,
        arrivals_ids: [Field; 20],
        arrivals_hash: [Field; 20],
        artifacts_ids: [Field; 20],
        artifacts_hash: [Field; 20],
        artifact_locations_hash: [Field; 20],
        planet_artifacts_state_hash: Field,
        upgrade_config_hash: Field,
        upgrade_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
    ) {
        let actual_timestamp = self.context.timestamp();
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");
        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        assert(
            self.view(planet_storage.verify_hash(location, planet_state_hash)),
            "Planet state hash mismatch",
        );

        let planet_events_storage_address = self.internal.get_planet_events_storage_address();
        let planet_events_storage = PlanetEventsStorage::at(planet_events_storage_address);
        assert(
            self.view(planet_events_storage.verify_hash(location, planet_events_state_hash)),
            "Planet events state hash mismatch",
        );

        let arrival_storage_address = self.internal.get_arrivals_storage_address();
        let arrival_storage = ArrivalStorage::at(arrival_storage_address);
        let artifact_storage_address = self.internal.get_artifact_storage_address();
        let artifact_storage = ArtifactStorage::at(artifact_storage_address);
        let artifact_location_storage_address =
            self.internal.get_artifact_location_storage_address();
        let artifact_location_storage =
            ArtifactLocationStorage::at(artifact_location_storage_address);
        for i in 0..20 {
            if (i as u8) < planet_event_count {
                let arrival_id = arrivals_ids[i];
                let artifact_id = artifacts_ids[i];

                if arrival_id != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_id, arrivals_hash[i])),
                        "Arrival hash mismatch",
                    );
                }

                if artifact_id != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifact_id, artifacts_hash[i])),
                        "Artifact hash mismatch",
                    );
                    assert(
                        self.view(artifact_location_storage.verify_hash(
                            artifact_id,
                            artifact_locations_hash[i],
                        )),
                        "Artifact location hash mismatch",
                    );
                }
            }
        }

        let planet_artifacts_storage_address = self.internal.get_planet_artifacts_storage_address();
        let planet_artifacts_storage = PlanetArtifactsStorage::at(planet_artifacts_storage_address);
        assert(
            self.view(planet_artifacts_storage.verify_hash(location, planet_artifacts_state_hash)),
            "Planet artifacts state hash mismatch",
        );

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        assert(
            self.view(config.verify_upgrade_config_hash(upgrade_config_hash)),
            "Upgrade config hash mismatch",
        );

        let configured_upgrade = self.view(config.get_upgrade_by_branch_level(
            branch as u128,
            current_branch_level as u128,
        ));
        assert(
            poseidon2_hash(configured_upgrade.serialize()) == upgrade_hash,
            "Upgrade hash mismatch",
        );

        assert(new_planet.owner == sender, "Planet owner mismatch");
        self.call(planet_storage.set(location, new_planet));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));
        for i in 0..20 {
            if (i < planet_event_count as u32) & (artifacts_ids[i] != 0) {
                self.call(artifact_location_storage.set(artifacts_ids[i], new_artifact_locations[i]));
            }
        }
    }

    #[external("private")]
    fn withdraw_silver(
        location: Field,
        silver_to_withdraw: u128,
        timestamp: u64,
        world_config: WorldConfig,
        planet_state: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        player_state: Player,
    ) {
        let sender = self.msg_sender();

        assert(planet_state != Planet::zero(), "Planet is not initialized");
        assert(player_state != Player::zero(), "Player is not initialized");
        assert(
            timestamp >= planet_state.last_updated,
            "Timestamp must be >= planet's last_updated",
        );
        assert(
            timestamp >= player_state.last_updated,
            "Timestamp must be >= player's last_updated",
        );
        assert(
            timestamp >= planet_events_state.last_updated,
            "Timestamp must be >= planet_events' last_updated",
        );
        assert(
            timestamp >= planet_artifacts_state.last_updated,
            "Timestamp must be >= planet_artifacts' last_updated",
        );

        for i in 0..20 {
            if i < planet_events_state.count {
                let arrival = arrivals[i];

                assert(
                    timestamp >= arrival.departure_time,
                    "Timestamp must be >= arrival's departure_time",
                );

                if arrival.carried_artifact_id != 0 {
                    let artifact = artifacts[i];
                    let artifact_location = artifact_locations[i];

                    assert(
                        timestamp >= artifact.last_updated,
                        "Timestamp must be >= artifact's last_updated",
                    );
                    assert(
                        timestamp >= artifact_location.last_updated,
                        "Timestamp must be >= artifact_location's last_updated",
                    );
                }
            }
        }

        let planet_state_hash = poseidon2_hash(planet_state.serialize());
        let planet_events_state_hash = if planet_events_state == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(planet_events_state.serialize())
        };

        let mut arrivals_ids: [Field; 20] = [0; 20];
        let mut arrivals_hash: [Field; 20] = [0; 20];
        let mut artifacts_ids: [Field; 20] = [0; 20];
        let mut artifacts_hash: [Field; 20] = [0; 20];
        let mut artifact_locations_hash: [Field; 20] = [0; 20];
        for i in 0..20 {
            if i < planet_events_state.count {
                let arrival_id = planet_events_state.events[i].id;
                let arrival = arrivals[i];
                let artifact_id = arrival.carried_artifact_id;

                arrivals_ids[i] = arrival_id;
                artifacts_ids[i] = artifact_id;
                if arrival_id != 0 {
                    arrivals_hash[i] = poseidon2_hash(arrivals[i].serialize());

                    if artifact_id != 0 {
                        artifacts_hash[i] = poseidon2_hash(artifacts[i].serialize());
                        artifact_locations_hash[i] =
                            poseidon2_hash(artifact_locations[i].serialize());
                    }
                }
            }
        }

        let planet_artifacts_state_hash = if planet_artifacts_state == PlanetArtifacts::zero() {
            0
        } else {
            poseidon2_hash(planet_artifacts_state.serialize())
        };

        let refreshed_states = refresh_planet(
            timestamp,
            location,
            planet_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let mut refreshed_planet = refreshed_states.0;
        let mut new_planet_events_state = refreshed_states.1;
        let mut new_planet_artifacts_state = refreshed_states.2;
        let mut new_artifact_locations = refreshed_states.3;

        refreshed_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < planet_events_state.count {
                new_artifact_locations[i].last_updated = timestamp;
            }
        }

        validate_withdraw_silver(refreshed_planet, silver_to_withdraw, sender);

        let mut new_planet = refreshed_planet;
        new_planet.silver -= silver_to_withdraw;
        new_planet.last_updated = timestamp;

        let score: u128 = ((silver_to_withdraw / 1000) * world_config.silver_score_value) / 100;
        let mut new_player = player_state;
        new_player.score += score;
        new_player.last_updated = timestamp;

        let player_state_hash = poseidon2_hash(player_state.serialize());
        let world_config_hash = poseidon2_hash(world_config.serialize());

        self.enqueue_self.withdraw_silver_public(
            location,
            sender,
            timestamp,
            planet_state_hash,
            planet_events_state_hash,
            planet_events_state.count as u8,
            arrivals_ids,
            arrivals_hash,
            artifacts_ids,
            artifacts_hash,
            artifact_locations_hash,
            planet_artifacts_state_hash,
            player_state_hash,
            world_config_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_artifact_locations,
            new_player,
        );
    }

    #[external("public")]
    #[only_self]
    fn withdraw_silver_public(
        location: Field,
        sender: AztecAddress,
        timestamp: u64,
        planet_state_hash: Field,
        planet_events_state_hash: Field,
        planet_event_count: u8,
        arrivals_ids: [Field; 20],
        arrivals_hash: [Field; 20],
        artifacts_ids: [Field; 20],
        artifacts_hash: [Field; 20],
        artifact_locations_hash: [Field; 20],
        planet_artifacts_state_hash: Field,
        player_state_hash: Field,
        world_config_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
        new_player: Player,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");
        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        assert(
            self.view(config.verify_world_config_hash(world_config_hash)),
            "World config hash mismatch",
        );

        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        assert(
            self.view(planet_storage.verify_hash(location, planet_state_hash)),
            "Planet state hash mismatch",
        );

        let planet_events_storage_address = self.internal.get_planet_events_storage_address();
        let planet_events_storage = PlanetEventsStorage::at(planet_events_storage_address);
        assert(
            self.view(planet_events_storage.verify_hash(location, planet_events_state_hash)),
            "Planet events state hash mismatch",
        );

        let arrival_storage_address = self.internal.get_arrivals_storage_address();
        let arrival_storage = ArrivalStorage::at(arrival_storage_address);
        let artifact_storage_address = self.internal.get_artifact_storage_address();
        let artifact_storage = ArtifactStorage::at(artifact_storage_address);
        let artifact_location_storage_address =
            self.internal.get_artifact_location_storage_address();
        let artifact_location_storage =
            ArtifactLocationStorage::at(artifact_location_storage_address);
        for i in 0..20 {
            if (i as u8) < planet_event_count {
                let arrival_id = arrivals_ids[i];
                let artifact_id = artifacts_ids[i];

                if arrival_id != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_id, arrivals_hash[i])),
                        "Arrival hash mismatch",
                    );
                }

                if artifact_id != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifact_id, artifacts_hash[i])),
                        "Artifact hash mismatch",
                    );
                    assert(
                        self.view(artifact_location_storage.verify_hash(
                            artifact_id,
                            artifact_locations_hash[i],
                        )),
                        "Artifact location hash mismatch",
                    );
                }
            }
        }

        let planet_artifacts_storage_address = self.internal.get_planet_artifacts_storage_address();
        let planet_artifacts_storage = PlanetArtifactsStorage::at(planet_artifacts_storage_address);
        assert(
            self.view(planet_artifacts_storage.verify_hash(location, planet_artifacts_state_hash)),
            "Planet artifacts state hash mismatch",
        );

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);
        assert(
            self.view(player_storage.verify_hash(sender, player_state_hash)),
            "Player state hash mismatch",
        );

        self.call(planet_storage.set(location, new_planet));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));
        for i in 0..20 {
            if (i < planet_event_count as u32) & (artifacts_ids[i] != 0) {
                self.call(artifact_location_storage.set(artifacts_ids[i], new_artifact_locations[i]));
            }
        }
        self.call(player_storage.set(sender, new_player));
    }

    /// Noir port of Solidity `DFCoreFacet.revealLocation`.
    #[external("private")]
    fn reveal_location(
        location: Field,
        perlin: u8,
        level: u8,
        x: Field,
        y: Field,
        timestamp: u64, // timestamp for private time-based computations
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
        planet_state: Planet,
        planet_revealed_coords: PlanetRevealedCoords,
        player_state: Player,
        world: World,
    ) {
        if !provided_snark_config.disable_zk_checks {
            // todo: implement zk checks
        }

        let sender = self.msg_sender();

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
        let planet_state_hash = if planet_state == Planet::zero() {
            0
        } else {
            poseidon2_hash(planet_state.serialize())
        };

        let planet_revealed_coords_hash = if planet_revealed_coords == PlanetRevealedCoords::zero() {
            0
        } else {
            poseidon2_hash(planet_revealed_coords.serialize())
        };

        let player_state_hash = if player_state == Player::zero() {
            0
        } else {
            poseidon2_hash(player_state.serialize())
        };

        let world_hash = if world == World::zero() {
            0
        } else {
            poseidon2_hash(world.serialize())
        };

        // Perform computation in private using the provided timestamp
        let planet_state_is_initialized: bool = planet_state != Planet::zero();
        let player_state_is_initialized: bool = player_state != Player::zero();
        let planet_revealed_coords_is_initialized: bool =
            planet_revealed_coords != PlanetRevealedCoords::zero();
        let world_is_initialized: bool = world != World::zero();

        assert(player_state_is_initialized, "Player is not valid");
        assert(!planet_revealed_coords_is_initialized, "Planet revealed coords");
        assert(world_is_initialized, "World is not valid");

        let result = if !planet_state_is_initialized {
            let mut planet: Planet = initialize_planet_with_defaults(
                location,
                perlin,
                false, // is_home_planet
                timestamp,
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

            let mut new_world = world;
            new_world.planet_events_count += 1;

            (planet, new_world, true)
        } else {
            // Planet already exists, verify timestamp is newer than planet's last_updated
            assert(
                timestamp >= planet_state.last_updated,
                "Timestamp must be >= planet's last_updated",
            );

            let mut new_planet_state = planet_state;
            new_planet_state.last_updated = timestamp;

            (new_planet_state, world, false)
        };

        let mut new_planet = result.0;
        let mut new_world = result.1;
        let mut update_world = result.2;

        assert(
            player_state.last_reveal_timestamp + world_config.location_reveal_cooldown < timestamp,
            "Wait for cooldown before revealing again",
        );

        let mut new_player_state = player_state;
        new_player_state.last_reveal_timestamp = timestamp;

        let mut new_planet_revealed_coords = planet_revealed_coords;
        new_planet_revealed_coords.location_id = location;
        new_planet_revealed_coords.x = x;
        new_planet_revealed_coords.y = y;
        new_planet_revealed_coords.revealer = sender;

        new_planet.last_updated = timestamp;
        new_player_state.last_updated = timestamp;

        // Enqueue public function call with all hashes and new states
        self.enqueue_self.reveal_location_public(
            location,
            sender,
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
            planet_state_hash,
            planet_revealed_coords_hash,
            player_state_hash,
            world_hash,
            new_planet,
            new_planet_revealed_coords,
            new_player_state,
            new_world,
            update_world,
        );
    }

    #[external("public")]
    #[only_self]
    fn reveal_location_public(
        location: Field,
        sender: AztecAddress,
        timestamp: u64,
        // Config hashes for verification
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
        // State hashes for verification
        planet_state_hash: Field,
        planet_revealed_coords_hash: Field,
        player_state_hash: Field,
        world_hash: Field,
        // Computed results to write
        new_planet: Planet,
        new_planet_revealed_coords: PlanetRevealedCoords,
        new_player_state: Player,
        new_world: World,
        update_world: bool,
    ) {
        // Verify timestamp is within a reasonable time window
        let actual_timestamp = self.context.timestamp();

        // Timestamp cannot be in the future
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");

        // Timestamp cannot be too old (e.g., 5 minutes = 300 seconds)
        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        // Verify all config hashes match on-chain config
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);

        assert(
            self.view(config.verify_snark_config_hash(snark_config_hash)),
            "Snark config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_default_stats_hash(
                new_planet.planet_level,
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

        // Verify state hashes match on-chain state
        // Planet state (may be zero if not initialized)
        if planet_state_hash != 0 {
            let planet_storage_address = self.internal.get_planet_storage_address();
            let planet_storage = PlanetStorage::at(planet_storage_address);
            assert(
                self.view(planet_storage.verify_hash(location, planet_state_hash)),
                "Planet state hash mismatch",
            );
        }

        // Planet revealed coords (should be zero/uninitialized)
        let planet_revealed_coords_storage_address =
            self.internal.get_planet_revealed_coords_storage_address();
        let planet_revealed_coords_storage =
            PlanetRevealedCoordsStorage::at(planet_revealed_coords_storage_address);
        assert(
            !self.view(planet_revealed_coords_storage.is_initialized(location)),
            "Planet already revealed",
        );

        // Player state (must be initialized)
        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);
        assert(player_state_hash != 0, "Player state must be initialized");
        assert(
            self.view(player_storage.verify_hash(sender, player_state_hash)),
            "Player state hash mismatch",
        );

        // World state (must be initialized)
        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);
        assert(world_hash != 0, "World state must be initialized");
        assert(self.view(world_storage.verify_hash(0, world_hash)), "World state hash mismatch");

        // Write verified computed states to storage
        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        self.call(planet_storage.set(location, new_planet));

        self.call(planet_revealed_coords_storage.set(location, new_planet_revealed_coords));

        self.call(player_storage.set(sender, new_player_state));

        if update_world {
            self.call(world_storage.set(0, new_world));
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
        timestamp: u64, // timestamp for private time-based computations
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
        planet_state: Planet,
        player_state: Player,
        world: World,
    ) {
        if !provided_snark_config.disable_zk_checks {
            //todo: implement zk checks
        }

        let sender = self.msg_sender();

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
        let planet_state_hash = if planet_state == Planet::zero() {
            0
        } else {
            poseidon2_hash(planet_state.serialize())
        };

        let player_state_hash = if player_state == Player::zero() {
            0
        } else {
            poseidon2_hash(player_state.serialize())
        };

        let world_hash = if world == World::zero() {
            0
        } else {
            poseidon2_hash(world.serialize())
        };

        // Perform computation in private using the provided timestamp
        let planet_state_is_initialized: bool = planet_state != Planet::zero();
        let player_state_is_initialized: bool = player_state != Player::zero();
        // todo: fix this
        // let world_is_initialized: bool = world != World::zero();

        assert(!player_state_is_initialized, "Player already initialized");
        // assert(world_is_initialized, "World is not valid");

        // check player init
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

        // Create new planet if not initialized
        let (new_planet, initialize_planet) = if !planet_state_is_initialized {
            let mut planet: Planet = initialize_planet_with_defaults(
                location_id,
                perlin,
                true, // is_home_planet
                timestamp,
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
            planet.last_updated = timestamp;

            (planet, true)
        } else {
            // Planet already exists, verify timestamp is newer than planet's last_updated
            assert(
                timestamp >= planet_state.last_updated,
                "Timestamp must be >= planet's last_updated",
            );

            let mut new_planet_state = planet_state;
            new_planet_state.last_updated = timestamp;

            (new_planet_state, false)
        };

        // Create new player
        let new_player: Player = Player {
            init_timestamp: timestamp,
            home_planet_id: location_id,
            last_reveal_timestamp: 0,
            score: 0,
            space_junk: 0,
            space_junk_limit: space_junk_config.space_junk_limit,
            claimed_ships: false,
            last_updated: timestamp,
        };

        // Update world
        let mut new_world = world;
        new_world.player_ids_count += 1;
        if initialize_planet {
            new_world.planet_ids_count += 1;
        }
        new_world = update_world_radius(new_world, world_config);

        // Enqueue public function call with all hashes and new states
        self.enqueue_self.initialize_player_public(
            sender,
            location_id,
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
            planet_state_hash,
            player_state_hash,
            world_hash,
            new_planet,
            new_player,
            new_world,
            initialize_planet,
        );
    }

    #[external("public")]
    #[only_self]
    fn initialize_player_public(
        sender: AztecAddress,
        location_id: Field,
        timestamp: u64,
        // Config hashes for verification
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
        // State hashes for verification
        planet_state_hash: Field,
        player_state_hash: Field,
        world_hash: Field,
        // Computed results to write
        new_planet: Planet,
        new_player: Player,
        new_world: World,
        initialize_planet: bool,
    ) {
        // Verify timestamp is within a reasonable time window
        let actual_timestamp = self.context.timestamp();

        // Timestamp cannot be in the future
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");

        // Timestamp cannot be too old (e.g., 5 minutes = 300 seconds)
        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        // Verify all config hashes match on-chain config
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);

        assert(
            self.view(config.verify_snark_config_hash(snark_config_hash)),
            "Snark config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_default_stats_hash(
                new_planet.planet_level,
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

        // Verify state hashes match on-chain state
        // Planet state (may be zero if not initialized)
        if planet_state_hash != 0 {
            let planet_storage_address = self.internal.get_planet_storage_address();
            let planet_storage = PlanetStorage::at(planet_storage_address);
            assert(
                self.view(planet_storage.verify_hash(location_id, planet_state_hash)),
                "Planet state hash mismatch",
            );
        }

        // Player state (should be zero/uninitialized)
        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);
        assert(!self.view(player_storage.is_initialized(sender)), "Player already initialized");

        // World state (must be initialized)
        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);
        assert(world_hash != 0, "World state must be initialized");
        assert(self.view(world_storage.verify_hash(0, world_hash)), "World state hash mismatch");

        // Write verified computed states to storage
        if initialize_planet {
            let planet_storage_address = self.internal.get_planet_storage_address();
            let planet_storage = PlanetStorage::at(planet_storage_address);
            self.call(planet_storage.set(location_id, new_planet));
        }

        self.call(player_storage.set(sender, new_player));
        self.call(world_storage.set(0, new_world));
    }
}
