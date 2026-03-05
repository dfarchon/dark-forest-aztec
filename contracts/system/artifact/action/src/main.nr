use ::aztec::macros::aztec;

/// Artifact action contract.
/// Handles prospect/find/activate/deactivate artifact lifecycle on top of shared storages.
#[aztec]
contract ArtifactAction {
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

    // #[external("public")]
    // fn set_config_storage_address(config_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.config_storage_address.write(config_storage_address);
    // }

    // #[external("public")]
    // fn set_world_storage_address(world_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.world_storage_address.write(world_storage_address);
    // }

    // #[external("public")]
    // fn set_player_storage_address(player_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.player_storage_address.write(player_storage_address);
    // }

    // #[external("public")]
    // fn set_artifact_storage_address(artifact_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.artifact_storage_address.write(artifact_storage_address);
    // }

    // #[external("public")]
    // fn set_artifact_location_storage_address(artifact_location_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.artifact_location_storage_address.write(artifact_location_storage_address);
    // }

    // #[external("public")]
    // fn set_planet_storage_address(planet_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.planet_storage_address.write(planet_storage_address);
    // }

    // #[external("public")]
    // fn set_planet_artifacts_storage_address(planet_artifacts_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.planet_artifacts_storage_address.write(planet_artifacts_storage_address);
    // }

    // #[external("public")]
    // fn set_planet_events_storage_address(planet_events_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.planet_events_storage_address.write(planet_events_storage_address);
    // }

    // #[external("public")]
    // fn set_arrivals_storage_address(arrivals_storage_address: AztecAddress) {
    //     self.internal.assert_admin();
    //     self.storage.arrivals_storage_address.write(arrivals_storage_address);
    // }

    // ========== Internal getters ==========

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

    // ========== Game Logic: Find Artifact ==========
    // Solidity: LibArtifactUtils.checkFindArtifact / findArtifact

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
        let new_planet_artifacts_artifacts = artifact_utils::resolve_artifact_structs(
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
                artifact_utils::contains_gear(
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
        let core_hash: Field = poseidon2_hash(args.core_address.serialize());
        let artifact_seed = poseidon2_hash([args.planet_id, core_hash, block_hash]);

        let biome = game_utils::_get_biome(new_planet.space_type, args.biomebase, game_config_core);
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
        self.internal.assert_not_paused(world);

        // Same timestamp verification as Move.move_public
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
        let player_storage = PlayerStorage::at(self.internal.get_player_storage_address());
        let config_storage = Config::at(self.internal.get_config_storage_address());

        // notTokenEnded - gate by ArtifactsConfig.token_mint_end_timestamp (DFArtifactFacet.notTokenEnded)
        let artifacts_config: ArtifactsConfig = self.view(config_storage.get_artifacts_config());
        assert(
            actual_timestamp < artifacts_config.token_mint_end_timestamp,
            "Token mint period has ended",
        );

        assert(
            self.view(planet_storage.verify_hash(planet_id, planet_hash)),
            "planet hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(planet_id, planet_artifacts_hash)),
            "planet_artifacts hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(planet_id, planet_events_hash)),
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
                if artifacts_ids[i] != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifacts_ids[i], artifacts_hash[i])),
                        "artifact hash mismatch",
                    );
                    assert(
                        self.view(location_storage.verify_hash(
                            artifacts_ids[i],
                            artifact_locations_hash[i],
                        )),
                        "artifact_location hash mismatch",
                    );
                }
            }
        }
        // Verify player hash before writing updated player state
        assert(self.view(player_storage.verify_hash(sender, player_hash)), "player hash mismatch");
        // Extra safety: verify refreshed planet + new events hashes match inputs
        assert(
            self.view(planet_storage.verify_hash(
                planet_id,
                poseidon2_hash(refreshed_planet.serialize()),
            )),
            "refreshed planet hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(
                planet_id,
                poseidon2_hash(new_planet_events.serialize()),
            )),
            "new planet_events hash mismatch",
        );

        // Write refresh results (same as Core.refresh_planet_public, but batched for locations)
        self.call(planet_storage.set(planet_id, refreshed_planet));
        let planet_events_storage_write =
            PlanetEventsStorage::at(self.internal.get_planet_events_storage_address());
        self.call(planet_events_storage_write.set(planet_id, new_planet_events));
        self.call(planet_artifacts_storage.set(planet_id, new_planet_artifacts));
        let location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        // Batch write artifact locations (1 call instead of up to 20)
        let (batch_ids, batch_locations, batch_count) = pack_artifact_location_batch(
            artifacts_ids,
            new_artifact_locations,
            planet_event_count as u32,
        );
        self.call(location_storage.set_batch(batch_ids, batch_locations, batch_count));

        // Create new artifact and put on planet (find_artifact-specific)
        let artifact = Artifact {
            planet_discovered_on: planet_id,
            rarity: rarity,
            planet_biome: biome,
            minted_at_timestamp: actual_timestamp,
            discoverer: sender,
            artifact_type: artifact_type,
            activations: 0,
            last_activated: 0,
            last_deactivated: 0,
            wormhole_to: 0 as Field,
            controller: sender,
            last_updated: actual_timestamp,
        };
        let location =
            ArtifactLocation { planet_id: planet_id, voyage_id: 0, last_updated: actual_timestamp };

        self.call(artifact_storage.set(artifact_id, artifact));
        self.call(location_storage.set(artifact_id, location));

        let final_planet_artifacts =
            game_utils::push_artifact_id(artifact_id, new_planet_artifacts);

        let mut out_planet = find_planet;
        out_planet.last_updated = actual_timestamp;
        self.call(planet_storage.set(planet_id, out_planet));
        self.call(planet_artifacts_storage.set(planet_id, final_planet_artifacts));

        let points = artifacts_config.artifact_point_values[rarity as u32];
        let mut new_player = player;
        new_player.score += points;
        new_player.last_updated = actual_timestamp;
        self.call(player_storage.set(sender, new_player));
    }

    // ========== Game Logic: Activate / Deactivate Artifact ==========
    // Solidity: LibArtifactUtils.activateArtifact / activateSpaceshipArtifact / activateNonSpaceshipArtifact / deactivateArtifact

    #[external("private")]
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
        planet_default_stats: PlanetDefaultStats,
        world_config: WorldConfig,
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

        let mut new_wormhole_planet = wormhole_planet;
        let mut wh_planet_hash: Field = 0;
        let mut wh_planet_artifacts_hash: Field = 0;
        let mut wh_planet_events_hash: Field = 0;
        let mut wh_planet_event_count: u8 = 0;
        let mut wh_arrival_ids: [Field; 20] = [0; 20];
        let mut wh_arrivals_hash: [Field; 20] = [0; 20];
        let mut wh_artifact_ids: [Field; 20] = [0; 20];
        let mut wh_artifacts_hash: [Field; 20] = [0; 20];
        let mut wh_artifact_locations_hash: [Field; 20] = [0; 20];
        let mut wh_new_planet = wormhole_planet;
        let mut wh_new_planet_events = wormhole_planet_events;
        let mut wh_new_planet_artifacts = wormhole_planet_artifacts;
        let mut wh_new_artifact_locations: [ArtifactLocation; 20] = wormhole_artifact_locations;

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
            let (wh_planet, wh_events, wh_artifacts, wh_locations) = refresh_planet_and_apply_timestamp(
                timestamp,
                wormhole_to,
                wormhole_planet,
                wormhole_planet_events,
                wormhole_arrivals,
                wormhole_artifacts,
                wormhole_artifact_locations,
                wormhole_planet_artifacts,
            );
            new_wormhole_planet = wh_planet;
            wh_new_planet = wh_planet;
            wh_new_planet_events = wh_events;
            wh_new_planet_artifacts = wh_artifacts;
            wh_new_artifact_locations = wh_locations;

            let (wi_ids, wi_ah, wi_aids, wi_ahash, wi_alhash) = build_refresh_event_hashes(
                wormhole_planet_events,
                wormhole_arrivals,
                wormhole_artifacts,
                wormhole_artifact_locations,
            );
            wh_planet_hash = poseidon2_hash(wormhole_planet.serialize());
            wh_planet_artifacts_hash = poseidon2_hash(wormhole_planet_artifacts.serialize());
            wh_planet_events_hash = if wormhole_planet_events == PlanetEvents::zero() {
                0
            } else {
                poseidon2_hash(wormhole_planet_events.serialize())
            };
            wh_planet_event_count = wormhole_planet_events.count as u8;
            wh_arrival_ids = wi_ids;
            wh_arrivals_hash = wi_ah;
            wh_artifact_ids = wi_aids;
            wh_artifacts_hash = wi_ahash;
            wh_artifact_locations_hash = wi_alhash;
        }

        assert(!new_planet.destroyed, "planet is destroyed");
        assert(artifact != Artifact::zero(), "artifact not found");
        assert(artifact_location.planet_id == location_id, "artifact not on this planet");

        let is_crescent = artifact.artifact_type == ArtifactType::ShipCrescent();
        let is_spaceship = artifact_utils::is_spaceship(artifact.artifact_type);

        let (new_artifact, final_planet, updated_planet_artifacts, should_burn) = if is_crescent {
            assert(artifact.activations == 0, "crescent cannot be activated more than once");
            assert(new_planet.planet_type != 1, "cannot turn a silver mine into a silver mine");
            assert(
                new_planet.owner == AztecAddress::zero(),
                "can only activate crescent on unowned planets",
            );
            assert(new_planet.planet_level >= 1, "planet level must be more than one");

            let mut new_artifact = artifact;
            new_artifact.activations += 1;
            new_artifact.last_activated = timestamp;
            new_artifact.last_deactivated = timestamp;
            new_artifact.last_updated = timestamp;

            let mut new_planet_crescent = new_planet;
            if new_planet_crescent.silver == 0 {
                new_planet_crescent.silver = 1;
                let (silver_growth, _silver_cap, _initial_silver) = artifact_utils::default_silver_stats(
                    PlanetType::SilverMine(),
                    new_planet_crescent.space_type,
                    planet_default_stats,
                    world_config.time_factor_hundredths as u128,
                );
                new_planet_crescent.silver_growth = silver_growth;
            }
            new_planet_crescent.planet_type = PlanetType::SilverMine();
            new_planet_crescent.last_updated = timestamp;

            (new_artifact, new_planet_crescent, new_planet_artifacts, false)
        } else if is_spaceship {
            // Non-crescent spaceships: mirror L1 behavior.
            // Only increment activations; do NOT mark as "activated" or buff the planet.
            let mut new_artifact = artifact;
            new_artifact.activations += 1;
            new_artifact.last_updated = timestamp;

            (new_artifact, new_planet, new_planet_artifacts, false)
        } else {
            // Non-spaceship artifacts: require ownership and enforce one-active-artifact-per-planet.
            assert(
                new_planet.owner == sender,
                "you must own the planet you are activating an artifact on",
            );

            let active = game_utils::get_active_artifact(new_planet_artifacts, active_artifacts);
            assert(
                active == Artifact::zero(),
                "there is already an active artifact on this planet",
            );

            let cooldown_seconds =
                artifact_utils::artifact_cooldown_seconds(artifact.artifact_type);
            if cooldown_seconds > 0 {
                let time_since_last = timestamp - artifact.last_deactivated;
                assert(time_since_last > cooldown_seconds, "artifact on cooldown");
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
            new_artifact.last_activated = timestamp;
            new_artifact.wormhole_to = wormhole_to;
            new_artifact.last_updated = timestamp;

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
                new_artifact.last_deactivated = timestamp;
            }

            if is_black_domain {
                assert(
                    2 * (artifact.rarity as u32) >= (new_planet_act.planet_level as u32),
                    "artifact is not powerful enough to apply effect to this planet level",
                );
                new_planet_act.destroyed = true;
                new_artifact.last_deactivated = timestamp;
            }

            let should_burn_on_activate = is_bloom | is_black_domain;

            let updated_artifacts = if should_burn_on_activate {
                game_utils::remove_artifact_id(artifact_id, new_planet_artifacts)
            } else {
                new_planet_artifacts
            };

            let final_planet = if should_burn_on_activate {
                new_planet_act.last_updated = timestamp;
                new_planet_act
            } else {
                let mut buffed_planet =
                    game_utils::buff_planet_with_artifact(new_artifact, new_planet_act);
                buffed_planet.last_updated = timestamp;
                buffed_planet
            };

            (new_artifact, final_planet, updated_artifacts, should_burn_on_activate)
        };

        let artifact_hash = poseidon2_hash(artifact.serialize());
        let artifact_location_hash = poseidon2_hash(artifact_location.serialize());

        self.enqueue_self.activate_artifact_public(
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
            new_planet_artifacts,
            new_artifact_locations,
            wormhole_to,
            wormhole_planet_id,
            wh_planet_hash,
            wh_planet_artifacts_hash,
            wh_planet_events_hash,
            wh_planet_event_count,
            wh_arrival_ids,
            wh_arrivals_hash,
            wh_artifact_ids,
            wh_artifacts_hash,
            wh_artifact_locations_hash,
            wh_new_planet,
            wh_new_planet_events,
            wh_new_planet_artifacts,
            wh_new_artifact_locations,
            artifact_hash,
            artifact_location_hash,
            new_artifact,
            final_planet,
            updated_planet_artifacts,
            should_burn,
        );
    }

    /// Public counterpart: verify hashes and write storage (no game logic).
    #[external("public")]
    #[only_self]
    fn activate_artifact_public(
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
        new_planet_artifacts: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
        wormhole_to: Field,
        wormhole_planet_id: Field,
        wormhole_planet_hash: Field,
        wormhole_planet_artifacts_hash: Field,
        wormhole_planet_events_hash: Field,
        wormhole_planet_event_count: u8,
        wormhole_arrival_ids: [Field; 20],
        wormhole_arrivals_hash: [Field; 20],
        wormhole_artifact_ids: [Field; 20],
        wormhole_artifacts_hash: [Field; 20],
        wormhole_artifact_locations_hash: [Field; 20],
        wormhole_new_planet: Planet,
        wormhole_new_planet_events: PlanetEvents,
        wormhole_new_planet_artifacts: PlanetArtifacts,
        wormhole_new_artifact_locations: [ArtifactLocation; 20],
        artifact_hash: Field,
        artifact_location_hash: Field,
        new_artifact: Artifact,
        final_planet: Planet,
        updated_planet_artifacts: PlanetArtifacts,
        should_burn: bool,
    ) {
        self.internal.assert_not_paused(world);

        // Same timestamp verification as Move.move_public
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

        if wormhole_to != 0 {
            assert(
                self.view(planet_storage.verify_hash(wormhole_planet_id, wormhole_planet_hash)),
                "wormhole planet hash mismatch",
            );
            assert(
                self.view(planet_artifacts_storage.verify_hash(
                    wormhole_planet_id,
                    wormhole_planet_artifacts_hash,
                )),
                "wormhole planet_artifacts hash mismatch",
            );
            assert(
                self.view(planet_events_storage.verify_hash(
                    wormhole_planet_id,
                    wormhole_planet_events_hash,
                )),
                "wormhole planet_events hash mismatch",
            );
            for i in 0..20 {
                if (i as u32) < (wormhole_planet_event_count as u32) {
                    if wormhole_arrival_ids[i] != 0 {
                        assert(
                            self.view(arrival_storage.verify_hash(
                                wormhole_arrival_ids[i],
                                wormhole_arrivals_hash[i],
                            )),
                            "wormhole arrival hash mismatch",
                        );
                    }
                    if wormhole_artifact_ids[i] != 0 {
                        assert(
                            self.view(artifact_storage.verify_hash(
                                wormhole_artifact_ids[i],
                                wormhole_artifacts_hash[i],
                            )),
                            "wormhole artifact hash mismatch",
                        );
                        assert(
                            self.view(location_storage.verify_hash(
                                wormhole_artifact_ids[i],
                                wormhole_artifact_locations_hash[i],
                            )),
                            "wormhole artifact_location hash mismatch",
                        );
                    }
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

        // 1. Refresh state (only events + artifact_locations; planet/planet_artifacts written once as final state below)
        self.call(planet_events_storage.set(location_id, new_planet_events));
        // Batch write artifact locations (1 call instead of up to 20)
        let (batch_ids, batch_locations, batch_count) = pack_artifact_location_batch(
            artifact_ids,
            new_artifact_locations,
            planet_event_count as u32,
        );
        self.call(location_storage.set_batch(batch_ids, batch_locations, batch_count));

        // Also write wormhole target state if this is a wormhole activation
        if wormhole_to != 0 {
            self.call(planet_storage.set(wormhole_planet_id, wormhole_new_planet));
            self.call(planet_events_storage.set(wormhole_planet_id, wormhole_new_planet_events));
            self.call(planet_artifacts_storage.set(
                wormhole_planet_id,
                wormhole_new_planet_artifacts,
            ));
            // Batch write wormhole artifact locations (1 call instead of up to 20)
            let (wormhole_batch_ids, wormhole_batch_locations, wormhole_batch_count) = pack_artifact_location_batch(
                wormhole_artifact_ids,
                wormhole_new_artifact_locations,
                wormhole_planet_event_count as u32,
            );
            self.call(location_storage.set_batch(
                wormhole_batch_ids,
                wormhole_batch_locations,
                wormhole_batch_count,
            ));
        }

        // 2. Artifact
        self.call(artifact_storage.set(artifact_id, new_artifact));

        // 3. Final planet + planet_artifacts (single write each; updated_planet_artifacts is always the final value)
        self.call(planet_artifacts_storage.set(location_id, updated_planet_artifacts));
        self.call(planet_storage.set(location_id, final_planet));
    }

    #[external("private")]
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

        assert(new_planet.owner == sender, "you must own this planet");
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(artifact != Artifact::zero(), "artifact not found");
        assert(artifact_location.planet_id == location_id, "artifact not on this planet");
        assert(artifact.last_activated > artifact.last_deactivated, "artifact not activated");

        let mut new_artifact = artifact;
        new_artifact.last_deactivated = timestamp;
        new_artifact.wormhole_to = 0;
        new_artifact.last_updated = timestamp;

        let should_burn = (artifact.artifact_type == ArtifactType::PlanetaryShield())
            | (artifact.artifact_type == ArtifactType::PhotoidCannon());

        let updated_planet_artifacts = if should_burn {
            game_utils::remove_artifact_id(artifact_id, new_planet_artifacts)
        } else {
            new_planet_artifacts
        };

        let mut debuffed_planet = game_utils::debuff_planet_with_artifact(new_artifact, new_planet);
        debuffed_planet.last_updated = timestamp;

        let artifact_hash = poseidon2_hash(artifact.serialize());
        let artifact_location_hash = poseidon2_hash(artifact_location.serialize());

        self.enqueue_self.deactivate_artifact_public(
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
            artifact_hash,
            artifact_location_hash,
            new_planet,
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
            new_artifact,
            debuffed_planet,
            updated_planet_artifacts,
            should_burn,
        );
    }

    /// Public counterpart: verify hashes and write storage (no game logic).
    #[external("public")]
    #[only_self]
    fn deactivate_artifact_public(
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
        artifact_hash: Field,
        artifact_location_hash: Field,
        new_planet: Planet,
        new_planet_events: PlanetEvents,
        new_planet_artifacts: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
        new_artifact: Artifact,
        debuffed_planet: Planet,
        updated_planet_artifacts: PlanetArtifacts,
        should_burn: bool,
    ) {
        self.internal.assert_not_paused(world);

        // Same timestamp verification as Move.move_public
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

        // 1. Refresh state (only events + artifact_locations; planet/planet_artifacts written once as final state below)
        self.call(planet_events_storage.set(location_id, new_planet_events));
        // Batch write artifact locations (1 call instead of up to 20)
        let (batch_ids, batch_locations, batch_count) = pack_artifact_location_batch(
            artifact_ids,
            new_artifact_locations,
            planet_event_count as u32,
        );
        self.call(location_storage.set_batch(batch_ids, batch_locations, batch_count));

        // 2. Artifact
        self.call(artifact_storage.set(artifact_id, new_artifact));

        // 3. Final planet + planet_artifacts (single write each; updated_planet_artifacts is always the final value)
        self.call(planet_artifacts_storage.set(location_id, updated_planet_artifacts));
        self.call(planet_storage.set(location_id, debuffed_planet));
    }

    // ========== Game Logic: Prospect Planet ==========
    // Solidity: LibArtifactUtils.prospectPlanet

    /// Prospect a planet for artifacts. L1: prospectPlanet calls refreshPlanet first. Private: logic with params; public: verify + write (Move pattern).
    #[external("private")]
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
        block_number: u32,
        gear_required: bool,
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
        let new_planet_artifacts_artifacts = artifact_utils::resolve_artifact_structs(
            new_planet_artifacts,
            planet_artifacts,
            planet_artifacts_artifacts,
            planet_events_state,
            arrivals,
            artifacts,
            location_id,
        );

        let has_gear = artifact_utils::contains_gear(
            sender,
            new_planet_artifacts,
            new_planet_artifacts_artifacts,
        );
        let prospect_planet_result = artifact_utils::prospect_planet_logic(
            new_planet,
            block_number,
            timestamp,
            sender,
            gear_required,
            has_gear,
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

        self.enqueue_self.prospect_planet_public(
            location_id,
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
            new_planet_events,
            new_planet_artifacts,
            new_artifact_locations,
            prospect_planet_result,
        );
    }

    #[external("public")]
    #[only_self]
    fn prospect_planet_public(
        location_id: Field,
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
        new_planet_events: PlanetEvents,
        new_planet_artifacts: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
        prospect_planet: Planet,
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

        self.call(planet_events_storage.set(location_id, new_planet_events));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts));
        // Batch write artifact locations (1 call instead of up to 20)
        let (batch_ids, batch_locations, batch_count) = pack_artifact_location_batch(
            artifact_ids,
            new_artifact_locations,
            planet_event_count as u32,
        );
        self.call(location_storage.set_batch(batch_ids, batch_locations, batch_count));
        self.call(planet_storage.set(location_id, prospect_planet));
    }
}
