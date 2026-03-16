use ::aztec::macros::aztec;

#[aztec]
contract ArtifactFind {
    use ::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, only_self, view},
            storage::storage,
        },
        oracle::block_header::get_block_header_at,
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::{Hash, Serialize}},
    };
    use ::aztec::state_vars::PublicMutable;

    use ::types::args::DFPFindArtifactArgs;
    use ::types::storage::{
        arrival::Arrival,
        artifact::{Artifact, ArtifactLocation, ArtifactType},
        planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType},
        player::Player,
        world::World,
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

    use ::libs::artifact_utils::{
        artifact_from_create_args, contains_gear, create_and_place_spaceship, is_spaceship,
    };

    use ::libs::batch_utils::{
        assert_artifact_and_location_timestamp_freshness, assert_artifact_timestamp_freshness,
        assert_owned_artifacts_timestamp_freshness, assert_planet_timestamp_freshness,
        assert_public_timestamp, compute_artifact_and_location_hashes,
        compute_owned_artifact_hashes, compute_planet_hashes, compute_world_hash,
    };
    use ::libs::game_utils::{
        _buff_planet, _debuff_planet, _default_planet, _get_biome, _get_upgrade_for_artifact,
        _put_artifact_on_planet, _random_artifact_type_and_level_bonus, _take_artifact_off_planet,
        artifact_rarity_from_planet_level, is_artifact_on_planet,
    };
    use ::libs::planet::{refresh_planet_v1, refresh_planet_v2};

    use ::circuits::biomebase::biome_proof;

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
        config_storage_address: PublicMutable<AztecAddress, Context>,
        arrivals_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_location_storage_address: PublicMutable<AztecAddress, Context>,
        planet_storage_address: PublicMutable<AztecAddress, Context>,
        planet_artifacts_storage_address: PublicMutable<AztecAddress, Context>,
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,
        player_storage_address: PublicMutable<AztecAddress, Context>,
        world_storage_address: PublicMutable<AztecAddress, Context>,
        // Stores the last block hash retrieved by a private call.
        last_block_hash: PublicMutable<Field, Context>,
        // Stores the block number that was queried last.
        last_queried_block: PublicMutable<u32, Context>,
    }

    // ---- Events ----

    /// Emitted (publicly) when test_get_block_header_private succeeds.
    /// Visible to off-chain scripts via getDecodedPublicEvents.
    #[event]
    struct BlockHashResult {
        target_block: u32,
        block_hash: Field,
        chain_id: Field,
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.last_block_hash.write(0);
        self.storage.last_queried_block.write(0);
    }

    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        self.internal.assert_admin();
        self.storage.admin.write(new_admin);
    }

    #[external("public")]
    fn set_all_storage_addresses(
        config_storage_address: AztecAddress,
        arrivals_storage_address: AztecAddress,
        artifact_storage_address: AztecAddress,
        artifact_location_storage_address: AztecAddress,
        planet_storage_address: AztecAddress,
        planet_artifacts_storage_address: AztecAddress,
        planet_events_storage_address: AztecAddress,
        player_storage_address: AztecAddress,
        world_storage_address: AztecAddress,
    ) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_storage_address);
        self.storage.arrivals_storage_address.write(arrivals_storage_address);
        self.storage.artifact_storage_address.write(artifact_storage_address);
        self.storage.artifact_location_storage_address.write(artifact_location_storage_address);
        self.storage.planet_storage_address.write(planet_storage_address);
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_storage_address);
        self.storage.planet_events_storage_address.write(planet_events_storage_address);
        self.storage.world_storage_address.write(world_storage_address);
        self.storage.player_storage_address.write(player_storage_address);
    }

    #[external("public")]
    fn set_config_storage_address(config_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_storage_address);
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
    fn set_player_storage_address(player_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.player_storage_address.write(player_storage_address);
    }

    #[external("public")]
    fn set_world_storage_address(world_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.world_storage_address.write(world_storage_address);
    }

    /// Noir port of Solidity `DFArtifactFacet.findArtifact`
    #[external("private")]
    fn find_artifact(
        location_id: Field,
        x: Field, // private
        y: Field, // private
        biomebase: u8,
        timestamp: u64,
        provided_snark_config: SnarkConfig,
        game_config_core: GameConfigCore,
        world_config: WorldConfig,
        artifacts_config: ArtifactsConfig,
        spaceships_config: SpaceshipsConfig,
        // State inputs (to be validated via hash in public)
        player: Player,
        planet: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        owned_artifacts: [Artifact; 20],
        owned_artifact_locations: [ArtifactLocation; 20],
        world: World,
    ) {
        if !provided_snark_config.disable_zk_checks {
            let biome_proof_result = biome_proof(
                provided_snark_config,
                game_config_core,
                planet.space_type,
                x,
                y,
            );
            let expected_planet_hash = biome_proof_result.0;
            let expected_biomebase = biome_proof_result.1;

            assert(expected_planet_hash == location_id, "planet hash mismatch");
            assert(expected_biomebase == biomebase, "biomebase mismatch");
        }

        let sender = self.msg_sender();
        assert(!world.paused, "Game is paused");

        assert_planet_timestamp_freshness(
            timestamp,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let planet_hashes_result = compute_planet_hashes(
            location_id,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let owned_artifact_hashes_result = compute_owned_artifact_hashes(
            planet_artifacts_state,
            owned_artifacts,
            owned_artifact_locations,
        );
        let world_hash_result = compute_world_hash(world);

        let provided_snark_config_hash = poseidon2_hash(provided_snark_config.serialize());
        let game_config_core_hash = poseidon2_hash(game_config_core.serialize());
        let world_config_hash: Field = poseidon2_hash(world_config.serialize());
        let artifacts_config_hash: Field = poseidon2_hash(artifacts_config.serialize());
        let player_hash = poseidon2_hash(player.serialize());

        let planet_hash = planet_hashes_result.1;
        let planet_events_state_hash = planet_hashes_result.3;
        let arrival_ids: [Field; 20] = planet_hashes_result.4;
        let arrival_hashes: [Field; 20] = planet_hashes_result.5;
        let arrival_artifact_ids: [Field; 20] = planet_hashes_result.6;
        let arrival_artifact_hashes: [Field; 20] = planet_hashes_result.7;
        let arrival_artifact_location_hashes: [Field; 20] = planet_hashes_result.8;
        let origin_arrivals_count = planet_hashes_result.9;
        let planet_artifacts_state_hash = planet_hashes_result.2;

        let owned_artifact_ids: [Field; 20] = owned_artifact_hashes_result.0;
        let owned_artifact_hashes: [Field; 20] = owned_artifact_hashes_result.1;
        let owned_artifact_location_hashes: [Field; 20] = owned_artifact_hashes_result.2;
        let owned_artifact_count = owned_artifact_hashes_result.3;
        let world_hash: Field = world_hash_result;

        let refresh_planet_result = refresh_planet_v2(
            timestamp,
            location_id,
            planet,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = refresh_planet_result.0;
        let mut new_planet_events_state = refresh_planet_result.1;
        let mut new_planet_artifacts_state = refresh_planet_result.2;
        let mut change_artifact_location_count = refresh_planet_result.3;
        let mut change_artifact_location_ids = refresh_planet_result.4;
        let mut change_artifact_locations = refresh_planet_result.5;
        let change_artifact_arrival_indices = refresh_planet_result.6;

        let mut artifacts: [Artifact; 20] = [Artifact::zero(); 20];
        for i in 0..20 {
            if i < planet_artifacts_state.count {
                artifacts[i] = owned_artifacts[i];
            }
        }
        for i in 0..20 {
            if i < change_artifact_location_count {
                artifacts[planet_artifacts_state.count + i] =
                    arrival_artifacts[change_artifact_arrival_indices[i]];
            }
        }

        // check_find_artifact
        assert(!new_planet.has_tried_finding_artifact, "artifact already found on this planet");
        assert(new_planet.owner == sender, "you must own this planet");
        assert(new_planet.prospected_block_number != 0, "planet not prospected");
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(new_planet.planet_type == PlanetType::Ruins, "not a ruins");

        if spaceships_config.gear {
            assert(
                contains_gear(sender, new_planet_artifacts_state, artifacts),
                "gear ship must be present on planet",
            );
        }

        let biome: u8 = _get_biome(new_planet.space_type, biomebase, game_config_core);
        // TODO: Restore get_block_header_at once EmbeddedWallet PXE oracle is fixed.
        // Original code used the block hash for stronger randomness:
        let header = get_block_header_at(new_planet.prospected_block_number, *self.context);
        let block_hash: Field = header.hash();
        let artifact_seed = poseidon2_hash([location_id, block_hash]);
        // Workaround: use prospected_block_number directly as the seed entropy source.
        // The block number is still unpredictable at prospect time (player doesn't know
        // which block the prospect tx will land in), preserving the no-reroll property.
        // let artifact_seed =
        //     poseidon2_hash([location_id, new_planet.prospected_block_number as Field]);

        let (artifact_type, level_bonus) =
            _random_artifact_type_and_level_bonus(artifact_seed, biome, new_planet.space_type);
        let sum = new_planet.planet_level + level_bonus;
        let input_sum = if sum > 9 { 9 } else { sum as u8 };
        let rarity = artifact_rarity_from_planet_level(input_sum);

        let artifact_id = artifact_seed;
        let artifact = Artifact {
            planet_discovered_on: location_id,
            rarity: rarity,
            planet_biome: biome,
            minted_at_timestamp: timestamp,
            discoverer: sender,
            artifact_type: artifact_type,
            activations: 0,
            owner: sender,
            last_activated: 0,
            last_deactivated: 0,
            wormhole_to: 0 as Field,
            controller: sender,
            last_updated: timestamp,
        };

        let mut artifact_location =
            ArtifactLocation { planet_id: location_id, voyage_id: 0, last_updated: timestamp };

        let put_result = _put_artifact_on_planet(
            artifact_id,
            artifact_location,
            location_id,
            new_planet_artifacts_state,
        );

        let mut new_artifact = artifact;
        let mut new_artifact_location = put_result.1;
        new_planet_artifacts_state = put_result.3;

        new_planet.has_tried_finding_artifact = true;

        let mut new_player = player;

        new_player.score += artifacts_config.artifact_point_values[rarity as u32];

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < change_artifact_location_count {
                change_artifact_locations[i].last_updated = timestamp;
            }
        }

        new_artifact.last_updated = timestamp;
        new_artifact_location.last_updated = timestamp;
        new_player.last_updated = timestamp;

        self.enqueue_self.find_artifact_public(
            location_id,
            artifact_id,
            timestamp,
            provided_snark_config_hash,
            game_config_core_hash,
            world_config_hash,
            artifacts_config_hash,
            player_hash,
            planet_hash,
            planet_events_state_hash,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            origin_arrivals_count,
            planet_artifacts_state_hash,
            owned_artifact_ids,
            owned_artifact_hashes,
            owned_artifact_location_hashes,
            owned_artifact_count,
            world_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            change_artifact_location_count,
            change_artifact_location_ids,
            change_artifact_locations,
            new_artifact,
            new_artifact_location,
            new_player,
        );
    }

    #[external("public")]
    #[only_self]
    fn find_artifact_public(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        snark_config_hash: Field,
        game_config_core_hash: Field,
        world_config_hash: Field,
        artifacts_config_hash: Field,
        player_hash: Field,
        planet_hash: Field,
        planet_events_state_hash: Field,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        origin_arrivals_count: u32,
        planet_artifacts_state_hash: Field,
        owned_artifact_ids: [Field; 20],
        owned_artifact_hashes: [Field; 20],
        owned_artifact_location_hashes: [Field; 20],
        owned_artifact_count: u32,
        world_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        change_artifact_location_count: u32,
        change_artifact_location_ids: [Field; 20],
        change_artifact_locations: [ArtifactLocation; 20],
        new_artifact: Artifact,
        new_artifact_location: ArtifactLocation,
        new_player: Player,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let block_number = self.context.block_number();

        assert(
            new_planet.prospected_block_number < block_number,
            "can only find artifact after prospected block",
        );
        assert(
            (block_number - new_planet.prospected_block_number) < 256,
            "planet prospect expired",
        );

        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let player_storage = PlayerStorage::at(self.storage.player_storage_address.read());
        let config = Config::at(self.storage.config_storage_address.read());

        assert(
            self.view(planet_storage.verify_hash(location_id, planet_hash)),
            "planet hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location_id, planet_events_state_hash)),
            "planet_events hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location_id, planet_artifacts_state_hash)),
            "planet_artifacts hash mismatch",
        );

        assert(
            self.view(arrival_storage.verify_hashes_batch(
                arrival_ids,
                arrival_hashes,
                origin_arrivals_count,
            )),
            "arrivals hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_hashes,
                origin_arrivals_count,
            )),
            "arrival artifacts hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                arrival_artifact_ids,
                arrival_artifact_location_hashes,
                origin_arrivals_count,
            )),
            "arrival artifact locations hash mismatch",
        );

        assert(
            self.view(artifact_storage.verify_hashes_batch(
                owned_artifact_ids,
                owned_artifact_hashes,
                owned_artifact_count,
            )),
            "owned artifact hashes mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                owned_artifact_ids,
                owned_artifact_location_hashes,
                owned_artifact_count,
            )),
            "owned artifact locations hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "world hash mismatch");

        assert(
            self.view(config.verify_snark_config_hash(snark_config_hash)),
            "snark config hash mismatch",
        );
        assert(
            self.view(config.verify_game_config_core_hash(game_config_core_hash)),
            "game config core hash mismatch",
        );
        assert(
            self.view(config.verify_world_config_hash(world_config_hash)),
            "world config hash mismatch",
        );
        assert(
            self.view(config.verify_artifacts_config_hash(artifacts_config_hash)),
            "artifacts config hash mismatch",
        );

        let sender = new_planet.owner;
        assert(self.view(player_storage.verify_hash(sender, player_hash)), "player hash mismatch");

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_events_storage.set(location_id, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));

        self.call(artifact_location_storage.set_arrival_locations_max20(
            change_artifact_location_ids,
            change_artifact_locations,
            change_artifact_location_count,
        ));

        self.call(artifact_storage.set(artifact_id, new_artifact));
        self.call(artifact_location_storage.set(artifact_id, new_artifact_location));

        self.call(player_storage.set(sender, new_player));
    }

    // ---- Private entry ----

    /// Private function: fetches block header at `target_block` using the oracle,
    /// hashes it, then enqueues a public write + event emission.
    #[external("private")]
    fn test_get_block_header_private(target_block: u32) {
        let header = get_block_header_at(target_block, *self.context);
        let block_hash = header.hash();
        let chain_id = self.context.chain_id();
        self.enqueue_self.record_block_hash_public(target_block, block_hash, chain_id);
    }

    // ---- Public (only_self) writer ----

    /// Called only via enqueue_self from test_get_block_header_private.
    /// Stores the result and emits a public event so off-chain tools can observe it.
    #[external("public")]
    #[only_self]
    fn record_block_hash_public(target_block: u32, block_hash: Field, chain_id: Field) {
        self.storage.last_block_hash.write(block_hash);
        self.storage.last_queried_block.write(target_block);
        self.emit(BlockHashResult { target_block, block_hash, chain_id });
    }

    // ---- Public views ----

    /// Returns the most recently stored block hash.
    #[external("public")]
    #[view]
    fn get_last_block_hash() -> Field {
        self.storage.last_block_hash.read()
    }

    /// Returns the block number that was last queried.
    #[external("public")]
    #[view]
    fn get_last_queried_block() -> u32 {
        self.storage.last_queried_block.read()
    }

    // ---- chain_id utility ----

    #[external("public")]
    #[view]
    fn get_chain_id() -> Field {
        self.context.chain_id()
    }
}
