use ::aztec::macros::aztec;

/// Artifact system contract. Storage addresses (same pattern as core/admin), CRUD, prospect/find/deposit/withdraw/activate/deactivate, spaceships & admin.
#[aztec]
contract ArtifactSystem {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, only_self}, storage::storage},
        oracle::block_header::get_block_header_at,
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::{Hash, Serialize}},
    };
    use ::aztec::state_vars::PublicMutable;

    use ::types::args::DFPFindArtifactArgs;
    use ::types::config::{
        artifacts::ArtifactsConfig, game::GameConfigCore, snark::SnarkConfig,
        spaceships::SpaceshipsConfig,
    };
    use ::types::storage::{
        arrival::Arrival,
        artifact::{Artifact, ArtifactLocation, ArtifactType},
        planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetType},
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
    fn assert_not_paused(world: World) {
        let ws = WorldStorage::at(self.storage.world_storage_address.read());
        assert(self.view(ws.verify(0, world)), "world");
        assert(!world.paused, "paused");
    }

    // ========== Initializer & admin setters ==========

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    #[external("public")]
    fn set_all_storage_addresses(
        config_addr: AztecAddress,
        world_addr: AztecAddress,
        player_addr: AztecAddress,
        artifact_addr: AztecAddress,
        artifact_location_addr: AztecAddress,
        planet_addr: AztecAddress,
        planet_artifacts_addr: AztecAddress,
        planet_events_addr: AztecAddress,
        arrivals_addr: AztecAddress,
    ) {
        assert(self.msg_sender() == self.storage.admin.read(), "admin");
        self.storage.config_storage_address.write(config_addr);
        self.storage.world_storage_address.write(world_addr);
        self.storage.player_storage_address.write(player_addr);
        self.storage.artifact_storage_address.write(artifact_addr);
        self.storage.artifact_location_storage_address.write(artifact_location_addr);
        self.storage.planet_storage_address.write(planet_addr);
        self.storage.planet_artifacts_storage_address.write(planet_artifacts_addr);
        self.storage.planet_events_storage_address.write(planet_events_addr);
        self.storage.arrivals_storage_address.write(arrivals_addr);
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

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());

        assert(self.view(planet_storage.verify_hash(location_id, planet_hash)), "p");
        assert(
            self.view(planet_artifacts_storage.verify_hash(location_id, planet_artifacts_hash)),
            "bad pa",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location_id, planet_events_hash)),
            "bad pe",
        );
        for i in 0..20 {
            if (i as u32) < planet_events_state.count {
                if arrival_ids[i] != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_ids[i], arrivals_hash[i])),
                        "bad arr",
                    );
                }
                if artifact_ids[i] != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(artifact_ids[i], artifacts_hash[i])),
                        "bad art",
                    );
                    assert(
                        self.view(location_storage.verify_hash(
                            artifact_ids[i],
                            artifact_locations_hash[i],
                        )),
                        "bad loc",
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
    /// Revert reasons (for debugging): world paused; "tf" = timestamp > ts; "ts old" = ts - timestamp > 600;
    /// assert_refresh_timestamp_monotonicity; "p" = planet hash; "bad pa" = planet_artifacts; "bad pe" = planet_events;
    /// "bad arr"/"bad art"/"bad loc" = arrival/artifact/location hash; artifact_utils: "planet is destroyed",
    /// "you can't find an artifact on this planet" (not Ruins), "you must own this planet", "this planet has already been prospected",
    /// "gear ship must be present on planet".
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
        assert(timestamp <= ts, "tf");
        assert(ts - timestamp <= 600, "ts old");
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

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let config_storage = Config::at(self.storage.config_storage_address.read());
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

        assert(!new_planet.destroyed, "d");
        assert(new_planet.planet_type == PlanetType::Ruins(), "ruins");
        assert(new_planet.owner == sender, "own");
        assert(new_planet.prospected_block_number != 0, "np");
        assert(!new_planet.has_tried_finding_artifact, "af");

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

        assert(current_block_number > new_planet.prospected_block_number, "no block");
        assert((current_block_number - new_planet.prospected_block_number) < 256, "expired");

        if spaceships_config.gear {
            assert(
                game_utils::contains_gear_ship(
                    sender,
                    new_planet_artifacts,
                    new_planet_artifacts_artifacts,
                ),
                "no gear",
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
        self.internal.assert_not_paused(world);

        let config_storage = Config::at(self.storage.config_storage_address.read());
        let artifacts_config: ArtifactsConfig = self.view(config_storage.get_artifacts_config());
        assert(ts < artifacts_config.token_mint_end_timestamp, "me");

        assert(timestamp <= ts, "tf");
        assert(ts - timestamp <= 600, "ts old");

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        assert(self.view(planet_storage.verify_hash(planet_id, planet_hash)), "p");

        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        assert(
            self.view(planet_artifacts_storage.verify_hash(planet_id, planet_artifacts_hash)),
            "bad pa",
        );

        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        assert(
            self.view(planet_events_storage.verify_hash(planet_id, planet_events_hash)),
            "bad pe",
        );

        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        for i in 0..20 {
            if (i as u8) < planet_event_count {
                let arrival_id = arrival_ids[i];
                let art_id = artifacts_ids[i];
                if arrival_id != 0 {
                    assert(
                        self.view(arrival_storage.verify_hash(arrival_id, arrivals_hash[i])),
                        "bad arr",
                    );
                }
                if art_id != 0 {
                    assert(
                        self.view(artifact_storage.verify_hash(art_id, artifacts_hash[i])),
                        "bad art",
                    );
                    assert(
                        self.view(location_storage.verify_hash(art_id, artifact_locations_hash[i])),
                        "bad loc",
                    );
                }
            }
        }

        let player_storage = PlayerStorage::at(self.storage.player_storage_address.read());
        assert(self.view(player_storage.verify_hash(sender, player_hash)), "pl");

        self.call(planet_storage.set(planet_id, refreshed_planet));
        self.call(planet_events_storage.set(planet_id, new_planet_events));
        self.call(planet_artifacts_storage.set(planet_id, new_planet_artifacts));
        for i in 0..20 {
            if (i < planet_event_count as u32) & (artifacts_ids[i] != 0) {
                self.call(location_storage.set(artifacts_ids[i], new_artifact_locations[i]));
            }
        }

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

    /// Deposit (is_deposit=true) or withdraw (is_deposit=false) an artifact on a trading post.
    #[external("public")]
    fn deposit_or_withdraw_artifact(
        is_deposit: bool,
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
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "tf");
        assert(ts - timestamp <= 600, "ts old");
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
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "bad art",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "bad loc",
        );

        assert(new_planet.planet_type == PlanetType::TradingPost(), "not TP");
        assert(new_planet.owner == sender, "own");
        assert(!new_planet.destroyed, "d");
        assert(artifact != Artifact::zero(), "na");
        assert(new_planet.planet_level > artifact.rarity, "lv");
        assert(!artifact_utils::is_spaceship(artifact.artifact_type), "spaceship");

        if is_deposit {
            assert(artifact_location.voyage_id == 0, "in voyage");
            assert(new_planet_artifacts.count < 5, "full");
            let updated_artifacts =
                game_utils::add_artifact_id_to_planet_artifacts(artifact_id, new_planet_artifacts);
            self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
            let mut new_location = artifact_location;
            new_location.planet_id = location_id;
            new_location.last_updated = ts;
            self.call(location_storage.set(artifact_id, new_location));
        } else {
            assert(artifact_location.planet_id == location_id, "wp");
            let updated_artifacts = game_utils::remove_artifact_id_from_planet_artifacts(
                artifact_id,
                new_planet_artifacts,
            );
            self.call(planet_artifacts_storage.set(location_id, updated_artifacts));
            let mut new_location = artifact_location;
            new_location.planet_id = 0;
            new_location.last_updated = ts;
            self.call(location_storage.set(artifact_id, new_location));
        }
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
        world: World,
    ) {
        let sender = self.msg_sender();

        // notPaused
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "tf");
        assert(ts - timestamp <= 600, "ts old");
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

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());

        if wormhole_to != 0 {
            assert(
                self.view(planet_storage.verify_hash(
                    wormhole_planet_id,
                    poseidon2_hash(wormhole_planet.serialize()),
                )),
                "p",
            );
        }

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "bad art",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "bad loc",
        );

        assert(new_planet.owner == sender, "own");
        assert(!new_planet.destroyed, "d");
        assert(artifact != Artifact::zero(), "nf");
        assert(artifact_location.planet_id == location_id, "wp");

        {
            assert(artifact.artifact_type != ArtifactType::ShipCrescent(), "crescent");

            let active = game_utils::get_active_artifact(new_planet_artifacts, active_artifacts);
            assert(active == Artifact::zero(), "ae");

            let cooldown_seconds =
                artifact_utils::get_artifact_cooldown_seconds(artifact.artifact_type);
            if cooldown_seconds > 0 {
                let time_since_last = ts - artifact.last_deactivated;
                assert(time_since_last >= cooldown_seconds, "cooldown");
            }

            if artifact.artifact_type == ArtifactType::Wormhole() {
                assert(wormhole_to != 0, "wh");
                assert(wormhole_planet_id == wormhole_to, "wm");
                assert(wormhole_planet.owner == sender, "wo");
                assert(!wormhole_planet.destroyed, "wd");
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
                assert(2 * (artifact.rarity as u32) >= (new_planet_act.planet_level as u32), "tw");
                new_planet_act.population = new_planet_act.population_cap;
                new_planet_act.silver = new_planet_act.silver_cap;
                new_artifact.last_deactivated = ts;
            }

            if is_black_domain {
                assert(2 * (artifact.rarity as u32) >= (new_planet_act.planet_level as u32), "tw");
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
        assert(timestamp <= ts, "tf");
        assert(ts - timestamp <= 600, "ts old");
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

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());

        assert(
            self.view(artifact_storage.verify_hash(artifact_id, poseidon2_hash(artifact.serialize()))),
            "bad art",
        );
        assert(
            self.view(location_storage.verify_hash(
                artifact_id,
                poseidon2_hash(artifact_location.serialize()),
            )),
            "bad loc",
        );

        assert(new_planet.owner == sender, "own");
        assert(!new_planet.destroyed, "d");
        assert(artifact != Artifact::zero(), "nf");
        assert(artifact_location.planet_id == location_id, "wp");
        assert(artifact.last_activated > artifact.last_deactivated, "ia");

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

}
