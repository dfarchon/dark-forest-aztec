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

    use ::libs::batch_utils::{
        assert_planet_timestamp_freshness, assert_public_timestamp, compute_config_hashes,
        compute_planet_hashes, compute_planet_revealed_coords_hash, compute_planet_state_hash,
        compute_player_hash, compute_world_hash,
    };
    use ::libs::game_utils::{_buff_planet, revert_if_bad_snark_perlin_flags};

    use ::libs::planet::{
        check_player_init, initialize_planet_with_defaults, refresh_planet_v1,
        validate_upgrade_planet,
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
    fn refresh_planet(
        location: Field,
        planet: Planet,
        planet_artifacts_state: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        timestamp: u64,
    ) {
        assert_planet_timestamp_freshness(
            timestamp,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let planet_is_initialized: bool = planet != Planet::zero();
        assert(planet_is_initialized, "Planet is not initialized");

        let (_, planet_state_hash, planet_artifacts_state_hash, planet_events_state_hash, arrival_ids, arrival_hashes, arrival_artifact_ids, arrival_artifact_hashes, arrival_artifact_location_hashes, original_arrivals_count) = compute_planet_hashes(
            location,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let res = refresh_planet_v1(
            timestamp,
            location,
            planet,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = res.0;
        let mut new_planet_events_state = res.1;
        let mut new_planet_artifacts_state = res.2;
        let mut new_arrival_artifact_locations = res.3;

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;

        for i in 0..20 {
            if arrivals[i].carried_artifact_id != 0 {
                new_arrival_artifact_locations[i].last_updated = timestamp;
            }
        }

        self.enqueue_self.refresh_planet_public(
            location,
            timestamp,
            planet_state_hash,
            planet_artifacts_state_hash,
            planet_events_state_hash,
            original_arrivals_count,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            new_planet,
            new_planet_artifacts_state,
            new_planet_events_state,
            new_arrival_artifact_locations,
        );
    }

    #[external("public")]
    #[only_self]
    fn refresh_planet_public(
        location: Field,
        timestamp: u64,
        planet_state_hash: Field,
        planet_artifacts_state_hash: Field,
        planet_events_state_hash: Field,
        original_arrivals_count: u32,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        new_planet: Planet,
        new_planet_artifacts_state: PlanetArtifacts,
        new_planet_events_state: PlanetEvents,
        new_arrival_artifact_locations: [ArtifactLocation; 20],
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());

        assert(
            self.view(planet_storage.verify_hash(location, planet_state_hash)),
            "Planet state hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location, planet_artifacts_state_hash)),
            "Planet artifacts state hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location, planet_events_state_hash)),
            "Planet events state hash mismatch",
        );

        assert(
            self.view(arrival_storage.verify_hashes_batch(
                arrival_ids,
                arrival_hashes,
                original_arrivals_count,
            )),
            "Arrival hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_hashes,
                original_arrivals_count,
            )),
            "Artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_location_hashes,
                original_arrivals_count,
            )),
            "Artifact location hash mismatch",
        );

        self.call(planet_storage.set(location, new_planet));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            arrival_artifact_ids,
            new_arrival_artifact_locations,
            original_arrivals_count,
        ));
    }

    #[external("private")]
    fn upgrade_planet(
        location: Field,
        branch: u8,
        timestamp: u64,
        upgrade_config: UpgradeConfig,
        upgrade: Upgrade,
        planet_state: Planet,
        planet_artifacts_state: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        world: World,
    ) {
        let sender = self.msg_sender();
        assert(!world.paused, "Game is paused");

        assert(planet_state != Planet::zero(), "Planet is not initialized");
        assert_planet_timestamp_freshness(
            timestamp,
            planet_state,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let (_, planet_state_hash, planet_artifacts_state_hash, planet_events_state_hash, arrival_ids, arrival_hashes, arrival_artifact_ids, arrival_artifact_hashes, arrival_artifact_location_hashes, original_arrivals_count) = compute_planet_hashes(
            location,
            planet_state,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let upgrade_config_hash = poseidon2_hash(upgrade_config.serialize());
        let upgrade_hash = poseidon2_hash(upgrade.serialize());
        let world_hash = compute_world_hash(world);

        let refreshed_states = refresh_planet_v1(
            timestamp,
            location,
            planet_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = refreshed_states.0;
        let mut new_planet_events_state = refreshed_states.1;
        let mut new_planet_artifacts_state = refreshed_states.2;
        let mut new_arrival_artifact_locations = refreshed_states.3;

        let (current_branch_level, silver_cost) =
            validate_upgrade_planet(new_planet, branch, sender, upgrade_config);

        new_planet.silver -= silver_cost;
        if branch == UpgradeBranch::Defense {
            new_planet.upgrade_state_0 += 1;
        } else if branch == UpgradeBranch::Range {
            new_planet.upgrade_state_1 += 1;
        } else {
            new_planet.upgrade_state_2 += 1;
        }

        let buff_planet_result = _buff_planet(location, new_planet, upgrade);
        new_planet = buff_planet_result.1;
        new_planet.last_updated = timestamp;

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < original_arrivals_count & (arrivals[i].carried_artifact_id != 0) {
                new_arrival_artifact_locations[i].last_updated = timestamp;
            }
        }

        self.enqueue_self.upgrade_planet_public(
            location,
            sender,
            branch,
            current_branch_level,
            timestamp,
            planet_state_hash,
            planet_artifacts_state_hash,
            planet_events_state_hash,
            original_arrivals_count,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            upgrade_config_hash,
            upgrade_hash,
            world_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_arrival_artifact_locations,
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
        planet_artifacts_state_hash: Field,
        planet_events_state_hash: Field,
        original_arrivals_count: u32,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        upgrade_config_hash: Field,
        upgrade_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_arrival_artifact_locations: [ArtifactLocation; 20],
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let config = Config::at(self.storage.config_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());

        assert(
            self.view(planet_storage.verify_hash(location, planet_state_hash)),
            "Planet state hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location, planet_artifacts_state_hash)),
            "Planet artifacts state hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location, planet_events_state_hash)),
            "Planet events state hash mismatch",
        );

        assert(
            self.view(arrival_storage.verify_hashes_batch(
                arrival_ids,
                arrival_hashes,
                original_arrivals_count,
            )),
            "Arrival hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_hashes,
                original_arrivals_count,
            )),
            "Artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_location_hashes,
                original_arrivals_count,
            )),
            "Artifact location hash mismatch",
        );

        assert(
            self.view(config.verify_upgrade_config_hash(upgrade_config_hash)),
            "Upgrade config hash mismatch",
        );

        assert(
            self.view(config.verify_upgrade_hash_by_branch_level(
                branch as u128,
                current_branch_level as u128,
                upgrade_hash,
            )),
            "Upgrade hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "World state hash mismatch");

        assert(new_planet.owner == sender, "Planet owner mismatch");
        self.call(planet_storage.set(location, new_planet));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            arrival_artifact_ids,
            new_arrival_artifact_locations,
            original_arrivals_count,
        ));
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
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        player_state: Player,
        world: World,
    ) {
        let sender = self.msg_sender();
        assert(!world.paused, "Game is paused");

        assert(planet_state != Planet::zero(), "Planet is not initialized");
        assert(player_state != Player::zero(), "Player is not initialized");
        assert(
            timestamp >= player_state.last_updated,
            "Timestamp must be >= player's last_updated",
        );
        assert_planet_timestamp_freshness(
            timestamp,
            planet_state,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let (_, planet_state_hash, planet_artifacts_state_hash, planet_events_state_hash, arrival_ids, arrival_hashes, arrival_artifact_ids, arrival_artifact_hashes, arrival_artifact_location_hashes, original_arrivals_count) = compute_planet_hashes(
            location,
            planet_state,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let player_state_hash = compute_player_hash(player_state);
        let world_config_hash = poseidon2_hash(world_config.serialize());
        let world_hash = compute_world_hash(world);

        let refreshed_states = refresh_planet_v1(
            timestamp,
            location,
            planet_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = refreshed_states.0;
        let mut new_planet_events_state = refreshed_states.1;
        let mut new_planet_artifacts_state = refreshed_states.2;
        let mut new_arrival_artifact_locations = refreshed_states.3;

        assert(new_planet.owner == sender, "Only owner can withdraw");
        assert(
            new_planet.planet_type == PlanetType::TradingPost,
            "Only trading posts can withdraw",
        );
        assert(!new_planet.destroyed, "Planet is destroyed");
        assert(silver_to_withdraw > 0, "Must withdraw positive silver");
        assert(new_planet.silver >= silver_to_withdraw, "Not enough silver");

        new_planet.silver -= silver_to_withdraw;

        // Energy and Silver are not stored as floats in the smart contracts,
        // so any of those values coming from the contracts need to be divided by
        // `CONTRACT_PRECISION` to get their true integer value.
        let score: u128 = ((silver_to_withdraw / 1000) * world_config.silver_score_value) / 100;
        let mut new_player = player_state;
        new_player.score += score;

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < original_arrivals_count & (arrivals[i].carried_artifact_id != 0) {
                new_arrival_artifact_locations[i].last_updated = timestamp;
            }
        }
        new_player.last_updated = timestamp;

        self.enqueue_self.withdraw_silver_public(
            location,
            sender,
            timestamp,
            planet_state_hash,
            planet_artifacts_state_hash,
            planet_events_state_hash,
            original_arrivals_count,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            player_state_hash,
            world_config_hash,
            world_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_arrival_artifact_locations,
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
        planet_artifacts_state_hash: Field,
        planet_events_state_hash: Field,
        original_arrivals_count: u32,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        player_state_hash: Field,
        world_config_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_arrival_artifact_locations: [ArtifactLocation; 20],
        new_player: Player,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let config = Config::at(self.storage.config_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let player_storage = PlayerStorage::at(self.storage.player_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());

        assert(
            self.view(config.verify_world_config_hash(world_config_hash)),
            "World config hash mismatch",
        );

        assert(
            self.view(planet_storage.verify_hash(location, planet_state_hash)),
            "Planet state hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location, planet_artifacts_state_hash)),
            "Planet artifacts state hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location, planet_events_state_hash)),
            "Planet events state hash mismatch",
        );

        assert(
            self.view(arrival_storage.verify_hashes_batch(
                arrival_ids,
                arrival_hashes,
                original_arrivals_count,
            )),
            "Arrival hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_hashes,
                original_arrivals_count,
            )),
            "Artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_location_hashes,
                original_arrivals_count,
            )),
            "Artifact location hash mismatch",
        );

        assert(
            self.view(player_storage.verify_hash(sender, player_state_hash)),
            "Player state hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "World state hash mismatch");

        self.call(planet_storage.set(location, new_planet));
        self.call(planet_events_storage.set(location, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location, new_planet_artifacts_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            arrival_artifact_ids,
            new_arrival_artifact_locations,
            original_arrivals_count,
        ));
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
        is_admin: bool,
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
            let planet_hash_key = provided_snark_config.planethash_key as Field;
            let space_type_key = provided_snark_config.spacetype_key as Field;
            let scale = provided_snark_config.perlin_length_scale;
            let (expected_hash, expected_perlin) = circuits::reveal::reveal_proof(
                x,
                y,
                planet_hash_key,
                space_type_key,
                scale,
                provided_snark_config.perlin_mirror_x,
                provided_snark_config.perlin_mirror_y,
            );
            assert(expected_hash == location, "Reveal proof: location hash mismatch");
            assert(expected_perlin == perlin, "Reveal proof: perlin mismatch");
        }

        let sender = self.msg_sender();
        assert(!world.paused, "Game is paused");

        let (planet_default_stats_hash, config_hashes) = compute_config_hashes(
            provided_snark_config,
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

        // Compute state hashes for public verification
        let planet_state_hash = compute_planet_state_hash(planet_state);
        let planet_revealed_coords_hash =
            compute_planet_revealed_coords_hash(planet_revealed_coords);
        let player_state_hash = compute_player_hash(player_state);
        let world_hash = compute_world_hash(world);

        // Perform computation in private using the provided timestamp
        let planet_state_is_initialized: bool = planet_state != Planet::zero();
        let player_state_is_initialized: bool = player_state != Player::zero();
        let planet_revealed_coords_is_initialized: bool =
            planet_revealed_coords != PlanetRevealedCoords::zero();
        let world_is_initialized: bool = world != World::zero();

        assert(player_state_is_initialized, "Player is not valid");
        assert(!planet_revealed_coords_is_initialized, "Planet revealed coords");
        assert(world_is_initialized, "World is not valid");

        let mut new_planet = if !planet_state_is_initialized {
            initialize_planet_with_defaults(
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
            )
        } else {
            assert(
                timestamp >= planet_state.last_updated,
                "Timestamp must be >= planet's last_updated",
            );

            let mut new_planet_state = planet_state;
            new_planet_state.last_updated = timestamp;

            new_planet_state
        };

        if !is_admin {
            assert(
                player_state.last_reveal_timestamp + world_config.location_reveal_cooldown
                    < timestamp,
                "Wait for cooldown before revealing again",
            );
        }

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
            is_admin,
            config_hashes,
            planet_default_stats_hash,
            planet_state_hash,
            planet_revealed_coords_hash,
            player_state_hash,
            world_hash,
            new_planet,
            new_planet_revealed_coords,
            new_player_state,
        );
    }

    #[external("public")]
    #[only_self]
    fn reveal_location_public(
        location: Field,
        sender: AztecAddress,
        timestamp: u64,
        is_admin: bool,
        config_hashes: [Field; 9],
        planet_default_stats_hash: Field,
        planet_state_hash: Field,
        planet_revealed_coords_hash: Field,
        player_state_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_revealed_coords: PlanetRevealedCoords,
        new_player_state: Player,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        if is_admin {
            assert(sender == self.storage.admin.read(), "Only admin can bypass cooldown");
        }

        let config = Config::at(self.storage.config_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let player_storage = PlayerStorage::at(self.storage.player_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_revealed_coords_storage = PlanetRevealedCoordsStorage::at(self
            .storage
            .planet_revealed_coords_storage_address
            .read());

        assert(
            self.view(config.verify_config_hashes(
                new_planet.planet_level,
                planet_default_stats_hash,
                config_hashes,
            )),
            "Config hash mismatch",
        );

        if planet_state_hash != 0 {
            assert(
                self.view(planet_storage.verify_hash(location, planet_state_hash)),
                "Planet state hash mismatch",
            );
        }

        assert(
            !self.view(planet_revealed_coords_storage.is_initialized(location)),
            "Planet already revealed",
        );

        assert(player_state_hash != 0, "Player state must be initialized");
        assert(
            self.view(player_storage.verify_hash(sender, player_state_hash)),
            "Player state hash mismatch",
        );

        assert(world_hash != 0, "World state must be initialized");
        assert(self.view(world_storage.verify_hash(0, world_hash)), "World state hash mismatch");

        self.call(planet_storage.set(location, new_planet));
        self.call(planet_revealed_coords_storage.set(location, new_planet_revealed_coords));
        self.call(player_storage.set(sender, new_player_state));
    }

    /// Noir port of Solidity `DFCoreFacet.initializePlayer`.
    #[external("private")]
    fn initialize_player(
        x: Field,
        y: Field,
        radius: u128,
        location_id: Field,
        perlin: u8,
        level: u8,
        timestamp: u64,
        // Config inputs
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
        // Planet state inputs (zeros when planet does not yet exist)
        planet_state: Planet,
        planet_events_state: PlanetEvents,
        planet_artifacts_state: PlanetArtifacts,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        // Player & world state inputs
        player_state: Player,
        world: World,
    ) {
        // 1. ZK proof verification
        if !provided_snark_config.disable_zk_checks {
            let planet_hash_key = provided_snark_config.planethash_key as Field;
            let space_type_key = provided_snark_config.spacetype_key as Field;
            let scale = provided_snark_config.perlin_length_scale;
            let (expected_hash, expected_perlin) = circuits::init::init_proof(
                radius as Field,
                planet_hash_key,
                space_type_key,
                scale,
                provided_snark_config.perlin_mirror_x,
                provided_snark_config.perlin_mirror_y,
                x,
                y,
            );
            assert(expected_hash == location_id, "Init proof: location hash mismatch");
            assert(expected_perlin == perlin, "Init proof: perlin mismatch");
        }

        // 2. Basic assertions
        let sender = self.msg_sender();
        assert(!world.paused, "Game is paused");
        assert(player_state == Player::zero(), "Player already initialized");
        assert(
            check_player_init(
                location_id,
                perlin,
                radius,
                sender,
                player_state,
                world,
                game_config_core,
                world_config,
            ),
            "Player init is not valid",
        );

        // 3. Compute config hashes
        let (planet_default_stats_hash, config_hashes) = compute_config_hashes(
            provided_snark_config,
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

        // 4. Compute state hashes
        let planet_state_hash = compute_planet_state_hash(planet_state);
        let player_state_hash = compute_player_hash(player_state);
        let world_hash = compute_world_hash(world);

        // 5. Planet: create new or refresh existing
        let planet_is_new = planet_state == Planet::zero();

        let mut planet_artifacts_state_hash: Field = 0;
        let mut planet_events_state_hash: Field = 0;
        let mut arrival_ids: [Field; 20] = [0; 20];
        let mut arrival_hashes: [Field; 20] = [0; 20];
        let mut arrival_artifact_ids: [Field; 20] = [0; 20];
        let mut arrival_artifact_hashes: [Field; 20] = [0; 20];
        let mut arrival_artifact_location_hashes: [Field; 20] = [0; 20];
        let mut original_arrivals_count: u32 = 0;
        let mut new_planet_events_state = PlanetEvents::zero();
        let mut new_planet_artifacts_state = PlanetArtifacts::zero();
        let mut new_arrival_artifact_locations: [ArtifactLocation; 20] =
            [ArtifactLocation::zero(); 20];

        let new_planet = if planet_is_new {
            let mut planet = initialize_planet_with_defaults(
                location_id,
                perlin,
                true,
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
            planet
        } else {
            // Existing planet: validate timestamps, compute hashes, refresh
            assert_planet_timestamp_freshness(
                timestamp,
                planet_state,
                planet_artifacts_state,
                planet_events_state,
                arrivals,
                arrival_artifacts,
                arrival_artifact_locations,
            );

            let (_, _, pa_hash, pe_hash, a_ids, a_hashes, aa_ids, aa_hashes, aal_hashes, arr_count)
                 = compute_planet_hashes(
                    location_id,
                    planet_state,
                    planet_artifacts_state,
                    planet_events_state,
                    arrivals,
                    arrival_artifacts,
                    arrival_artifact_locations,
                );
            planet_artifacts_state_hash = pa_hash;
            planet_events_state_hash = pe_hash;
            arrival_ids = a_ids;
            arrival_hashes = a_hashes;
            arrival_artifact_ids = aa_ids;
            arrival_artifact_hashes = aa_hashes;
            arrival_artifact_location_hashes = aal_hashes;
            original_arrivals_count = arr_count;

            let refreshed = refresh_planet_v1(
                timestamp,
                location_id,
                planet_state,
                planet_events_state,
                arrivals,
                arrival_artifacts,
                arrival_artifact_locations,
                planet_artifacts_state,
            );

            let mut refreshed_planet = refreshed.0;
            new_planet_events_state = refreshed.1;
            new_planet_artifacts_state = refreshed.2;
            new_arrival_artifact_locations = refreshed.3;

            refreshed_planet.last_updated = timestamp;
            new_planet_events_state.last_updated = timestamp;
            new_planet_artifacts_state.last_updated = timestamp;
            for i in 0..20 {
                if i < original_arrivals_count & (arrivals[i].carried_artifact_id != 0) {
                    new_arrival_artifact_locations[i].last_updated = timestamp;
                }
            }

            refreshed_planet
        };

        // 6. Create new player
        let new_player = Player {
            init_timestamp: timestamp,
            home_planet_id: location_id,
            last_reveal_timestamp: 0,
            score: 0,
            space_junk: 0,
            space_junk_limit: space_junk_config.space_junk_limit,
            claimed_ships: false,
            last_updated: timestamp,
        };

        // 7. Enqueue public verification and writes
        self.enqueue_self.initialize_player_public(
            sender,
            location_id,
            timestamp,
            config_hashes,
            planet_default_stats_hash,
            planet_state_hash,
            planet_artifacts_state_hash,
            planet_events_state_hash,
            original_arrivals_count,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            player_state_hash,
            world_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_arrival_artifact_locations,
            new_player,
        );
    }

    #[external("public")]
    #[only_self]
    fn initialize_player_public(
        sender: AztecAddress,
        location_id: Field,
        timestamp: u64,
        config_hashes: [Field; 9],
        planet_default_stats_hash: Field,
        planet_state_hash: Field,
        planet_artifacts_state_hash: Field,
        planet_events_state_hash: Field,
        original_arrivals_count: u32,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        player_state_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_arrival_artifact_locations: [ArtifactLocation; 20],
        new_player: Player,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let config = Config::at(self.storage.config_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let player_storage = PlayerStorage::at(self.storage.player_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());

        // Verify config hashes
        assert(
            self.view(config.verify_config_hashes(
                new_planet.planet_level,
                planet_default_stats_hash,
                config_hashes,
            )),
            "Config hash mismatch",
        );

        // Verify player not yet initialized
        assert(!self.view(player_storage.is_initialized(sender)), "Player already initialized");

        // Verify world state
        assert(world_hash != 0, "World state must be initialized");
        assert(self.view(world_storage.verify_hash(0, world_hash)), "World state hash mismatch");

        // Planet: verify hashes and write states
        if planet_state_hash == 0 {
            // New planet - just write it
            self.call(planet_storage.set(location_id, new_planet));
        } else {
            // Existing planet - verify all hashes then write refreshed states
            let planet_artifacts_storage =
                PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
            let planet_events_storage =
                PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
            let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
            let artifact_storage =
                ArtifactStorage::at(self.storage.artifact_storage_address.read());
            let artifact_location_storage =
                ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());

            assert(
                self.view(planet_storage.verify_hash(location_id, planet_state_hash)),
                "Planet state hash mismatch",
            );
            assert(
                self.view(planet_artifacts_storage.verify_hash(
                    location_id,
                    planet_artifacts_state_hash,
                )),
                "Planet artifacts state hash mismatch",
            );
            assert(
                self.view(planet_events_storage.verify_hash(location_id, planet_events_state_hash)),
                "Planet events state hash mismatch",
            );
            assert(
                self.view(arrival_storage.verify_hashes_batch(
                    arrival_ids,
                    arrival_hashes,
                    original_arrivals_count,
                )),
                "Arrival hash mismatch",
            );
            assert(
                self.view(artifact_storage.verify_hashes_batch(
                    arrival_artifact_ids,
                    arrival_artifact_hashes,
                    original_arrivals_count,
                )),
                "Artifact hash mismatch",
            );
            assert(
                self.view(artifact_location_storage.verify_hashes_batch(
                    arrival_artifact_ids,
                    arrival_artifact_location_hashes,
                    original_arrivals_count,
                )),
                "Artifact location hash mismatch",
            );

            self.call(planet_storage.set(location_id, new_planet));
            self.call(planet_events_storage.set(location_id, new_planet_events_state));
            self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));
            self.call(artifact_location_storage.set_arrival_locations_max20(
                arrival_artifact_ids,
                new_arrival_artifact_locations,
                original_arrivals_count,
            ));
        }

        // Write new player
        self.call(player_storage.set(sender, new_player));
    }
}
