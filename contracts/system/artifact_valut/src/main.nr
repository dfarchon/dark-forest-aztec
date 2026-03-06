use ::aztec::macros::aztec;

#[aztec]
contract ArtifactValut {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, only_self, view}, storage::storage},
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };
    use ::aztec::state_vars::PublicMutable;

    use ::types::args::DFTCreateArtifactArgs;
    use ::types::config::{artifacts::ArtifactsConfig, spaceships::SpaceshipsConfig};
    use ::types::storage::{
        arrival::Arrival,
        artifact::{Artifact, ArtifactLocation, ArtifactType},
        planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType},
        player::Player,
        world::World,
    };

    use ::libs::artifact_utils;
    use ::libs::batch_utils::{
        assert_refresh_timestamp_monotonicity, build_refresh_event_hashes,
        pack_artifact_location_batch, refresh_planet_and_apply_timestamp,
    };
    use ::libs::game_utils;

    use ::config::Config;

    use ::arrival_storage::ArrivalStorage;
    use ::artifact_location_storage::ArtifactLocationStorage;
    use ::artifact_storage::ArtifactStorage;
    use ::planet_artifacts_storage::PlanetArtifactsStorage;
    use ::planet_events_storage::PlanetEventsStorage;
    use ::planet_storage::PlanetStorage;
    use ::player_storage::PlayerStorage;
    use ::world_storage::WorldStorage;

    #[storage]
    struct Storage<Context> {
        /// Admin that can configure storage addresses and later perform admin-only actions.
        admin: PublicMutable<AztecAddress, Context>,

        /// Core config storage.
        config_storage_address: PublicMutable<AztecAddress, Context>,

        /// World storage (global paused flag, counts, radius, etc.).
        world_storage_address: PublicMutable<AztecAddress, Context>,

        /// Player storage.
        player_storage_address: PublicMutable<AztecAddress, Context>,

        /// Artifact storage (separated into Artifact and ArtifactLocation).
        artifact_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_location_storage_address: PublicMutable<AztecAddress, Context>,

        /// Planet storage (unified Planet struct).
        planet_storage_address: PublicMutable<AztecAddress, Context>,

        /// Planet artifacts storage (separate list of artifact IDs per planet).
        planet_artifacts_storage_address: PublicMutable<AztecAddress, Context>,

        /// Planet events storage (for refresh_planet hash verification and writes).
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,

        /// Arrivals storage (for refresh_planet hash verification).
        arrivals_storage_address: PublicMutable<AztecAddress, Context>,
    }

    // ========== Internal helpers ==========

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
    }

    /// Equivalent of Solidity DFArtifactFacet.onlyAdminOrCore:
    /// allow calls only from this contract itself (Core analogue) or the admin.
    #[internal("public")]
    fn assert_admin_or_self() {
        let sender = self.msg_sender();
        let self_addr = self.context.this_address();
        let is_self: bool = sender == self_addr;
        let is_admin: bool = sender == self.storage.admin.read();
        assert(
            ((is_self as u8) | (is_admin as u8)) != 0,
            "Only the Core or Admin addresses can fiddle with artifacts.",
        );
    }

    /// Equivalent of DFArtifactFacet.notPaused, using WorldStorage + World.paused.
    #[internal("public")]
    fn assert_not_paused(world: World) {
        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);
        let world_valid: bool = self.view(world_storage.verify(0, world));

        assert(world_valid, "World state is not valid");
        assert(!world.paused, "Game is paused");
    }

    // ========== Initializer & admin setters ==========

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

    /// Batch set all storage addresses in a single transaction.
    #[external("public")]
    fn set_all_storage_addresses(
        config_storage_address: AztecAddress,
        world_storage_address: AztecAddress,
        player_storage_address: AztecAddress,
        planet_storage_address: AztecAddress,
        planet_artifacts_storage_address: AztecAddress,
        planet_events_storage_address: AztecAddress,
        arrivals_storage_address: AztecAddress,
        artifact_storage_address: AztecAddress,
        artifact_location_storage_address: AztecAddress,
    ) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_storage_address);
        self.storage.world_storage_address.write(world_storage_address);
        self.storage.player_storage_address.write(player_storage_address);
        self.storage.planet_storage_address.write(planet_storage_address);
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_storage_address);
        self.storage.planet_events_storage_address.write(planet_events_storage_address);
        self.storage.arrivals_storage_address.write(arrivals_storage_address);
        self.storage.artifact_storage_address.write(artifact_storage_address);
        self.storage.artifact_location_storage_address.write(artifact_location_storage_address);
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
    fn set_artifact_storage_address(artifact_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.artifact_storage_address.write(artifact_storage_address);
    }

    #[external("public")]
    fn set_artifact_location_storage_address(artifact_location_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.artifact_location_storage_address.write(artifact_location_storage_address);
    }

    #[external("public")]
    fn set_planet_storage_address(planet_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_storage_address.write(planet_storage_address);
    }

    #[external("public")]
    fn set_planet_artifacts_storage_address(planet_artifacts_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_storage_address);
    }

    #[external("public")]
    fn set_planet_events_storage_address(planet_events_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_events_storage_address.write(planet_events_storage_address);
    }

    #[external("public")]
    fn set_arrivals_storage_address(arrivals_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.arrivals_storage_address.write(arrivals_storage_address);
    }

    // ========== Internal storage address getters ==========

    #[internal("public")]
    fn get_config_storage_address() -> AztecAddress {
        self.storage.config_storage_address.read()
    }

    #[internal("public")]
    fn get_player_storage_address() -> AztecAddress {
        self.storage.player_storage_address.read()
    }

    #[internal("public")]
    fn get_artifact_storage_address() -> AztecAddress {
        self.storage.artifact_storage_address.read()
    }

    #[internal("public")]
    fn get_artifact_location_storage_address() -> AztecAddress {
        self.storage.artifact_location_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_storage_address() -> AztecAddress {
        self.storage.planet_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_artifacts_storage_address() -> AztecAddress {
        self.storage.planet_artifacts_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_events_storage_address() -> AztecAddress {
        self.storage.planet_events_storage_address.read()
    }

    #[internal("public")]
    fn get_arrivals_storage_address() -> AztecAddress {
        self.storage.arrivals_storage_address.read()
    }

    #[internal("public")]
    fn get_world_storage_address() -> AztecAddress {
        self.storage.world_storage_address.read()
    }

    // ========== Basic artifact CRUD ==========

    /// Create a new artifact and persist it in ArtifactStorage and ArtifactLocationStorage.
    /// Creates both Artifact and ArtifactLocation separately.
    #[external("public")]
    fn create_artifact(args: DFTCreateArtifactArgs) {
        self.internal.assert_admin_or_self();

        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());

        let timestamp = self.context.timestamp();

        let artifact = Artifact {
            planet_discovered_on: args.planet_id,
            rarity: args.rarity,
            planet_biome: args.biome,
            minted_at_timestamp: timestamp,
            discoverer: args.discoverer,
            artifact_type: args.artifact_type,
            activations: 0,
            last_activated: 0,
            last_deactivated: 0,
            wormhole_to: 0 as Field,
            controller: args.controller,
            last_updated: timestamp,
        };

        // By default the artifact is on the planet (not in transit).
        let location =
            ArtifactLocation { planet_id: args.planet_id, voyage_id: 0, last_updated: timestamp };

        self.call(artifact_storage.set(args.id, artifact));
        self.call(location_storage.set(args.id, location));
    }

    /// Update an existing artifact and location. Caller must provide full, correct states.
    #[external("public")]
    fn update_artifact(id: Field, artifact: Artifact, location: ArtifactLocation) {
        self.internal.assert_admin_or_self();

        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());

        // L1: require(ERC721BaseStorage.layout().exists(updatedArtifact.id), "you cannot update an artifact that doesn't exist")
        let stored_root = self.view(artifact_storage.get_state_root(id));
        assert(stored_root != 0, "you cannot update an artifact that doesn't exist");

        self.call(artifact_storage.set(id, artifact));
        self.call(location_storage.set(id, location));
    }

    /// Check whether an artifact exists by comparing to zero value.
    #[external("public")]
    #[view]
    fn does_artifact_exist(id: Field, artifact: Artifact) -> bool {
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let hash = poseidon2_hash(artifact.serialize());

        // If artifact is zero, it doesn't exist
        if artifact == Artifact::zero() {
            false
        } else {
            // Verify the hash matches storage
            assert(self.view(artifact_storage.verify_hash(id, hash)), "artifact hash mismatch");
            true
        }
    }

    /// Return the stored state root (hash) for an artifact by id. L1 analogue: getArtifact returns full struct; here we only store hash so return hash.
    #[external("public")]
    #[view]
    fn get_artifact_hash(id: Field) -> Field {
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        self.view(artifact_storage.get_state_root(id))
    }

    // ========== Game Logic: Deposit / Withdraw Artifact ==========

    #[external("private")]
    fn deposit_artifact(
        location_id: Field,
        artifact_id: Field,
        planet: Planet,
        artifact: Artifact,
        artifact_location: ArtifactLocation,
        planet_artifacts: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        timestamp: u64,
        world: World,
    ) {
        let sender = self.msg_sender();

        assert_refresh_timestamp_monotonicity(
            timestamp,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts,
        );

        let (new_planet, new_planet_events, new_planet_artifacts, new_artifact_locations) = refresh_planet_and_apply_timestamp(
            timestamp,
            location_id,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts,
        );

        let (arrival_ids, arrivals_hash, artifact_ids, artifacts_hash, artifact_locations_hash) = build_refresh_event_hashes(
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );
        let planet_hash = poseidon2_hash(planet.serialize());
        let planet_artifacts_hash = poseidon2_hash(planet_artifacts.serialize());
        let planet_events_hash = if planet_events_state == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(planet_events_state.serialize())
        };

        assert(
            new_planet.planet_type == PlanetType::TradingPost(),
            "can only deposit on trading posts",
        );
        assert(new_planet.owner == sender, "you must own this planet");
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(artifact != Artifact::zero(), "artifact does not exist");
        assert(artifact_location.voyage_id == 0, "artifact in voyage");
        assert(
            new_planet.planet_level > artifact.rarity,
            "spacetime rip not high enough level to deposit this artifact",
        );
        assert(!artifact_utils::is_spaceship(artifact.artifact_type), "cannot deposit spaceships");
        assert(new_planet_artifacts.count < 5, "too many artifacts on this planet");

        let updated_artifacts = game_utils::push_artifact_id(artifact_id, new_planet_artifacts);
        let mut new_location = artifact_location;
        new_location.planet_id = location_id;
        new_location.last_updated = timestamp;

        let artifact_hash = poseidon2_hash(artifact.serialize());
        let artifact_location_hash = poseidon2_hash(artifact_location.serialize());

        self.enqueue_self.deposit_artifact_public(
            location_id,
            artifact_id,
            timestamp,
            world,
            planet_hash,
            planet_artifacts_hash,
            planet_events_hash,
            planet_events_state.count as u8,
            arrival_ids,
            arrivals_hash,
            artifact_ids,
            artifacts_hash,
            artifact_locations_hash,
            new_planet,
            new_planet_events,
            new_artifact_locations,
            artifact_hash,
            artifact_location_hash,
            updated_artifacts,
            new_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn deposit_artifact_public(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        world: World,
        planet_hash: Field,
        planet_artifacts_hash: Field,
        planet_events_hash: Field,
        planet_event_count: u8,
        arrival_ids: [Field; 20],
        arrivals_hash: [Field; 20],
        artifact_ids: [Field; 20],
        artifacts_hash: [Field; 20],
        artifact_locations_hash: [Field; 20],
        new_planet: Planet,
        new_planet_events: PlanetEvents,
        new_artifact_locations: [ArtifactLocation; 20],
        artifact_hash: Field,
        artifact_location_hash: Field,
        updated_artifacts: PlanetArtifacts,
        new_location: ArtifactLocation,
    ) {
        self.internal.assert_not_paused(world);

        let actual_timestamp = self.context.timestamp();
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");
        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let planet_events_storage =
            PlanetEventsStorage::at(self.internal.get_planet_events_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let arrival_storage = ArrivalStorage::at(self.internal.get_arrivals_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());

        assert(
            self.view(planet_storage.verify_hash(location_id, planet_hash)),
            "planet hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location_id, planet_artifacts_hash)),
            "planet_artifacts hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location_id, planet_events_hash)),
            "planet_events hash mismatch",
        );
        for i in 0..20 {
            if (i as u32) < (planet_event_count as u32) {
                if arrival_ids[i] != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_ids[i], arrivals_hash[i])),
                        "arrival hash mismatch",
                    );
                }
                if artifact_ids[i] != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifact_ids[i], artifacts_hash[i])),
                        "artifact hash mismatch",
                    );
                    assert(
                        self.view(location_storage.verify_hash(
                            artifact_ids[i],
                            artifact_locations_hash[i],
                        )),
                        "artifact_location hash mismatch",
                    );
                }
            }
        }
        assert(
            self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
            "artifact hash mismatch",
        );
        assert(
            self.view(location_storage.verify_hash(artifact_id, artifact_location_hash)),
            "artifact_location hash mismatch",
        );

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_events_storage.set(location_id, new_planet_events));
        // Batch write artifact locations (1 call instead of up to 20)
        let (batch_ids, batch_locations, batch_count) = pack_artifact_location_batch(
            artifact_ids,
            new_artifact_locations,
            planet_event_count as u32,
        );
        self.call(location_storage.set_batch(batch_ids, batch_locations, batch_count));
        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
        self.call(location_storage.set(artifact_id, new_location));
    }

    /// Withdraw an artifact from a trading post (no ERC721 transfer). L1: withdrawArtifact calls refreshPlanet first. Private: logic; public: verify + write (Move pattern).
    #[external("private")]
    fn withdraw_artifact(
        location_id: Field,
        artifact_id: Field,
        planet: Planet,
        artifact: Artifact,
        artifact_location: ArtifactLocation,
        planet_artifacts: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        timestamp: u64,
        world: World,
    ) {
        let sender = self.msg_sender();

        assert_refresh_timestamp_monotonicity(
            timestamp,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts,
        );

        let (new_planet, new_planet_events, new_planet_artifacts, new_artifact_locations) = refresh_planet_and_apply_timestamp(
            timestamp,
            location_id,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts,
        );

        let (arrival_ids, arrivals_hash, artifact_ids, artifacts_hash, artifact_locations_hash) = build_refresh_event_hashes(
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );
        let planet_hash = poseidon2_hash(planet.serialize());
        let planet_artifacts_hash = poseidon2_hash(planet_artifacts.serialize());
        let planet_events_hash = if planet_events_state == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(planet_events_state.serialize())
        };

        assert(
            new_planet.planet_type == PlanetType::TradingPost(),
            "can only withdraw from trading posts",
        );
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(new_planet.owner == sender, "you can only withdraw from a planet you own");
        assert(artifact != Artifact::zero(), "artifact does not exist");
        assert(artifact_location.planet_id == location_id, "artifact not on this planet");
        assert(new_planet.planet_level > artifact.rarity, "spacetime rip not high enough level");
        assert(!artifact_utils::is_spaceship(artifact.artifact_type), "cannot withdraw spaceships");

        let updated_artifacts = game_utils::remove_artifact_id(artifact_id, new_planet_artifacts);
        let mut new_location = artifact_location;
        new_location.planet_id = 0;
        new_location.last_updated = timestamp;

        let artifact_hash = poseidon2_hash(artifact.serialize());
        let artifact_location_hash = poseidon2_hash(artifact_location.serialize());

        self.enqueue_self.withdraw_artifact_public(
            location_id,
            artifact_id,
            timestamp,
            world,
            planet_hash,
            planet_artifacts_hash,
            planet_events_hash,
            planet_events_state.count as u8,
            arrival_ids,
            arrivals_hash,
            artifact_ids,
            artifacts_hash,
            artifact_locations_hash,
            new_planet,
            new_planet_events,
            new_artifact_locations,
            artifact_hash,
            artifact_location_hash,
            updated_artifacts,
            new_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn withdraw_artifact_public(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        world: World,
        planet_hash: Field,
        planet_artifacts_hash: Field,
        planet_events_hash: Field,
        planet_event_count: u8,
        arrival_ids: [Field; 20],
        arrivals_hash: [Field; 20],
        artifact_ids: [Field; 20],
        artifacts_hash: [Field; 20],
        artifact_locations_hash: [Field; 20],
        new_planet: Planet,
        new_planet_events: PlanetEvents,
        new_artifact_locations: [ArtifactLocation; 20],
        artifact_hash: Field,
        artifact_location_hash: Field,
        updated_artifacts: PlanetArtifacts,
        new_location: ArtifactLocation,
    ) {
        self.internal.assert_not_paused(world);

        let actual_timestamp = self.context.timestamp();
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");
        let max_time_drift: u64 = 300;
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let planet_events_storage =
            PlanetEventsStorage::at(self.internal.get_planet_events_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let arrival_storage = ArrivalStorage::at(self.internal.get_arrivals_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());

        assert(
            self.view(planet_storage.verify_hash(location_id, planet_hash)),
            "planet hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location_id, planet_artifacts_hash)),
            "planet_artifacts hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location_id, planet_events_hash)),
            "planet_events hash mismatch",
        );
        for i in 0..20 {
            if (i as u32) < (planet_event_count as u32) {
                if arrival_ids[i] != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_ids[i], arrivals_hash[i])),
                        "arrival hash mismatch",
                    );
                }
                if artifact_ids[i] != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifact_ids[i], artifacts_hash[i])),
                        "artifact hash mismatch",
                    );
                    assert(
                        self.view(location_storage.verify_hash(
                            artifact_ids[i],
                            artifact_locations_hash[i],
                        )),
                        "artifact_location hash mismatch",
                    );
                }
            }
        }
        assert(
            self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
            "artifact hash mismatch",
        );
        assert(
            self.view(location_storage.verify_hash(artifact_id, artifact_location_hash)),
            "artifact_location hash mismatch",
        );

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_events_storage.set(location_id, new_planet_events));
        // Batch write artifact locations (1 call instead of up to 20)
        let (batch_ids, batch_locations, batch_count) = pack_artifact_location_batch(
            artifact_ids,
            new_artifact_locations,
            planet_event_count as u32,
        );
        self.call(location_storage.set_batch(batch_ids, batch_locations, batch_count));
        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
        self.call(location_storage.set(artifact_id, new_location));
    }

    // ========== Game Logic: Spaceships & Admin ==========

    /// Give spaceships to player on their home planet (one-time claim). Private: logic with config as param; public: verify + create_artifact loop + write (Move pattern).
    #[external("private")]
    fn give_space_ships(
        location_id: Field,
        planet: Planet,
        player: Player,
        planet_artifacts: PlanetArtifacts,
        spaceships_config: SpaceshipsConfig,
    ) {
        let sender = self.msg_sender();

        assert(!player.claimed_ships, "player already claimed ships");
        assert(planet.owner == sender, "you can only spawn ships on your home planet");
        assert(planet.is_home_planet, "you can only spawn ships on your home planet");

        let create_args_zero = DFTCreateArtifactArgs {
            id: 0,
            planet_id: 0,
            rarity: 0,
            biome: 0,
            artifact_type: 0,
            discoverer: AztecAddress::zero(),
            controller: AztecAddress::zero(),
        };

        let mut updated_artifacts = planet_artifacts;
        let mut nonce: u32 = 0;

        let (id0, args0) = if spaceships_config.mothership {
            let (aid, a) =
                artifact_utils::create_and_place_spaceship(location_id, sender, 10, nonce);
            nonce += 1;
            updated_artifacts = game_utils::push_artifact_id(aid, updated_artifacts);
            (aid, a)
        } else {
            (0, create_args_zero)
        };

        let (id1, args1) = if spaceships_config.crescent {
            let (aid, a) =
                artifact_utils::create_and_place_spaceship(location_id, sender, 11, nonce);
            nonce += 1;
            updated_artifacts = game_utils::push_artifact_id(aid, updated_artifacts);
            (aid, a)
        } else {
            (0, create_args_zero)
        };

        let (id2, args2) = if spaceships_config.whale {
            let (aid, a) =
                artifact_utils::create_and_place_spaceship(location_id, sender, 12, nonce);
            nonce += 1;
            updated_artifacts = game_utils::push_artifact_id(aid, updated_artifacts);
            (aid, a)
        } else {
            (0, create_args_zero)
        };

        let (id3, args3) = if spaceships_config.gear {
            let (aid, a) =
                artifact_utils::create_and_place_spaceship(location_id, sender, 13, nonce);
            nonce += 1;
            updated_artifacts = game_utils::push_artifact_id(aid, updated_artifacts);
            (aid, a)
        } else {
            (0, create_args_zero)
        };

        let (id4, args4) = if spaceships_config.titan {
            let (aid, a) =
                artifact_utils::create_and_place_spaceship(location_id, sender, 14, nonce);
            updated_artifacts = game_utils::push_artifact_id(aid, updated_artifacts);
            (aid, a)
        } else {
            (0, create_args_zero)
        };

        let mut new_player = player;
        new_player.claimed_ships = true;

        let planet_hash = poseidon2_hash(planet.serialize());
        let player_hash = poseidon2_hash(player.serialize());
        let planet_artifacts_hash = poseidon2_hash(planet_artifacts.serialize());

        self.enqueue_self.give_space_ships_public(
            sender,
            location_id,
            planet_hash,
            player_hash,
            planet_artifacts_hash,
            updated_artifacts,
            new_player,
            [args0, args1, args2, args3, args4],
            [id0, id1, id2, id3, id4],
        );
    }

    #[external("public")]
    #[only_self]
    fn give_space_ships_public(
        sender: AztecAddress,
        location_id: Field,
        planet_hash: Field,
        player_hash: Field,
        planet_artifacts_hash: Field,
        updated_artifacts: PlanetArtifacts,
        new_player: Player,
        create_args_list: [DFTCreateArtifactArgs; 5],
        artifact_ids: [Field; 5],
    ) {
        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let player_storage = PlayerStorage::at(self.internal.get_player_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());

        assert(
            self.view(planet_storage.verify_hash(location_id, planet_hash)),
            "planet hash mismatch",
        );
        assert(self.view(player_storage.verify_hash(sender, player_hash)), "player hash mismatch");
        assert(
            self.view(planet_artifacts_storage.verify_hash(location_id, planet_artifacts_hash)),
            "planet_artifacts hash mismatch",
        );

        let manager = ArtifactValut::at(self.context.this_address());
        for i in 0..5 {
            if artifact_ids[i] != 0 {
                self.call(manager.create_artifact(create_args_list[i]));
            }
        }

        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
        self.call(player_storage.set(sender, new_player));
    }

    /// Admin function: Create and place an artifact on a planet.
    /// Ported from DFArtifactFacet.adminGiveArtifact (no ERC721).
    #[external("public")]
    fn admin_give_artifact(args: DFTCreateArtifactArgs, planet_artifacts: PlanetArtifacts) {
        self.internal.assert_admin();

        // Verify planet artifacts state
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        assert(
            self.view(planet_artifacts_storage.verify_hash(
                args.planet_id,
                poseidon2_hash(planet_artifacts.serialize()),
            )),
            "planet_artifacts hash mismatch",
        );

        // Create artifact
        self.call(ArtifactValut::at(self.context.this_address()).create_artifact(args));

        // Add to planet artifacts (LibGameUtils port)
        let updated_artifacts = game_utils::push_artifact_id(args.id, planet_artifacts);
        self.call(planet_artifacts_storage.set(args.planet_id, updated_artifacts));
    }
}
