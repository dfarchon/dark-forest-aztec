use ::aztec::macros::aztec;

#[aztec]
contract ArtifactAction {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, only_self, view}, storage::storage},
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
        assert_artifact_and_location_timestamp_freshness,
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

    /// Noir port of Solidity `DFArtifactFacet.activateArtifact`
    #[external("private")]
    fn activate_artifact(
        location_id: Field,
        artifact_id: Field,
        wormhole_to: Field,
        timestamp: u64,
        // State inputs (to be validated via hash in public)
        planet: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        artifact: Artifact,
        artifact_location: ArtifactLocation,
        world: World,
        world_config: WorldConfig,
        planet_default_stats: PlanetDefaultStats,
    ) {
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

        assert_artifact_and_location_timestamp_freshness(timestamp, artifact, artifact_location);

        let planet_hashes_result = compute_planet_hashes(
            location_id,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let artifact_hashes_result =
            compute_artifact_and_location_hashes(artifact_id, artifact, artifact_location);

        let world_hash_result = compute_world_hash(world);

        let planet_hash = planet_hashes_result.1;
        let planet_events_state_hash = planet_hashes_result.3;
        let arrival_ids: [Field; 20] = planet_hashes_result.4;
        let arrival_hashes: [Field; 20] = planet_hashes_result.5;
        let arrival_artifact_ids: [Field; 20] = planet_hashes_result.6;
        let arrival_artifact_hashes: [Field; 20] = planet_hashes_result.7;
        let arrival_artifact_location_hashes: [Field; 20] = planet_hashes_result.8;
        let origin_arrivals_count = planet_hashes_result.9;
        let planet_artifacts_state_hash = planet_hashes_result.2;
        let artifact_hash = artifact_hashes_result.1;
        let artifact_location_hash = artifact_hashes_result.2;
        let world_hash = world_hash_result;
        let world_config_hash = poseidon2_hash(world_config.serialize());
        let planet_default_stats_hash = poseidon2_hash(planet_default_stats.serialize());

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

        let mut new_artifact = artifact;
        let mut new_artifact_location = artifact_location;

        // If this artifact arrived via a voyage that completed during refresh,
        // use the refreshed location instead of the stale input.
        for i in 0..20 {
            if i < change_artifact_location_count {
                if change_artifact_location_ids[i] == artifact_id {
                    new_artifact_location = change_artifact_locations[i];
                }
            }
        }

        assert(!new_planet.destroyed, "planet is destroyed");
        assert(
            is_artifact_on_planet(location_id, new_planet_artifacts_state, artifact_id),
            "can't active an artifact on a planet it's not on",
        );
        assert(artifact != Artifact::zero(), "artifact not found");

        let is_spaceship = is_spaceship(new_artifact.artifact_type);

        if is_spaceship {
            // activateSpaceshipArtifact
            let is_crescent = new_artifact.artifact_type == ArtifactType::ShipCrescent;

            if is_crescent {
                assert(
                    new_artifact.activations == 0,
                    "crescent cannot be activated more than once",
                );
                assert(new_planet.planet_type != 1, "cannot turn a silver mine into a silver mine");
                assert(
                    new_planet.owner == AztecAddress::zero(),
                    "can only activate crescent on unowned planets",
                );
                assert(new_planet.planet_level >= 1, "planet level must be more than one");

                new_artifact.last_activated = timestamp;
                new_artifact.last_deactivated = timestamp;

                if new_planet.silver == 0 {
                    new_planet.silver = 1;

                    let default_planet = _default_planet(
                        location_id,
                        new_planet.planet_level,
                        PlanetType::SilverMine,
                        new_planet.space_type,
                        world_config.time_factor_hundredths,
                        planet_default_stats,
                    );

                    new_planet.silver_growth = default_planet.silver_growth;
                }
                new_planet.planet_type = PlanetType::SilverMine;
            }
        } else {
            // activateNonSpaceshipArtifact
            assert(
                new_planet.owner == sender,
                "you must own the planet you are activating an artifact on",
            );

            let artifact_cooldown_hours: [u64; 10] = [24, 0, 0, 0, 0, 4, 4, 24, 24, 24];
            let cooldown_hours = artifact_cooldown_hours[new_artifact.artifact_type as u32];
            assert(
                new_artifact.last_deactivated + cooldown_hours * 60 * 60 < timestamp,
                "this artifact is on a cooldown",
            );

            let mut shoud_deactivate_and_burn = false;

            new_artifact.last_activated = timestamp;

            if new_artifact.artifact_type == ArtifactType::Wormhole {
                assert(wormhole_to != 0, "you must provide a wormholeTo to activate a wormhole");
                assert(
                    new_planet.owner == sender,
                    "you can only create a wormhole to a planet you own",
                );
                assert(!new_planet.destroyed, "planet destroyed");
                new_artifact.wormhole_to = wormhole_to;
            } else if new_artifact.artifact_type == ArtifactType::BloomFilter {
                assert(
                    2 * (new_artifact.rarity as u32) >= (new_planet.planet_level as u32),
                    "artifact is not powerful enough to apply effect to this planet level",
                );
                new_planet.population = new_planet.population_cap;
                new_planet.silver = new_planet.silver_cap;
                shoud_deactivate_and_burn = true;
            } else if new_artifact.artifact_type == ArtifactType::BlackDomain {
                assert(
                    2 * (new_artifact.rarity as u32) >= (new_planet.planet_level as u32),
                    "artifact is not powerful enough to apply effect to this planet level",
                );
                new_planet.destroyed = true;
                shoud_deactivate_and_burn = true;
            }

            if shoud_deactivate_and_burn {
                new_artifact.last_deactivated = timestamp;

                let take_artifact_off_planet_result = _take_artifact_off_planet(
                    artifact_id,
                    artifact_location,
                    artifact,
                    location_id,
                    new_planet_artifacts_state,
                );

                new_artifact_location = take_artifact_off_planet_result.1;
                new_planet_artifacts_state = take_artifact_off_planet_result.3;
            }

            let upgrade = _get_upgrade_for_artifact(new_artifact);
            let buff_planet_result = _buff_planet(location_id, new_planet, upgrade);
            new_planet = buff_planet_result.1;
        }

        new_artifact.activations += 1;

        let mut change_artifact_location_count = refresh_planet_result.3;
        let mut change_artifact_location_ids = refresh_planet_result.4;
        let mut change_artifact_locations = refresh_planet_result.5;

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

        self.enqueue_self.activate_artifact_public(
            location_id,
            artifact_id,
            wormhole_to,
            timestamp,
            planet_hash,
            planet_events_state_hash,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            origin_arrivals_count,
            planet_artifacts_state_hash,
            artifact_hash,
            artifact_location_hash,
            world_hash,
            world_config_hash,
            planet_default_stats_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            change_artifact_location_count,
            change_artifact_location_ids,
            change_artifact_locations,
            new_artifact,
            new_artifact_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn activate_artifact_public(
        location_id: Field,
        artifact_id: Field,
        wormhole_to: Field,
        timestamp: u64,
        planet_hash: Field,
        planet_events_state_hash: Field,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        origin_arrivals_count: u32,
        planet_artifacts_state_hash: Field,
        artifact_hash: Field,
        artifact_location_hash: Field,
        world_hash: Field,
        world_config_hash: Field,
        planet_default_stats_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        change_artifact_location_count: u32,
        change_artifact_location_ids: [Field; 20],
        change_artifact_locations: [ArtifactLocation; 20],
        new_artifact: Artifact,
        new_artifact_location: ArtifactLocation,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());
        let config = Config::at(self.storage.config_storage_address.read());

        // Verify planet state hashes
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

        // Batch verify arrival hashes
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

        // Verify the artifact being activated
        assert(
            self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
            "artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hash(artifact_id, artifact_location_hash)),
            "artifact_location hash mismatch",
        );

        // Verify world hash
        assert(self.view(world_storage.verify_hash(0, world_hash)), "world hash mismatch");

        // Verify config hashes (world_config used for time_factor, planet_default_stats for Crescent activation)
        assert(
            self.view(config.verify_world_config_hash(world_config_hash)),
            "world config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_default_stats_hash(
                new_planet.planet_level,
                planet_default_stats_hash,
            )),
            "planet default stats hash mismatch",
        );

        // Write refreshed planet state
        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_events_storage.set(location_id, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));

        // Batch write changed artifact locations from refresh
        self.call(artifact_location_storage.set_arrival_locations_max20(
            change_artifact_location_ids,
            change_artifact_locations,
            change_artifact_location_count,
        ));

        // Write the activated artifact and its location
        self.call(artifact_storage.set(artifact_id, new_artifact));
        self.call(artifact_location_storage.set(artifact_id, new_artifact_location));
    }

    /// Noir port of Solidity `DFArtifactFacet.deactivateArtifact`.
    #[external("private")]
    fn deactivate_artifact(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        planet: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        artifact: Artifact,
        artifact_location: ArtifactLocation,
        world: World,
    ) {
        let sender = self.msg_sender();

        assert_planet_timestamp_freshness(
            timestamp,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        assert_artifact_and_location_timestamp_freshness(timestamp, artifact, artifact_location);

        let planet_hashes_result = compute_planet_hashes(
            location_id,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            arrival_artifacts,
            arrival_artifact_locations,
        );

        let artifact_hashes_result =
            compute_artifact_and_location_hashes(artifact_id, artifact, artifact_location);

        let world_hash_result = compute_world_hash(world);

        let planet_hash = planet_hashes_result.1;
        let planet_events_state_hash = planet_hashes_result.3;
        let arrival_ids: [Field; 20] = planet_hashes_result.4;
        let arrival_hashes: [Field; 20] = planet_hashes_result.5;
        let arrival_artifact_ids: [Field; 20] = planet_hashes_result.6;
        let arrival_artifact_hashes: [Field; 20] = planet_hashes_result.7;
        let arrival_artifact_location_hashes: [Field; 20] = planet_hashes_result.8;
        let origin_arrivals_count = planet_hashes_result.9;
        let planet_artifacts_state_hash = planet_hashes_result.2;
        let artifact_hash = artifact_hashes_result.1;
        let artifact_location_hash = artifact_hashes_result.2;
        let world_hash = world_hash_result;

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

        let mut new_artifact = artifact;
        let mut new_artifact_location = artifact_location;

        // If this artifact arrived via a voyage that completed during refresh,
        // use the refreshed location instead of the stale input.
        for i in 0..20 {
            if i < change_artifact_location_count {
                if change_artifact_location_ids[i] == artifact_id {
                    new_artifact_location = change_artifact_locations[i];
                }
            }
        }

        assert(
            new_planet.owner == sender,
            "you must own the planet you are deactivating an artifact on",
        );
        assert(!new_planet.destroyed, "planet is destroyed");
        assert(
            is_artifact_on_planet(location_id, new_planet_artifacts_state, artifact_id),
            "can't deactivate an artifact on a planet it's not on",
        );
        assert(new_artifact != Artifact::zero(), "this artifact is not on this planet");
        assert(
            new_artifact.last_activated > new_artifact.last_deactivated,
            "artifact not activated",
        );

        new_artifact.last_deactivated = timestamp;
        new_artifact.wormhole_to = 0;

        let should_burn = (new_artifact.artifact_type == ArtifactType::PlanetaryShield)
            | (new_artifact.artifact_type == ArtifactType::PhotoidCannon);

        if should_burn {
            let take_artifact_off_planet_result = _take_artifact_off_planet(
                artifact_id,
                new_artifact_location,
                new_artifact,
                location_id,
                new_planet_artifacts_state,
            );

            new_artifact_location = take_artifact_off_planet_result.1;
            new_planet_artifacts_state = take_artifact_off_planet_result.3;
        }

        let upgrade = _get_upgrade_for_artifact(new_artifact);
        let debuff_planet_result = _debuff_planet(location_id, new_planet, upgrade);
        new_planet = debuff_planet_result.1;

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

        self.enqueue_self.deactivate_artifact_public(
            location_id,
            artifact_id,
            timestamp,
            planet_hash,
            planet_events_state_hash,
            arrival_ids,
            arrival_hashes,
            arrival_artifact_ids,
            arrival_artifact_hashes,
            arrival_artifact_location_hashes,
            origin_arrivals_count,
            planet_artifacts_state_hash,
            artifact_hash,
            artifact_location_hash,
            world_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            change_artifact_location_count,
            change_artifact_location_ids,
            change_artifact_locations,
            new_artifact,
            new_artifact_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn deactivate_artifact_public(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        planet_hash: Field,
        planet_events_state_hash: Field,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        arrival_artifact_ids: [Field; 20],
        arrival_artifact_hashes: [Field; 20],
        arrival_artifact_location_hashes: [Field; 20],
        origin_arrivals_count: u32,
        planet_artifacts_state_hash: Field,
        artifact_hash: Field,
        artifact_location_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        change_artifact_location_count: u32,
        change_artifact_location_ids: [Field; 20],
        change_artifact_locations: [ArtifactLocation; 20],
        new_artifact: Artifact,
        new_artifact_location: ArtifactLocation,
    ) {
        let actual_timestamp = self.context.timestamp();
        assert_public_timestamp(timestamp, actual_timestamp);

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        let planet_events_storage =
            PlanetEventsStorage::at(self.storage.planet_events_storage_address.read());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let arrival_storage = ArrivalStorage::at(self.storage.arrivals_storage_address.read());
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let world_storage = WorldStorage::at(self.storage.world_storage_address.read());

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
            self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
            "artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hash(artifact_id, artifact_location_hash)),
            "artifact_location hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "world hash mismatch");

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
    }
}
