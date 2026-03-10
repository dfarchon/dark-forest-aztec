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

    use ::config::Config;

    use ::libs::artifact_utils::{
        artifact_from_create_args, create_and_place_spaceship, is_spaceship,
    };

    use ::libs::batch_utils::{
        assert_artifact_timestamp_freshness, assert_planet_timestamp_freshness,
        assert_public_timestamp, compute_artifact_hashes, compute_planet_hashes, compute_world_hash,
    };
    use ::libs::game_utils::{_put_artifact_on_planet, _take_artifact_off_planet};
    use ::libs::planet::refresh_planet;

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

    /// Noir port of Solidity `DFArtifactFacet.createArtifact`
    #[external("public")]
    fn create_artifact(args: DFTCreateArtifactArgs) {
        self.internal.assert_admin();

        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let artifact_location_storage =
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
            owner: AztecAddress::zero(),
            controller: args.controller,
            last_updated: timestamp,
        };

        // By default the artifact is on the planet (not in transit).
        let artifact_location =
            ArtifactLocation { planet_id: args.planet_id, voyage_id: 0, last_updated: timestamp };

        self.call(artifact_storage.set(args.id, artifact));
        self.call(artifact_location_storage.set(args.id, artifact_location));
    }

    /// Noir port of Solidity `DFArtifactFacet.updateArtifact`
    #[external("public")]
    fn update_artifact(id: Field, artifact: Artifact, location: ArtifactLocation) {
        self.internal.assert_admin();

        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());

        assert(
            self.view(artifact_storage.verify_hash(id, poseidon2_hash(artifact.serialize()))),
            "artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hash(id, poseidon2_hash(location.serialize()))),
            "artifact location hash mismatch",
        );

        self.call(artifact_storage.set(id, artifact));
        self.call(artifact_location_storage.set(id, location));
    }

    /// Noir port of Solidity `DFArtifactFacet.depositArtifact`.
    #[external("private")]
    fn deposit_artifact(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        planet: Planet,
        planet_artifacts_state: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        artifact: Artifact,
        artifact_location: ArtifactLocation,
        world: World,
    ) {
        let sender = self.msg_sender();

        assert(!world.paused, "Game is paused");

        assert_planet_timestamp_freshness(
            timestamp,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );

        assert_artifact_timestamp_freshness(timestamp, artifact, artifact_location);

        let planet_hashes_result = compute_planet_hashes(
            location_id,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );

        let artifact_hashes_result =
            compute_artifact_hashes(artifact_id, artifact, artifact_location);
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

        let artifact_hash = artifact_hashes_result.1;
        let artifact_location_hash = artifact_hashes_result.2;

        let world_hash: Field = world_hash_result;

        let refresh_planet_result = refresh_planet(
            timestamp,
            location_id,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = refresh_planet_result.0;
        let mut new_planet_events_state = refresh_planet_result.1;
        let mut new_planet_artifacts_state = refresh_planet_result.2;
        let mut new_artifact_locations = refresh_planet_result.3;

        assert(!new_planet.destroyed, "planet is destroyed");

        assert(
            new_planet.planet_type == PlanetType::TradingPost(),
            "can only deposit on trading posts",
        );

        assert(artifact.owner == sender, "you can only deposit artifacts you own");
        assert(new_planet.owner == sender, "you can only deposit on a planet you own");

        assert(artifact != Artifact::zero(), "artifact does not exist");

        assert(
            new_planet.planet_level > artifact.rarity,
            "spacetime rip not high enough level to deposit this artifact",
        );
        assert(!is_spaceship(artifact.artifact_type), "cannot deposit spaceships");

        assert(new_planet_artifacts_state.count < 5, "too many artifacts on this planet");

        let put_artifact_on_planet_result = _put_artifact_on_planet(
            artifact_id,
            artifact_location,
            location_id,
            new_planet_artifacts_state,
        );

        let mut new_artifact_location = put_artifact_on_planet_result.1;
        new_planet_artifacts_state = put_artifact_on_planet_result.3;

        let mut new_artifact = artifact;
        new_artifact.owner = AztecAddress::zero();

        new_planet.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;

        for i in 0..20 {
            if i < origin_arrivals_count {
                new_artifact_locations[i].last_updated = timestamp;
            }
        }

        new_artifact.last_updated = timestamp;
        new_artifact_location.last_updated = timestamp;

        self.enqueue_self.deposit_artifact_public(
            location_id,
            artifact_id,
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
            artifact_hash,
            artifact_location_hash,
            world_hash,
            new_planet,
            new_planet_artifacts_state,
            new_planet_events_state,
            new_artifact_locations,
            new_artifact,
            new_artifact_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn deposit_artifact_public(
        location_id: Field,
        artifact_id: Field,
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
        artifact_hash: Field,
        artifact_location_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_artifacts_state: PlanetArtifacts,
        new_planet_events_state: PlanetEvents,
        new_artifact_locations: [ArtifactLocation; 20],
        new_artifact: Artifact,
        new_artifact_location: ArtifactLocation,
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
            self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
            "artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hash(artifact_id, artifact_location_hash)),
            "artifact location hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "world hash mismatch");

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));
        self.call(planet_events_storage.set(location_id, new_planet_events_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            artifact_ids,
            new_artifact_locations,
            origin_arrivals_count as u32,
        ));

        self.call(artifact_storage.set(artifact_id, new_artifact));
        self.call(artifact_location_storage.set(artifact_id, new_artifact_location));
    }

    /// Noir port of Solidity `DFArtifactFacet.withdrawArtifact`.
    #[external("private")]
    fn withdraw_artifact(
        location_id: Field,
        artifact_id: Field,
        timestamp: u64,
        planet: Planet,
        planet_artifacts_state: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
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
            artifacts,
            artifact_locations,
        );

        assert_artifact_timestamp_freshness(timestamp, artifact, artifact_location);

        let planet_hashes_result = compute_planet_hashes(
            location_id,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );

        let artifact_hashes_result =
            compute_artifact_hashes(artifact_id, artifact, artifact_location);
        let world_hash_result = compute_world_hash(world);

        let planet_hash = planet_hashes_result.1;
        let planet_artifacts_state_hash = planet_hashes_result.2;
        let planet_events_state_hash = planet_hashes_result.3;
        let arrival_ids: [Field; 20] = planet_hashes_result.4;
        let arrival_hashes: [Field; 20] = planet_hashes_result.5;
        let artifact_ids: [Field; 20] = planet_hashes_result.6;
        let artifact_hashes: [Field; 20] = planet_hashes_result.7;
        let artifact_locations_hashes: [Field; 20] = planet_hashes_result.8;
        let origin_arrivals_count = planet_hashes_result.9;

        let artifact_hash = artifact_hashes_result.1;
        let artifact_location_hash = artifact_hashes_result.2;

        let world_hash = world_hash_result;

        let refresh_planet_result = refresh_planet(
            timestamp,
            location_id,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = refresh_planet_result.0;
        let mut new_planet_events_state = refresh_planet_result.1;
        let mut new_planet_artifacts_state = refresh_planet_result.2;
        let mut new_artifact_locations = refresh_planet_result.3;

        assert(!new_planet.destroyed, "planet is destroyed");

        assert(
            new_planet.planet_type == PlanetType::TradingPost(),
            "can only withdraw from trading posts",
        );

        assert(new_planet.owner == sender, "you can only deposit on a planet you own");

        assert(artifact != Artifact::zero(), "artifact does not exist");

        assert(
            new_planet.planet_level > artifact.rarity,
            "spacetime rip not high enough level to withdraw this artifact",
        );
        assert(!is_spaceship(artifact.artifact_type), "cannot deposit spaceships");

        let take_artifact_off_planet_result = _take_artifact_off_planet(
            artifact_id,
            artifact_location,
            artifact,
            location_id,
            new_planet_artifacts_state,
        );

        let mut new_artifact_location = take_artifact_off_planet_result.1;
        new_planet_artifacts_state = take_artifact_off_planet_result.3;

        let mut new_artifact = artifact;
        new_artifact.owner = sender;

        new_planet.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;

        for i in 0..20 {
            if i < origin_arrivals_count {
                new_artifact_locations[i].last_updated = timestamp;
            }
        }

        new_artifact.last_updated = timestamp;
        new_artifact_location.last_updated = timestamp;

        self.enqueue_self.withdraw_artifact_public(
            location_id,
            artifact_id,
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
            artifact_hash,
            artifact_location_hash,
            world_hash,
            new_planet,
            new_planet_artifacts_state,
            new_planet_events_state,
            new_artifact_locations,
            new_artifact,
            new_artifact_location,
        );
    }

    #[external("public")]
    #[only_self]
    fn withdraw_artifact_public(
        location_id: Field,
        artifact_id: Field,
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
        artifact_hash: Field,
        artifact_location_hash: Field,
        world_hash: Field,
        new_planet: Planet,
        new_planet_artifacts_state: PlanetArtifacts,
        new_planet_events_state: PlanetEvents,
        new_artifact_locations: [ArtifactLocation; 20],
        new_artifact: Artifact,
        new_artifact_location: ArtifactLocation,
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
            self.view(artifact_storage.verify_hash(artifact_id, artifact_hash)),
            "artifact hash mismatch",
        );
        assert(
            self.view(artifact_location_storage.verify_hash(artifact_id, artifact_location_hash)),
            "artifact location hash mismatch",
        );

        assert(self.view(world_storage.verify_hash(0, world_hash)), "world hash mismatch");

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));
        self.call(planet_events_storage.set(location_id, new_planet_events_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            artifact_ids,
            new_artifact_locations,
            origin_arrivals_count as u32,
        ));

        self.call(artifact_storage.set(artifact_id, new_artifact));
        self.call(artifact_location_storage.set(artifact_id, new_artifact_location));
    }

    /// Noir port of Solidity `DFArtifactFacet.giveSpaceShips`
    #[external("private")]
    fn give_spaceships(
        location_id: Field,
        timestamp: u64,
        planet: Planet,
        planet_artifacts_state: PlanetArtifacts,
        planet_events_state: PlanetEvents,
        arrivals: [Arrival; 20],
        artifacts: [Artifact; 20],
        artifact_locations: [ArtifactLocation; 20],
        player: Player,
        spaceships_config: SpaceshipsConfig,
    ) {
        let sender = self.msg_sender();

        assert(!player.claimed_ships, "player already claimed ships");
        assert(planet.owner == sender, "you can only spawn ships on your home planet");
        assert(planet.is_home_planet, "you can only spawn ships on your home planet");

        assert(planet_events_state.count == 0, "planet events must be empty");
        assert(planet_artifacts_state.count == 0, "planet artifacts must be empty");

        assert_planet_timestamp_freshness(
            timestamp,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );

        let planet_hashes_result = compute_planet_hashes(
            location_id,
            planet,
            planet_artifacts_state,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
        );

        let planet_hash = planet_hashes_result.1;
        let planet_artifacts_state_hash = planet_hashes_result.2;
        let planet_events_state_hash = planet_hashes_result.3;
        let arrival_ids: [Field; 20] = planet_hashes_result.4;
        let arrival_hashes: [Field; 20] = planet_hashes_result.5;
        let artifact_ids: [Field; 20] = planet_hashes_result.6;
        let artifact_hashes: [Field; 20] = planet_hashes_result.7;
        let artifact_locations_hashes: [Field; 20] = planet_hashes_result.8;
        let origin_arrivals_count = planet_hashes_result.9;

        let player_hash = if player == Player::zero() {
            0
        } else {
            poseidon2_hash(player.serialize())
        };

        let refresh_planet_result = refresh_planet(
            timestamp,
            location_id,
            planet,
            planet_events_state,
            arrivals,
            artifacts,
            artifact_locations,
            planet_artifacts_state,
        );

        let mut new_planet = refresh_planet_result.0;
        let mut new_planet_events_state = refresh_planet_result.1;
        let mut new_planet_artifacts_state = refresh_planet_result.2;
        let mut new_artifact_locations = refresh_planet_result.3;

        let mut nonce: u32 = 1;

        let mut spaceships_ids: [Field; 5] = [0; 5];
        let mut spaceships: [Artifact; 5] = [Artifact::zero(); 5];
        let mut spaceships_locations: [ArtifactLocation; 5] = [ArtifactLocation::zero(); 5];

        let ship_enabled: [bool; 5] = [
            spaceships_config.mothership,
            spaceships_config.crescent,
            spaceships_config.whale,
            spaceships_config.gear,
            spaceships_config.titan,
        ];
        let ship_types: [u8; 5] = [
            ArtifactType::ShipMothership(),
            ArtifactType::ShipCrescent(),
            ArtifactType::ShipWhale(),
            ArtifactType::ShipGear(),
            ArtifactType::ShipTitan(),
        ];

        let mut nonce: u32 = 1;
        for i in 0..5 {
            if ship_enabled[i] {
                let result = create_and_place_spaceship(location_id, sender, ship_types[i], nonce);
                let ship_id = result.0;
                let ship_args = result.1;

                let ship = artifact_from_create_args(ship_args, sender, timestamp);
                let mut ship_location = ArtifactLocation {
                    planet_id: location_id,
                    voyage_id: 0,
                    last_updated: timestamp,
                };

                let put_result = _put_artifact_on_planet(
                    ship_id,
                    ship_location,
                    location_id,
                    new_planet_artifacts_state,
                );

                ship_location = put_result.1;
                new_planet_artifacts_state = put_result.3;

                spaceships_ids[i] = ship_id;
                spaceships[i] = ship;
                spaceships_locations[i] = ship_location;

                nonce += 1;
            }
        }

        let mut new_player = player;
        new_player.claimed_ships = true;

        new_planet.last_updated = timestamp;
        new_planet_events_state.last_updated = timestamp;
        new_planet_artifacts_state.last_updated = timestamp;
        for i in 0..20 {
            if i < origin_arrivals_count {
                new_artifact_locations[i].last_updated = timestamp;
            }
        }
        new_player.last_updated = timestamp;
        for i in 0..5 {
            if ship_enabled[i] {
                spaceships[i].last_updated = timestamp;
                spaceships_locations[i].last_updated = timestamp;
            }
        }

        self.enqueue_self.give_spaceships_public(
            sender,
            location_id,
            timestamp,
            planet_hash,
            planet_artifacts_state_hash,
            planet_events_state_hash,
            arrival_ids,
            arrival_hashes,
            artifact_ids,
            artifact_hashes,
            artifact_locations_hashes,
            origin_arrivals_count,
            player_hash,
            new_planet,
            new_planet_events_state,
            new_planet_artifacts_state,
            new_artifact_locations,
            new_player,
            spaceships_ids,
            spaceships,
            spaceships_locations,
        );
    }

    #[external("public")]
    #[only_self]
    fn give_spaceships_public(
        sender: AztecAddress,
        location_id: Field,
        timestamp: u64,
        planet_hash: Field,
        planet_artifacts_state_hash: Field,
        planet_events_state_hash: Field,
        arrival_ids: [Field; 20],
        arrival_hashes: [Field; 20],
        artifact_ids: [Field; 20],
        artifact_hashes: [Field; 20],
        artifact_locations_hashes: [Field; 20],
        origin_arrivals_count: u32,
        player_hash: Field,
        new_planet: Planet,
        new_planet_events_state: PlanetEvents,
        new_planet_artifacts_state: PlanetArtifacts,
        new_artifact_locations: [ArtifactLocation; 20],
        new_player: Player,
        spaceships_ids: [Field; 5],
        spaceships: [Artifact; 5],
        spaceships_locations: [ArtifactLocation; 5],
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
        let player_storage = PlayerStorage::at(self.internal.get_player_storage_address());

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

        assert(self.view(player_storage.verify_hash(sender, player_hash)), "player hash mismatch");

        self.call(planet_storage.set(location_id, new_planet));
        self.call(planet_events_storage.set(location_id, new_planet_events_state));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));
        self.call(artifact_location_storage.set_arrival_locations_max20(
            artifact_ids,
            new_artifact_locations,
            origin_arrivals_count as u32,
        ));
        self.call(player_storage.set(sender, new_player));

        self.call(artifact_storage.set_spaceships_max5(spaceships_ids, spaceships, 5));

        self.call(artifact_location_storage.set_spaceship_locations_max5(
            spaceships_ids,
            spaceships_locations,
            5,
        ));
    }

    /// Noir port of Solidity `DFArtifactFacet.adminGiveArtifact`
    #[external("public")]
    fn admin_give_artifact(args: DFTCreateArtifactArgs, planet_artifacts_state: PlanetArtifacts) {
        self.internal.assert_admin();

        let artifact_storage = ArtifactStorage::at(self.internal.get_artifact_storage_address());
        let artifact_location_storage =
            ArtifactLocationStorage::at(self.internal.get_artifact_location_storage_address());

        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.internal.get_planet_artifacts_storage_address());

        let planet_artifacts_state_hash = if planet_artifacts_state == PlanetArtifacts::zero() {
            0
        } else {
            poseidon2_hash(planet_artifacts_state.serialize())
        };

        assert(
            self.view(planet_artifacts_storage.verify_hash(
                args.planet_id,
                planet_artifacts_state_hash,
            )),
            "planet_artifacts hash mismatch",
        );

        let timestamp = self.context.timestamp();

        let mut artifact = Artifact {
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
            owner: AztecAddress::zero(),
            controller: args.controller,
            last_updated: timestamp,
        };

        // By default the artifact is on the planet (not in transit).
        let mut artifact_location =
            ArtifactLocation { planet_id: args.planet_id, voyage_id: 0, last_updated: timestamp };

        let artifact_id = args.id;
        let location_id = args.planet_id;

        let put_artifact_on_planet_result = _put_artifact_on_planet(
            artifact_id,
            artifact_location,
            location_id,
            planet_artifacts_state,
        );

        let mut new_artifact_location = put_artifact_on_planet_result.1;
        let mut new_planet_artifacts_state = put_artifact_on_planet_result.3;

        self.call(artifact_storage.set(artifact_id, artifact));
        self.call(artifact_location_storage.set(artifact_id, new_artifact_location));
        self.call(planet_artifacts_storage.set(location_id, new_planet_artifacts_state));
    }
}
