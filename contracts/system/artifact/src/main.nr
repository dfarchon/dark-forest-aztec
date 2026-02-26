use ::aztec::macros::aztec;

/// Artifact system contract. Storage addresses (same pattern as core/admin), CRUD, prospect/find/deposit/withdraw/activate/deactivate, spaceships & admin.
#[aztec]
contract ArtifactSystem {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, only_self, view}, storage::storage},
        oracle::block_header::get_block_header_at,
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::{Hash, Serialize}},
    };
    use ::aztec::state_vars::PublicMutable;

    use ::types::args::{DFPFindArtifactArgs, DFTCreateArtifactArgs};
    use ::types::config::{
        artifacts::ArtifactsConfig, default_stats::PlanetDefaultStats, game::GameConfigCore,
        snark::SnarkConfig, spaceships::SpaceshipsConfig, world::WorldConfig,
    };
    use ::types::storage::{
        arrival::Arrival,
        artifact::{Artifact, ArtifactLocation, ArtifactType},
        planet::{Biome, Planet, PlanetArtifacts, PlanetEvents, PlanetType},
        player::Player,
        world::World,
    };

    use ::libs::artifact_utils;
    use ::libs::game_utils;
    use ::libs::planet::{
        self, assert_refresh_timestamp_monotonicity, build_refresh_event_hashes,
        refresh_planet_and_apply_timestamp,
    };

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

    /// Verify hashes of refresh inputs (planet, planet_artifacts, planet_events, arrivals, artifacts, artifact_locations)
    /// then write refreshed state to storage. Shared by prospect_planet, deposit/withdraw/activate/deactivate_artifact.
    #[internal("public")]
    fn verify_refresh_hashes_and_write(
        location_id: Field,
        planet: Planet,
        planet_artifacts: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        new_planet: Planet,
        new_planet_events: PlanetEvents,
        new_planet_artifacts: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
    ) {
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
            if (i as u32) < planet_events_state.count {
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

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_events_storage.set(location_id, new_planet_events));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts));
        for i in 0..20 {
            if (i < planet_events_state.count as u32) & (artifact_ids[i] != 0) {
                self.call(location_storage.set(artifact_ids[i], new_artifact_locations[i]));
            }
        }
    }

    // ========== Game Logic: Prospect Planet ==========

    /// Prospect a planet for artifacts. L1: prospectPlanet calls refreshPlanet first. Same pattern as find_artifact.
    #[external("public")]
    fn prospect_planet(
        location_id: Field,
        planet: Planet,
        planet_artifacts: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_artifacts: [Artifact; 20],
        timestamp: u64,
        world: World,
    ) {
        let sender = self.msg_sender();

        // notPaused
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "Timestamp cannot be in the future");
        assert(ts - timestamp <= 300, "Timestamp too old");
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
        let new_planet_artifacts_artifacts = artifact_utils::build_planet_artifacts_artifacts_after_refresh(
            new_planet_artifacts,
            planet_artifacts,
            planet_artifacts_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            location_id,
        );

        self.internal.verify_refresh_hashes_and_write(
            location_id,
            planet,
            planet_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            new_planet,
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
        );

        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let config_storage = Config::at(self.internal.get_config_storage_address());
        let spaceships_config = self.view(config_storage.get_spaceships_config());
        let has_gear = game_utils::contains_gear_ship(
            sender,
            new_planet_artifacts,
            new_planet_artifacts_artifacts,
        );
        let prospect_planet = artifact_utils::prospect_planet_logic(
            new_planet,
            self.context.block_number(),
            ts,
            sender,
            spaceships_config.gear,
            has_gear,
        );
        self.call(planet_storage.set(location_id, prospect_planet));
    }

    // ========== Game Logic: Find Artifact ==========

    /// Private entry for finding an artifact on a prospected ruins planet.
    /// Same pattern as move: caller passes refresh params (from events), we call refresh_planet
    /// internally then run find logic on refreshed state. L1: findArtifact calls refreshPlanet first.
    #[external("private")]
    fn find_artifact(
        args: DFPFindArtifactArgs,
        planet: Planet,
        planet_artifacts: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        player: Player,
        game_config_core: GameConfigCore,
        expected_snark_config: SnarkConfig,
        current_block_number: u32,
        spaceships_config: SpaceshipsConfig,
        planet_artifacts_artifacts: [Artifact; 20],
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
            args.planet_id,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts,
        );
        let new_planet_artifacts_artifacts = artifact_utils::build_planet_artifacts_artifacts_after_refresh(
            new_planet_artifacts,
            planet_artifacts,
            planet_artifacts_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            args.planet_id,
        );

        assert(!new_planet.destroyed, "planet is destroyed");
        assert(new_planet.planet_type == PlanetType::Ruins(), "not a ruins");
        assert(new_planet.owner == sender, "you must own this planet");
        assert(new_planet.prospected_block_number != 0, "planet not prospected");
        assert(!new_planet.has_tried_finding_artifact, "artifact already found on this planet");

        let provided_snark = SnarkConfig {
            disable_zk_checks: false,
            planethash_key: args.snark_perlin_planethash_key,
            spacetype_key: args.snark_perlin_biomebase_key,
            biomebase_key: args.snark_perlin_biomebase_key,
            perlin_length_scale: args.snark_perlin_length_scale,
            perlin_mirror_x: args.snark_perlin_mirror_x != 0,
            perlin_mirror_y: args.snark_perlin_mirror_y != 0,
        };
        game_utils::revert_if_bad_snark_perlin_flags(provided_snark, expected_snark_config);

        if !expected_snark_config.disable_zk_checks {
            // todo: implement zk-level findArtifact verification (e.g. biomebase proof verifier)
        }

        assert(
            current_block_number > new_planet.prospected_block_number,
            "can only call findArtifact after prospectedBlockNumber",
        );
        assert(
            (current_block_number - new_planet.prospected_block_number) < 256,
            "planet prospect expired",
        );

        if spaceships_config.gear {
            assert(
                game_utils::contains_gear_ship(
                    sender,
                    new_planet_artifacts,
                    new_planet_artifacts_artifacts,
                ),
                "gear ship must be present on planet",
            );
        }

        let prospect_block = new_planet.prospected_block_number as u32;
        let header = get_block_header_at(prospect_block, *self.context);
        let block_hash: Field = header.hash();
        let artifact_seed = poseidon2_hash([args.planet_id, block_hash]);

        let biome =
            game_utils::_get_biome_u128(new_planet.space_type, args.biomebase, game_config_core);
        let (artifact_type, level_bonus) = game_utils::_random_artifact_type_and_level_bonus(
            artifact_seed,
            biome,
            new_planet.space_type,
        );
        let sum = (new_planet.planet_level as u32) + (level_bonus as u32);
        let level_with_bonus = if sum > 9 { 9 } else { sum as u8 };
        let rarity = game_utils::artifact_rarity_from_planet_level(level_with_bonus);

        // Hashes for public: input state (for verification) and refresh results
        let planet_hash = poseidon2_hash(planet.serialize());
        let planet_artifacts_hash = poseidon2_hash(planet_artifacts.serialize());
        let planet_events_hash = if planet_events_state == PlanetEvents::zero() {
            0
        } else {
            poseidon2_hash(planet_events_state.serialize())
        };
        let (arrival_ids, arrivals_hash, artifact_ids, artifacts_hash, artifact_locations_hash) = build_refresh_event_hashes(
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );
        let player_hash = poseidon2_hash(player.serialize());

        let mut find_planet = new_planet;
        find_planet.has_tried_finding_artifact = true;

        self.enqueue_self.find_artifact_public(
            sender,
            args.planet_id,
            planet_hash,
            planet_artifacts_hash,
            planet_events_hash,
            planet_events_state.count as u8,
            arrival_ids,
            arrivals_hash,
            artifact_ids,
            artifacts_hash,
            artifact_locations_hash,
            player_hash,
            artifact_seed,
            rarity,
            artifact_type,
            biome,
            new_planet,
            find_planet,
            new_planet_artifacts,
            new_planet_events,
            new_artifact_locations,
            player,
            timestamp,
            world,
        );
    }

    /// Public counterpart of find_artifact. Verifies refresh input hashes, writes refresh results,
    /// then creates artifact and updates planet/planet_artifacts/player.
    #[external("public")]
    #[only_self]
    fn find_artifact_public(
        sender: AztecAddress,
        planet_id: Field,
        planet_hash: Field,
        planet_artifacts_hash: Field,
        planet_events_hash: Field,
        planet_event_count: u8,
        arrival_ids: [Field; 20],
        arrivals_hash: [Field; 20],
        artifacts_ids: [Field; 20],
        artifacts_hash: [Field; 20],
        artifact_locations_hash: [Field; 20],
        player_hash: Field,
        artifact_id: Field,
        rarity: u8,
        artifact_type: u8,
        biome: u8,
        refreshed_planet: Planet,
        find_planet: Planet,
        new_planet_artifacts: PlanetArtifacts,
        new_planet_events: PlanetEvents,
        new_artifact_locations: [ArtifactLocation; 20],
        player: Player,
        timestamp: u64,
        world: World,
    ) {
        let ts = self.context.timestamp();
        // notPaused - mirror DFArtifactFacet.notPaused using WorldStorage + World.paused
        self.internal.assert_not_paused(world);

        // notTokenEnded - gate by ArtifactsConfig.token_mint_end_timestamp (DFArtifactFacet.notTokenEnded)
        let config_storage_for_token = Config::at(self.internal.get_config_storage_address());
        let artifacts_config_for_token: ArtifactsConfig =
            self.view(config_storage_for_token.get_artifacts_config());
        assert(
            ts < artifacts_config_for_token.token_mint_end_timestamp,
            "Token mint period has ended",
        );

        assert(timestamp <= ts, "Timestamp cannot be in the future");
        let max_drift: u64 = 300;
        assert(ts - timestamp <= max_drift, "Timestamp too old");

        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        assert(
            self.view(planet_storage.verify_hash(planet_id, planet_hash)),
            "planet hash mismatch",
        );
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        assert(
            self.view(planet_artifacts_storage.verify_hash(planet_id, planet_artifacts_hash)),
            "planet_artifacts hash mismatch",
        );

        let planet_events_storage =
            PlanetEventsStorage::at(self.internal.get_planet_events_storage_address());
        assert(
            self.view(planet_events_storage.verify_hash(planet_id, planet_events_hash)),
            "planet_events hash mismatch",
        );

        let arrival_storage = ArrivalStorage::at(self.internal.get_arrivals_storage_address());
        let artifact_storage_for_verify =
            ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let artifact_location_storage_for_verify =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        for i in 0..20 {
            if (i as u8) < planet_event_count {
                let arrival_id = arrival_ids[i];
                let art_id = artifacts_ids[i];
                if arrival_id != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_id, arrivals_hash[i])),
                        "arrival hash mismatch",
                    );
                }
                if art_id != 0 {
                    assert(
                        self.view(artifact_storage_for_verify.verify_hash(art_id, artifacts_hash[i])),
                        "artifact hash mismatch",
                    );
                    assert(
                        self.view(artifact_location_storage_for_verify.verify_hash(
                            art_id,
                            artifact_locations_hash[i],
                        )),
                        "artifact_location hash mismatch",
                    );
                }
            }
        }

        let player_storage = PlayerStorage::at(self.internal.get_player_storage_address());
        assert(self.view(player_storage.verify_hash(sender, player_hash)), "player hash mismatch");

        // Write refresh results (same as Core.refresh_planet_public)
        self.call(planet_storage.set(planet_id, refreshed_planet));
        let planet_events_storage_write =
            PlanetEventsStorage::at(self.internal.get_planet_events_storage_address());
        self.call(planet_events_storage_write.set(planet_id, new_planet_events));
        self.call(planet_artifacts_storage.set(planet_id, new_planet_artifacts));
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        for i in 0..20 {
            if (i < planet_event_count as u32) & (artifacts_ids[i] != 0) {
                self.call(location_storage.set(artifacts_ids[i], new_artifact_locations[i]));
            }
        }

        // Create new artifact and put on planet (find_artifact-specific)
        let config_storage = Config::at(self.internal.get_config_storage_address());
        let artifacts_config: ArtifactsConfig = self.view(config_storage.get_artifacts_config());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let artifact = Artifact {
            planet_discovered_on: planet_id,
            rarity: rarity,
            planet_biome: biome,
            minted_at_timestamp: ts,
            discoverer: sender,
            artifact_type: artifact_type,
            activations: 0,
            last_activated: 0,
            last_deactivated: 0,
            wormhole_to: 0 as Field,
            controller: sender,
            last_updated: ts,
        };
        let location = ArtifactLocation { planet_id: planet_id, voyage_id: 0, last_updated: ts };

        self.call(artifact_storage.set(artifact_id, artifact));
        self.call(location_storage.set(artifact_id, location));

        let final_planet_artifacts =
            game_utils::add_artifact_id_to_planet_artifacts(artifact_id, new_planet_artifacts);

        let mut out_planet = find_planet;
        out_planet.last_updated = ts;
        self.call(planet_storage.set(planet_id, out_planet));
        self.call(planet_artifacts_storage.set(planet_id, final_planet_artifacts));

        let points = artifacts_config.artifact_point_values[rarity as u32];
        let mut new_player = player;
        new_player.score += points;
        new_player.last_updated = ts;
        self.call(player_storage.set(sender, new_player));
    }

    // ========== Game Logic: Deposit / Withdraw Artifact ==========

    /// Deposit an artifact to a planet (no ERC721 ownership check). L1: depositArtifact calls refreshPlanet first.
    #[external("public")]
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

        // notPaused
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "Timestamp cannot be in the future");
        assert(ts - timestamp <= 300, "Timestamp too old");
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

        self.internal.verify_refresh_hashes_and_write(
            location_id,
            planet,
            planet_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            new_planet,
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
        );

        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "artifact hash mismatch",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "artifact_location hash mismatch",
        );

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

        let updated_artifacts =
            game_utils::add_artifact_id_to_planet_artifacts(artifact_id, new_planet_artifacts);
        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));

        let mut new_location = artifact_location;
        new_location.planet_id = location_id;
        new_location.last_updated = ts;
        self.call(location_storage.set(artifact_id, new_location));
    }

    /// Withdraw an artifact from a trading post (no ERC721 transfer). L1: withdrawArtifact calls refreshPlanet first.
    #[external("public")]
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

        // notPaused
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "Timestamp cannot be in the future");
        assert(ts - timestamp <= 300, "Timestamp too old");
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

        self.internal.verify_refresh_hashes_and_write(
            location_id,
            planet,
            planet_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            new_planet,
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
        );

        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "artifact hash mismatch",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "artifact_location hash mismatch",
        );

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

        let updated_artifacts =
            game_utils::remove_artifact_id_from_planet_artifacts(artifact_id, new_planet_artifacts);
        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));

        let mut new_location = artifact_location;
        new_location.planet_id = 0;
        new_location.last_updated = ts;
        self.call(location_storage.set(artifact_id, new_location));
    }

    // ========== Game Logic: Activate / Deactivate Artifact ==========

    /// Activate an artifact on a planet. L1: activateArtifact calls refreshPlanet(locationId) and refreshPlanet(wormholeTo) when wormholeTo != 0.
    #[external("public")]
    fn activate_artifact(
        location_id: Field,
        artifact_id: Field,
        wormhole_to: Field,
        planet: Planet,
        artifact: Artifact,
        artifact_location: ArtifactLocation,
        planet_artifacts: PlanetArtifacts,
        active_artifacts: [Artifact; 20],
        wormhole_planet: Planet,
        wormhole_planet_id: Field,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        timestamp: u64,
        wormhole_planet_events: PlanetEvents,
        wormhole_arrivals: [Arrival; 20],
        wormhole_artifacts: [Artifact; 20],
        wormhole_artifact_locations: [ArtifactLocation; 20],
        wormhole_planet_artifacts: PlanetArtifacts,
        world: World,
    ) {
        let sender = self.msg_sender();

        // notPaused
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "Timestamp cannot be in the future");
        assert(ts - timestamp <= 300, "Timestamp too old");
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

        self.internal.verify_refresh_hashes_and_write(
            location_id,
            planet,
            planet_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            new_planet,
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
        );

        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());

        let mut new_wormhole_planet = wormhole_planet;
        if wormhole_to != 0 {
            assert_refresh_timestamp_monotonicity(
                timestamp,
                wormhole_planet,
                wormhole_planet_events,
                wormhole_arrivals,
                wormhole_artifacts,
                wormhole_artifact_locations,
                wormhole_planet_artifacts,
            );
            let (wh_new_planet, wh_new_events, wh_new_artifacts, wh_new_locations) = refresh_planet_and_apply_timestamp(
                timestamp,
                wormhole_to,
                wormhole_planet,
                wormhole_planet_events,
                wormhole_arrivals,
                wormhole_artifacts,
                wormhole_artifact_locations,
                wormhole_planet_artifacts,
            );
            new_wormhole_planet = wh_new_planet;
            self.internal.verify_refresh_hashes_and_write(
                wormhole_planet_id,
                wormhole_planet,
                wormhole_planet_artifacts,
                wormhole_planet_events,
                wormhole_arrivals,
                wormhole_artifacts,
                wormhole_artifact_locations,
                wh_new_planet,
                wh_new_events,
                wh_new_artifacts,
                wh_new_locations,
            );
        }

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "artifact hash mismatch",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "artifact_location hash mismatch",
        );

        assert(new_planet.owner == sender, "you must own this planet");
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(artifact != Artifact::zero(), "artifact not found");
        assert(artifact_location.planet_id == location_id, "artifact not on this planet");

        let is_crescent = artifact.artifact_type == ArtifactType::ShipCrescent();

        if is_crescent {
            assert(artifact.activations == 0, "crescent cannot be activated more than once");
            assert(new_planet.planet_type != 1, "cannot turn a silver mine into a silver mine");
            assert(
                new_planet.owner == AztecAddress::zero(),
                "can only activate crescent on unowned planets",
            );
            assert(new_planet.planet_level >= 1, "planet level must be more than one");

            let mut new_artifact = artifact;
            new_artifact.activations += 1;
            new_artifact.last_activated = ts;
            new_artifact.last_deactivated = ts;
            new_artifact.last_updated = ts;

            let mut new_planet_crescent = new_planet;
            if new_planet_crescent.silver == 0 {
                new_planet_crescent.silver = 1;
                let config_storage = Config::at(self.internal.get_config_storage_address());
                let default_stats: PlanetDefaultStats = self.view(config_storage
                    .get_planet_default_stats(new_planet_crescent.planet_level));
                let world_config: WorldConfig = self.view(config_storage.get_world_config());
                let (silver_growth, _silver_cap, _initial_silver) = artifact_utils::default_planet_silver_stats(
                    location_id,
                    new_planet_crescent.planet_level,
                    PlanetType::SilverMine(),
                    new_planet_crescent.space_type,
                    default_stats,
                    world_config.time_factor_hundredths as u128,
                );
                new_planet_crescent.silver_growth = silver_growth;
            }
            new_planet_crescent.planet_type = PlanetType::SilverMine();
            new_planet_crescent.last_updated = ts;

            self.call(artifact_storage.set(artifact_id, new_artifact));
            self.call(planet_storage.set(location_id, new_planet_crescent));
        } else {
            // ========== Standard artifact activation logic ==========

            let active = game_utils::get_active_artifact(new_planet_artifacts, active_artifacts);
            assert(
                active == Artifact::zero(),
                "there is already an active artifact on this planet",
            );

            let cooldown_seconds =
                artifact_utils::get_artifact_cooldown_seconds(artifact.artifact_type);
            if cooldown_seconds > 0 {
                let time_since_last = ts - artifact.last_deactivated;
                assert(time_since_last >= cooldown_seconds, "artifact on cooldown");
            }

            if artifact.artifact_type == ArtifactType::Wormhole() {
                assert(wormhole_to != 0, "must provide wormholeTo to activate a wormhole");
                assert(
                    wormhole_planet_id == wormhole_to,
                    "wormhole_planet_id must match wormhole_to",
                );
                assert(
                    new_wormhole_planet.owner == sender,
                    "you can only create a wormhole to a planet you own",
                );
                assert(!new_wormhole_planet.destroyed, "wormhole target planet destroyed");
            }

            let mut new_artifact = artifact;
            new_artifact.activations += 1;
            new_artifact.last_activated = ts;
            new_artifact.wormhole_to = wormhole_to;
            new_artifact.last_updated = ts;

            let mut new_planet_act = new_planet;

            let is_bloom = artifact.artifact_type == ArtifactType::BloomFilter();
            let is_black_domain = artifact.artifact_type == ArtifactType::BlackDomain();

            if is_bloom {
                assert(
                    2 * (artifact.rarity as u32) >= (new_planet_act.planet_level as u32),
                    "artifact is not powerful enough to apply effect to this planet level",
                );
                new_planet_act.population = new_planet_act.population_cap;
                new_planet_act.silver = new_planet_act.silver_cap;
                new_artifact.last_deactivated = ts;
            }

            if is_black_domain {
                assert(
                    2 * (artifact.rarity as u32) >= (new_planet_act.planet_level as u32),
                    "artifact is not powerful enough to apply effect to this planet level",
                );
                new_planet_act.destroyed = true;
                new_artifact.last_deactivated = ts;
            }

            let should_burn_on_activate = is_bloom | is_black_domain;

            self.call(artifact_storage.set(artifact_id, new_artifact));

            if should_burn_on_activate {
                let updated_artifacts = game_utils::remove_artifact_id_from_planet_artifacts(
                    artifact_id,
                    new_planet_artifacts,
                );
                self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
            }

            if should_burn_on_activate {
                new_planet_act.last_updated = ts;
                self.call(planet_storage.set(location_id, new_planet_act));
            } else {
                let mut buffed_planet =
                    game_utils::buff_planet_with_artifact(new_artifact, new_planet_act);
                buffed_planet.last_updated = ts;
                self.call(planet_storage.set(location_id, buffed_planet));
            }
        }
    }

    /// Deactivate the active artifact on a planet. L1: deactivateArtifact calls refreshPlanet first.
    #[external("public")]
    fn deactivate_artifact(
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

        // notPaused
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "Timestamp cannot be in the future");
        assert(ts - timestamp <= 300, "Timestamp too old");
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

        self.internal.verify_refresh_hashes_and_write(
            location_id,
            planet,
            planet_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            new_planet,
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
        );

        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "artifact hash mismatch",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "artifact_location hash mismatch",
        );

        assert(new_planet.owner == sender, "you must own this planet");
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(artifact != Artifact::zero(), "artifact not found");
        assert(artifact_location.planet_id == location_id, "artifact not on this planet");
        assert(artifact.last_activated > artifact.last_deactivated, "artifact not activated");

        let mut new_artifact = artifact;
        new_artifact.last_deactivated = ts;
        new_artifact.wormhole_to = 0;
        new_artifact.last_updated = ts;

        let should_burn = (artifact.artifact_type == ArtifactType::PlanetaryShield())
            | (artifact.artifact_type == ArtifactType::PhotoidCannon());

        self.call(artifact_storage.set(artifact_id, new_artifact));

        if should_burn {
            let updated_artifacts = game_utils::remove_artifact_id_from_planet_artifacts(
                artifact_id,
                new_planet_artifacts,
            );
            self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
        }

        let mut debuffed_planet = game_utils::debuff_planet_with_artifact(new_artifact, new_planet);
        debuffed_planet.last_updated = ts;
        self.call(planet_storage.set(location_id, debuffed_planet));
    }

    // ========== Game Logic: Spaceships & Admin ==========

    /// Give spaceships to player on their home planet (one-time claim).
    /// Ported from DFArtifactFacet.giveSpaceShips (no ERC721).
    #[external("public")]
    fn give_space_ships(
        location_id: Field,
        planet: Planet,
        player: Player,
        planet_artifacts: PlanetArtifacts,
    ) {
        let sender = self.msg_sender();

        // Verify states
        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let player_storage = PlayerStorage::at(self.internal.get_player_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());

        assert(
            self.view(planet_storage.verify_hash(location_id, poseidon2_hash(planet.serialize()))),
            "planet hash mismatch",
        );
        assert(
            self.view(player_storage.verify_hash(sender, poseidon2_hash(player.serialize()))),
            "player hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(
                location_id,
                poseidon2_hash(planet_artifacts.serialize()),
            )),
            "planet_artifacts hash mismatch",
        );

        // Validations
        assert(!player.claimed_ships, "player already claimed ships");
        assert(planet.owner == sender, "you can only spawn ships on your home planet");
        assert(planet.is_home_planet, "you can only spawn ships on your home planet");

        // Load config
        let config_storage = Config::at(self.internal.get_config_storage_address());
        let spaceships_config: SpaceshipsConfig = self.view(config_storage.get_spaceships_config());

        // Create spaceships
        let mut updated_artifacts = planet_artifacts;
        let mut nonce: u32 = 0;

        if spaceships_config.mothership {
            updated_artifacts =
                self.internal.create_spaceship(location_id, sender, 10, nonce, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.crescent {
            updated_artifacts =
                self.internal.create_spaceship(location_id, sender, 11, nonce, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.whale {
            updated_artifacts =
                self.internal.create_spaceship(location_id, sender, 12, nonce, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.gear {
            updated_artifacts =
                self.internal.create_spaceship(location_id, sender, 13, nonce, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.titan {
            updated_artifacts =
                self.internal.create_spaceship(location_id, sender, 14, nonce, updated_artifacts);
            nonce += 1;
        }

        // Update planet artifacts
        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));

        // Mark player as claimed
        let mut new_player = player;
        new_player.claimed_ships = true;
        self.call(player_storage.set(sender, new_player));
    }

    /// Internal helper: Create a spaceship artifact and place it on a planet.
    /// L1: LibArtifactUtils.createAndPlaceSpaceship. Args from artifact_utils::build_create_spaceship_args; create + put in contract.
    #[internal("public")]
    fn create_spaceship(
        planet_id: Field,
        controller: AztecAddress,
        ship_type: u8,
        nonce: u32,
        planet_artifacts: PlanetArtifacts,
    ) -> PlanetArtifacts {
        let (artifact_id, create_args) =
            artifact_utils::build_create_spaceship_args(planet_id, controller, ship_type, nonce);
        self.call(ArtifactSystem::at(self.context.this_address()).create_artifact(create_args));
        game_utils::add_artifact_id_to_planet_artifacts(artifact_id, planet_artifacts)
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
        self.call(ArtifactSystem::at(self.context.this_address()).create_artifact(args));

        // Add to planet artifacts (LibGameUtils port)
        let updated_artifacts =
            game_utils::add_artifact_id_to_planet_artifacts(args.id, planet_artifacts);
        self.call(planet_artifacts_storage.set(args.planet_id, updated_artifacts));
    }
}
