use ::aztec::macros::aztec;

#[aztec]
contract ArtifactProspect {
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
        assert_artifact_timestamp_freshness, assert_owned_artifacts_timestamp_freshness,
        assert_planet_timestamp_freshness, assert_public_timestamp, compute_artifact_hashes,
        compute_owned_artifact_hashes, compute_planet_hashes, compute_world_hash,
    };
    use ::libs::game_utils::{
        _buff_planet, _debuff_planet, _default_planet, _get_biome, _get_upgrade_for_artifact,
        _put_artifact_on_planet, _random_artifact_type_and_level_bonus, _take_artifact_off_planet,
        artifact_rarity_from_planet_level, is_artifact_on_planet,
    };
    use ::libs::planet::{refresh_planet, refresh_planet_v2};

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

    #[internal("public")]
    fn get_config_storage_address() -> AztecAddress {
        self.storage.config_storage_address.read()
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
    fn get_player_storage_address() -> AztecAddress {
        self.storage.player_storage_address.read()
    }

    #[internal("public")]
    fn get_world_storage_address() -> AztecAddress {
        self.storage.world_storage_address.read()
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

    /// Noir port of Solidity `DFArtifactFacet.prospectPlanet`
    #[external("private")]
    fn prospect_planet(
        location_id: Field,
        timestamp: u64,
        planet: Planet,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        arrival_artifacts: [Artifact; 20],
        arrival_artifact_locations: [ArtifactLocation; 20],
        planet_artifacts_state: PlanetArtifacts,
        owned_artifacts: [Artifact; 20],
        owned_artifact_locations: [ArtifactLocation; 20],
        world: World,
        spaceships_config: SpaceshipsConfig,
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

        let world_hash_result: Field = compute_world_hash(world);

        let planet_hash = planet_hashes_result.1;
        let planet_artifacts_state_hash = planet_hashes_result.2;
        let planet_events_state_hash = planet_hashes_result.3;
        let arrival_ids: [Field; 20] = planet_hashes_result.4;
        let arrival_hashes: [Field; 20] = planet_hashes_result.5;
        let artifact_ids: [Field; 20] = planet_hashes_result.6;
        let artifact_hashes: [Field; 20] = planet_hashes_result.7;
        let artifact_locations_hashes: [Field; 20] = planet_hashes_result.8;
        let origin_arrivals_count = planet_hashes_result.9;

        let owned_artifact_ids: [Field; 20] = owned_artifact_hashes_result.0;
        let owned_artifact_hashes: [Field; 20] = owned_artifact_hashes_result.1;
        let owned_artifact_locations_hashes: [Field; 20] = owned_artifact_hashes_result.2;
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

        let mut artifacts: [Artifact; 20] = [Artifact::zero(); 20];
        for i in 0..20 {
            if i < planet_artifacts_state.count {
                artifacts[i] = owned_artifacts[i];
            }
        }
        for i in 0..20 {
            if i < change_artifact_location_count {
                let id = change_artifact_location_ids[i];
                for j in 0..20 {
                    if arrivals[j].carried_artifact_id == id {
                        artifacts[planet_artifacts_state.count + i] = arrival_artifacts[j];
                    }
                }
            }
        }

        assert(!new_planet.destroyed, "planet is destroyed");
        assert(new_planet.planet_type == PlanetType::Ruins, "not a ruins");
        assert(new_planet.owner == sender, "you must own this planet");
        assert(new_planet.prospected_block_number == 0, "this planet has already been prospected");

        if spaceships_config.gear {
            assert(
                contains_gear(sender, new_planet_artifacts_state, artifacts),
                "gear ship must be present on planet",
            );
        }

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < change_artifact_location_count {
                change_artifact_locations[i].last_updated = timestamp;
            }
        }

        self.enqueue_self.prospect_planet_public(
            location_id,
            timestamp,
            planet_hash,
            planet_artifacts_state_hash,
            planet_events_state_hash,
            origin_arrivals_count,
            arrival_ids,
            arrival_hashes,
            artifact_ids,
            artifact_hashes,
            artifact_locations_hashes,
            world_hash,
            new_planet,
            new_planet_artifacts_state,
            new_planet_events_state,
            change_artifact_location_count,
            change_artifact_location_ids,
            change_artifact_locations,
            owned_artifact_ids,
            owned_artifact_hashes,
            owned_artifact_locations_hashes,
            owned_artifact_count,
        );
    }

    #[external("public")]
    #[only_self]
    fn prospect_planet_public(
        location_id: Field,
        timestamp: u64,
        planet_hash: Field,
        planet_artifacts_state_hash: Field,
        planet_events_state_hash: Field,
        origin_arrivals_count: u32,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        artifact_ids: [Field; 20],
        artifact_hashes: [Field; 20],
        artifact_locations_hashes: [Field; 20],
        world_hash: Field,
        new_planet: Planet,
        new_planet_artifacts_state: PlanetArtifacts,
        new_planet_events_state: PlanetEvents,
        change_artifact_location_count: u32,
        change_artifact_location_ids: [Field; 20],
        change_artifact_locations: [ArtifactLocation; 20],
        owned_artifact_ids: [Field; 20],
        owned_artifact_hashes: [Field; 20],
        owned_artifact_locations_hashes: [Field; 20],
        owned_artifact_count: u32,
    ) {
        let actual_timestamp = self.context.timestamp();

        assert_public_timestamp(timestamp, actual_timestamp);

        let arrival_storage = ArrivalStorage::at(self.internal.get_arrivals_storage_address());
        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());
        let planet_storage = PlanetStorage::at(self.internal.get_planet_storage_address());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());
        let planet_events_storage =
            PlanetEventsStorage::at(self.internal.get_planet_events_storage_address());
        let world_storage = WorldStorage::at(self.internal.get_world_storage_address());

        assert(
            self.view(planet_storage.verify_hash(location_id, planet_hash)),
            "planet hash mismatch",
        );
        assert(
            self.view(planet_artifacts_storage.verify_hash(location_id, planet_artifacts_state_hash)),
            "planet_artifacts hash mismatch",
        );
        assert(
            self.view(planet_events_storage.verify_hash(location_id, planet_events_state_hash)),
            "planet_events hash mismatch",
        );

        assert(
            self.view(arrival_storage.verify_hashes_batch(
                arrival_ids,
                arrival_hashes,
                origin_arrivals_count as u32,
            )),
            "arrivals hash mismatch",
        );
        assert(
            self.view(artifact_storage.verify_hashes_batch(
                artifact_ids,
                artifact_hashes,
                origin_arrivals_count as u32,
            )),
            "artifacts hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                artifact_ids,
                artifact_locations_hashes,
                origin_arrivals_count as u32,
            )),
            "artifact locations hash mismatch",
        );

        assert(
            self.view(artifact_storage.verify_hashes_batch(
                owned_artifact_ids,
                owned_artifact_hashes,
                owned_artifact_count as u32,
            )),
            "owned artifact hashes mismatch",
        );

        assert(
            self.view(artifact_location_storage.verify_hashes_batch(
                owned_artifact_ids,
                owned_artifact_locations_hashes,
                owned_artifact_count as u32,
            )),
            "owned artifact locations hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "world hash mismatch");

        let mut prospect_planet = new_planet;
        prospect_planet.prospected_block_number = self.context.block_number();

        self.call(planet_storage.set(location_id, prospect_planet));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));
        self.call(planet_events_storage.set(location_id, new_planet_events_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            change_artifact_location_ids,
            change_artifact_locations,
            change_artifact_location_count,
        ));
    }

}
