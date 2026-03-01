use ::aztec::macros::aztec;

/// Extension contract for ArtifactSystem. Contains admin/CRUD functions, spaceships,
/// crescent activation, and view helpers that were split out to keep ArtifactSystem under
/// the 3000-field public bytecode limit.
#[aztec]
contract ArtifactExt {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, view}, storage::storage},
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };
    use ::aztec::state_vars::PublicMutable;

    use ::types::args::DFTCreateArtifactArgs;
    use ::types::config::{
        default_stats::PlanetDefaultStats, spaceships::SpaceshipsConfig, world::WorldConfig,
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
    use ::libs::planet::{assert_refresh_timestamp_monotonicity, refresh_planet_and_apply_timestamp};

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
        admin: PublicMutable<AztecAddress, Context>,
        config_storage_address: PublicMutable<AztecAddress, Context>,
        world_storage_address: PublicMutable<AztecAddress, Context>,
        player_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_storage_address: PublicMutable<AztecAddress, Context>,
        artifact_location_storage_address: PublicMutable<AztecAddress, Context>,
        planet_storage_address: PublicMutable<AztecAddress, Context>,
        planet_artifacts_storage_address: PublicMutable<AztecAddress, Context>,
        planet_events_storage_address: PublicMutable<AztecAddress, Context>,
        arrivals_storage_address: PublicMutable<AztecAddress, Context>,
    }

    // ========== Internal helpers ==========

    #[internal("public")]
    fn assert_not_paused(world: World) {
        let ws = WorldStorage::at(self.storage.world_storage_address.read());
        assert(self.view(ws.verify(0, world)), "bad world");
        assert(!world.paused, "paused");
    }

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
        let (arrival_ids, arrivals_hash, artifact_ids, artifacts_hash, artifact_locations_hash) = ::libs::planet::build_refresh_event_hashes(
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

    // ========== Initializer & admin ==========

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    #[external("public")]
    fn transfer_admin(new_admin: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
        self.storage.admin.write(new_admin);
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
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");
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

    // ========== Artifact CRUD ==========

    #[external("public")]
    fn create_artifact(args: DFTCreateArtifactArgs) {
        let sender = self.msg_sender();
        assert(
            (sender == self.context.this_address()) | (sender == self.storage.admin.read()),
            "only admin or self",
        );

        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());

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

        let location =
            ArtifactLocation { planet_id: args.planet_id, voyage_id: 0, last_updated: timestamp };

        self.call(artifact_storage.set(args.id, artifact));
        self.call(location_storage.set(args.id, location));
    }

    #[external("public")]
    fn update_artifact(id: Field, artifact: Artifact, location: ArtifactLocation) {
        let sender = self.msg_sender();
        assert(
            (sender == self.context.this_address()) | (sender == self.storage.admin.read()),
            "only admin or self",
        );

        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());

        let stored_root = self.view(artifact_storage.get_state_root(id));
        assert(stored_root != 0, "artifact not found");

        self.call(artifact_storage.set(id, artifact));
        self.call(location_storage.set(id, location));
    }

    // ========== View helpers ==========

    #[external("public")]
    #[view]
    fn does_artifact_exist(id: Field, artifact: Artifact) -> bool {
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let hash = poseidon2_hash(artifact.serialize());

        if artifact == Artifact::zero() {
            false
        } else {
            assert(self.view(artifact_storage.verify_hash(id, hash)), "artifact hash mismatch");
            true
        }
    }

    #[external("public")]
    #[view]
    fn get_artifact_hash(id: Field) -> Field {
        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        self.view(artifact_storage.get_state_root(id))
    }

    // ========== Admin: give artifact to planet ==========

    #[external("public")]
    fn admin_give_artifact(args: DFTCreateArtifactArgs, planet_artifacts: PlanetArtifacts) {
        assert(self.msg_sender() == self.storage.admin.read(), "Only admin");

        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());
        assert(
            self.view(planet_artifacts_storage.verify_hash(
                args.planet_id,
                poseidon2_hash(planet_artifacts.serialize()),
            )),
            "planet_artifacts hash mismatch",
        );

        self.call(ArtifactExt::at(self.context.this_address()).create_artifact(args));

        let updated_artifacts =
            game_utils::add_artifact_id_to_planet_artifacts(args.id, planet_artifacts);
        self.call(planet_artifacts_storage.set(args.planet_id, updated_artifacts));
    }

    // ========== Spaceships ==========

    #[external("public")]
    fn give_space_ships(
        location_id: Field,
        planet: Planet,
        player: Player,
        planet_artifacts: PlanetArtifacts,
    ) {
        let sender = self.msg_sender();

        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());
        let player_storage = PlayerStorage::at(self.storage.player_storage_address.read());
        let planet_artifacts_storage =
            PlanetArtifactsStorage::at(self.storage.planet_artifacts_storage_address.read());

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

        assert(!player.claimed_ships, "already claimed");
        assert(planet.owner == sender, "not owner");
        assert(planet.is_home_planet, "not home planet");

        let config_storage = Config::at(self.storage.config_storage_address.read());
        let spaceships_config: SpaceshipsConfig = self.view(config_storage.get_spaceships_config());

        let mut updated_artifacts = planet_artifacts;
        let mut nonce: u32 = 0;
        let self_addr = self.context.this_address();

        if spaceships_config.mothership {
            let (id, args) =
                artifact_utils::build_create_spaceship_args(location_id, sender, 10, nonce);
            self.call(ArtifactExt::at(self_addr).create_artifact(args));
            updated_artifacts =
                game_utils::add_artifact_id_to_planet_artifacts(id, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.crescent {
            let (id, args) =
                artifact_utils::build_create_spaceship_args(location_id, sender, 11, nonce);
            self.call(ArtifactExt::at(self_addr).create_artifact(args));
            updated_artifacts =
                game_utils::add_artifact_id_to_planet_artifacts(id, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.whale {
            let (id, args) =
                artifact_utils::build_create_spaceship_args(location_id, sender, 12, nonce);
            self.call(ArtifactExt::at(self_addr).create_artifact(args));
            updated_artifacts =
                game_utils::add_artifact_id_to_planet_artifacts(id, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.gear {
            let (id, args) =
                artifact_utils::build_create_spaceship_args(location_id, sender, 13, nonce);
            self.call(ArtifactExt::at(self_addr).create_artifact(args));
            updated_artifacts =
                game_utils::add_artifact_id_to_planet_artifacts(id, updated_artifacts);
            nonce += 1;
        }

        if spaceships_config.titan {
            let (id, args) =
                artifact_utils::build_create_spaceship_args(location_id, sender, 14, nonce);
            self.call(ArtifactExt::at(self_addr).create_artifact(args));
            updated_artifacts =
                game_utils::add_artifact_id_to_planet_artifacts(id, updated_artifacts);
            nonce += 1;
        }

        self.call(planet_artifacts_storage.set(location_id, updated_artifacts));

        let mut new_player = player;
        new_player.claimed_ships = true;
        self.call(player_storage.set(sender, new_player));
    }

    // ========== Crescent activation ==========

    /// Activate a crescent spaceship on a planet (turns it into a silver mine).
    /// Split out from ArtifactSystem.activate_artifact to save bytecode.
    #[external("public")]
    fn activate_crescent(
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
        self.internal.assert_not_paused(world);

        let ts = self.context.timestamp();
        assert(timestamp <= ts, "ts future");
        assert(ts - timestamp <= 300, "ts old");
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

        let artifact_storage = ArtifactStorage::at(self.storage.artifact_storage_address.read());
        let location_storage =
            ArtifactLocationStorage::at(self.storage.artifact_location_storage_address.read());
        let planet_storage = PlanetStorage::at(self.storage.planet_storage_address.read());

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

        assert(artifact.artifact_type == ArtifactType::ShipCrescent(), "not crescent");
        assert(artifact.activations == 0, "already activated");
        assert(new_planet.planet_type != 1, "already silver mine");
        assert(new_planet.owner == AztecAddress::zero(), "planet is owned");
        assert(new_planet.planet_level >= 1, "level too low");
        assert(!new_planet.destroyed, "destroyed");
        assert(artifact_location.planet_id == location_id, "not on planet");

        let mut new_artifact = artifact;
        new_artifact.activations += 1;
        new_artifact.last_activated = ts;
        new_artifact.last_deactivated = ts;
        new_artifact.last_updated = ts;

        let mut new_planet_crescent = new_planet;
        if new_planet_crescent.silver == 0 {
            new_planet_crescent.silver = 1;
            let config_storage = Config::at(self.storage.config_storage_address.read());
            let default_stats: PlanetDefaultStats = self.view(config_storage
                .get_planet_default_stats(new_planet_crescent.planet_level));
            let world_config: WorldConfig = self.view(config_storage.get_world_config());
            let (silver_growth, _silver_cap, _initial_silver) = artifact_utils::default_planet_silver_stats(
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
    }
}
