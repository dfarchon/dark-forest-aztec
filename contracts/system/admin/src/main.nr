use ::aztec::macros::aztec;

#[aztec]
contract Admin {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, only_self}, storage::storage},
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };
    use ::aztec::state_vars::PublicMutable;

    use ::types::args::{AdminCreatePlanetArgs, DFPInitPlanetArgs};

    use ::types::config::{
        default_stats::PlanetDefaultStats,
        game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
        snark::SnarkConfig,
        space_junk::SpaceJunkConfig,
        world::WorldConfig,
    };

    use ::types::storage::{planet::Planet, player::Player, world::World};

    use ::libs::game_utils::{
        location_id_valid, revert_if_bad_snark_perlin_flags, space_type_from_perlin,
    };
    use ::libs::planet::{_initialize_planet, initialize_planet_with_defaults};

    use ::config::Config;

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
    }

    #[external("public")]
    #[initializer]
    fn constructor(amdinAddress: AztecAddress) {
        self.storage.admin.write(amdinAddress);
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
    fn get_player_storage_address() -> AztecAddress {
        self.storage.player_storage_address.read()
    }

    #[internal("public")]
    fn get_world_storage_address() -> AztecAddress {
        self.storage.world_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_storage_address() -> AztecAddress {
        self.storage.planet_storage_address.read()
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

    /// Batch set all storage addresses in a single transaction.
    #[external("public")]
    fn set_all_storage_addresses(
        config_addr: AztecAddress,
        world_addr: AztecAddress,
        player_addr: AztecAddress,
        planet_addr: AztecAddress,
    ) {
        self.internal.assert_admin();
        self.storage.config_storage_address.write(config_addr);
        self.storage.world_storage_address.write(world_addr);
        self.storage.player_storage_address.write(player_addr);
        self.storage.planet_storage_address.write(planet_addr);
    }

    /// Pause the game. Verifies world matches on-chain state via WorldStorage.verify(), then sets paused = true.
    #[external("public")]
    fn pause(world: World) {
        self.internal.assert_admin();

        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);
        let world_valid: bool = self.view(world_storage.verify(0, world));

        assert(world_valid, "World state is not valid");
        assert(!world.paused, "Game is already paused");

        let mut new_world = world;
        new_world.paused = true;
        self.call(world_storage.set(0, new_world));
    }

    #[external("public")]
    fn unpause(world: World) {
        self.internal.assert_admin();
        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);

        let world_valid: bool = self.view(world_storage.verify(0, world));
        assert(world_valid, "World state is not valid");
        assert(world.paused == true, "Game is already unpaused");

        let mut new_world = world;
        new_world.paused = false;
        self.call(world_storage.set(0, new_world));
    }

    #[external("public")]
    fn set_owner(planet_id: Field, planet_state: Planet, new_owner: AztecAddress) {
        self.internal.assert_admin();
        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);

        let planet_valid: bool = self.view(planet_storage.verify(planet_id, planet_state));
        assert(planet_valid, "Planet state is not valid");

        let mut new_planet_state = planet_state;
        new_planet_state.owner = new_owner;
        self.call(planet_storage.set(planet_id, new_planet_state));
    }

    #[external("public")]
    fn deduct_score(player_address: AztecAddress, player_state: Player, amount: u128) {
        self.internal.assert_admin();

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);

        let player_valid: bool = self.view(player_storage.verify(player_address, player_state));
        assert(player_valid, "Player is not valid");

        let current_timestamp = self.context.timestamp();
        assert(
            current_timestamp >= player_state.last_updated,
            "Timestamp must be >= player's last_updated",
        );

        assert(amount <= player_state.score, "tried to deduct much score");
        let mut new_player_state = player_state;
        new_player_state.score -= amount;
        new_player_state.last_updated = current_timestamp;
        self.call(player_storage.set(player_address, new_player_state));
    }

    #[external("public")]
    fn add_score(player_address: AztecAddress, player_state: Player, amount: u128) {
        self.internal.assert_admin();

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);

        let player_valid: bool = self.view(player_storage.verify(player_address, player_state));
        assert(player_valid, "Player is not valid");

        let current_timestamp = self.context.timestamp();
        assert(
            current_timestamp >= player_state.last_updated,
            "Timestamp must be >= player's last_updated",
        );

        let mut new_player_state = player_state;
        new_player_state.score += amount;
        new_player_state.last_updated = current_timestamp;
        self.call(player_storage.set(player_address, new_player_state));
    }

    /// Private function that performs all computation off-chain (in the private circuit).
    /// Config and state data are passed as inputs, validated via hashes in public.
    #[external("private")]
    fn safe_set_owner(
        x: Field, // private
        y: Field, // private
        r: u128,
        location_id: Field,
        perlin: u8,
        level: u8,
        new_owner: AztecAddress,
        timestamp: u64, // timestamp for private time-based computations
        // Config inputs (to be validated via hash in public)
        provided_snark_config: SnarkConfig,
        planet_default_stats: PlanetDefaultStats, // it is determined based on the level
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
    ) {
        if !provided_snark_config.disable_zk_checks {
            let planet_hash_key = provided_snark_config.planethash_key as Field;
            let space_type_key = provided_snark_config.spacetype_key as Field;
            let scale = provided_snark_config.perlin_length_scale;
            // Client: mirrorY affects x, mirrorX affects y. Circuit: x_mirror affects x, y_mirror affects y.
            let (expected_hash, expected_perlin) = circuits::reveal::reveal_proof(
                x,
                y,
                planet_hash_key,
                space_type_key,
                scale,
                provided_snark_config.perlin_mirror_y,
                provided_snark_config.perlin_mirror_x,
            );
            assert(expected_hash == location_id, "ZK check: location hash mismatch");
            assert(expected_perlin == perlin, "ZK check: perlin mismatch");
            // Radius check: x^2 + y^2 < r^2
            let r_field = r as Field;
            let dist_sq = (x * x + y * y) as u128;
            let r_sq = (r_field * r_field) as u128;
            assert(dist_sq < r_sq, "ZK check: coordinates outside radius");
        }

        let sender = self.msg_sender();

        // Compute config hashes for public verification
        let snark_config_hash = poseidon2_hash(provided_snark_config.serialize());
        let planet_default_stats_hash = poseidon2_hash(planet_default_stats.serialize());
        let world_config_hash = poseidon2_hash(world_config.serialize());
        let game_config_core_hash = poseidon2_hash(game_config_core.serialize());
        let planet_level_thresholds_hash = poseidon2_hash(planet_level_thresholds.serialize());
        let space_junk_config_hash = poseidon2_hash(space_junk_config.serialize());
        let planet_type_weights_tier_0_hash =
            poseidon2_hash(planet_type_weights_tier_0.serialize());
        let planet_type_weights_tier_1_hash =
            poseidon2_hash(planet_type_weights_tier_1.serialize());
        let planet_type_weights_tier_2_hash =
            poseidon2_hash(planet_type_weights_tier_2.serialize());
        let planet_type_weights_tier_3_hash =
            poseidon2_hash(planet_type_weights_tier_3.serialize());

        // Compute state hashes for public verification
        let planet_state_hash = if planet_state == Planet::zero() {
            0
        } else {
            poseidon2_hash(planet_state.serialize())
        };

        let planet_state_is_initialized: bool = planet_state != Planet::zero();

        let new_planet = if !planet_state_is_initialized {
            let mut planet: Planet = initialize_planet_with_defaults(
                location_id,
                perlin,
                planet_state.is_home_planet, // false
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

            planet.silver = planet.silver_cap;
            planet.population = planet.population_cap;
            planet.owner = new_owner;

            planet
        } else {
            assert(
                timestamp >= planet_state.last_updated,
                "Timestamp must be >= planet's last_updated",
            );

            let mut new_planet_state = planet_state;
            new_planet_state.owner = new_owner;
            new_planet_state.population = new_planet_state.population_cap;
            new_planet_state.silver = new_planet_state.silver_cap;
            new_planet_state.last_updated = timestamp;

            new_planet_state
        };

        // Pass hashes and computed results to public for verification and storage
        self.enqueue_self.safe_set_owner_public(
            sender,
            location_id,
            level,
            timestamp,
            // Config hashes for verification
            snark_config_hash,
            planet_default_stats_hash,
            world_config_hash,
            game_config_core_hash,
            planet_level_thresholds_hash,
            space_junk_config_hash,
            planet_type_weights_tier_0_hash,
            planet_type_weights_tier_1_hash,
            planet_type_weights_tier_2_hash,
            planet_type_weights_tier_3_hash,
            // State hashes for verification
            planet_state_hash,
            // Computed results to write
            new_planet,
        );
    }

    /// Public function that verifies hashes and writes computed results.
    /// All computation is done in private; this only validates and persists.
    #[external("public")]
    #[only_self]
    fn safe_set_owner_public(
        sender: AztecAddress,
        location_id: Field,
        level: u8,
        timestamp: u64,
        // Config hashes for verification
        snark_config_hash: Field,
        planet_default_stats_hash: Field,
        world_config_hash: Field,
        game_config_core_hash: Field,
        planet_level_thresholds_hash: Field,
        space_junk_config_hash: Field,
        planet_type_weights_tier_0_hash: Field,
        planet_type_weights_tier_1_hash: Field,
        planet_type_weights_tier_2_hash: Field,
        planet_type_weights_tier_3_hash: Field,
        // State hashes for verification
        planet_state_hash: Field,
        // Computed results to write
        new_planet: Planet,
    ) {
        // Verify sender is admin
        assert(sender == self.storage.admin.read(), "Only admin");

        // Verify timestamp is within a reasonable time window
        // Users can't know the exact on-chain timestamp in advance, so we allow a time window
        let actual_timestamp = self.context.timestamp();

        // Timestamp cannot be in the future
        assert(timestamp <= actual_timestamp, "Timestamp cannot be in the future");

        // Timestamp cannot be too old (e.g., 5 minutes = 300 seconds)
        // This prevents replay attacks with outdated timestamps
        let max_time_drift: u64 = 300; // 5 minutes tolerance
        assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old");

        // Verify all config hashes match on-chain state
        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);

        assert(
            self.view(config.verify_snark_config_hash(snark_config_hash)),
            "Snark config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_default_stats_hash(level, planet_default_stats_hash)),
            "Planet default stats hash mismatch",
        );
        assert(
            self.view(config.verify_world_config_hash(world_config_hash)),
            "World config hash mismatch",
        );
        assert(
            self.view(config.verify_game_config_core_hash(game_config_core_hash)),
            "Game config core hash mismatch",
        );
        assert(
            self.view(config.verify_planet_level_thresholds_hash(planet_level_thresholds_hash)),
            "Planet level thresholds hash mismatch",
        );
        assert(
            self.view(config.verify_space_junk_config_hash(space_junk_config_hash)),
            "Space junk config hash mismatch",
        );
        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                0,
                planet_type_weights_tier_0_hash,
            )),
            "Planet type weights tier 0 hash mismatch",
        );
        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                1,
                planet_type_weights_tier_1_hash,
            )),
            "Planet type weights tier 1 hash mismatch",
        );
        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                2,
                planet_type_weights_tier_2_hash,
            )),
            "Planet type weights tier 2 hash mismatch",
        );
        assert(
            self.view(config.verify_planet_type_weights_tier_hash(
                3,
                planet_type_weights_tier_3_hash,
            )),
            "Planet type weights tier 3 hash mismatch",
        );

        // Verify planet state hash matches on-chain stored root
        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);

        assert(
            self.view(planet_storage.verify_hash(location_id, planet_state_hash)),
            "Planet state hash mismatch",
        );

        // Write new planet state
        self.call(planet_storage.set(location_id, new_planet));
    }

    #[external("public")]
    fn admin_set_world_radius(new_radius: u128, world: World) {
        self.internal.assert_admin();
        let world_storage_address = self.internal.get_world_storage_address();
        let world_storage = WorldStorage::at(world_storage_address);
        let world_valid: bool = self.view(world_storage.verify(0, world));
        assert(world_valid, "World state is not valid");
        let mut new_world = world;
        new_world.radius = new_radius;
        self.call(world_storage.set(0, new_world));
    }

    #[external("public")]
    fn create_planet(args: AdminCreatePlanetArgs) {
        self.internal.assert_admin();

        let sender = self.msg_sender();

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let world_config = self.view(config.get_world_config());
        let game_config_core = self.view(config.get_game_config_core());
        let space_junk_config = self.view(config.get_space_junk_config());

        assert(world_config.admin_can_add_planets, "admin can no longer add planets");

        if args.require_valid_location_id {
            assert(
                location_id_valid(args.location, game_config_core.max_location_id),
                "Not a valid planet location",
            );
        }

        let space_type = space_type_from_perlin(args.perlin, game_config_core);

        let init_args = DFPInitPlanetArgs {
            location: args.location,
            perlin: args.perlin,
            level: args.level,
            time_factor_hundredths: world_config.time_factor_hundredths,
            space_type: space_type,
            planet_type: args.planet_type,
            is_home_planet: false,
        };

        let planet_default_stats = self.view(config.get_planet_default_stats(args.level));

        let mut planet: Planet = _initialize_planet(
            init_args,
            self.context.timestamp(),
            sender,
            planet_default_stats,
            world_config,
            space_junk_config,
        );

        let location_id = args.location;

        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        self.call(planet_storage.set(location_id, planet));
    }

    #[external("public")]
    fn admin_initialize_planet(location_id: Field, perlin: u8, level: u8) {
        self.internal.assert_admin();
        let sender = self.msg_sender();

        let planet_storage_address = self.internal.get_planet_storage_address();
        let planet_storage = PlanetStorage::at(planet_storage_address);
        let planet_is_uninitialized: bool =
            self.view(planet_storage.verify(location_id, Planet::zero()));
        assert(planet_is_uninitialized, "Planet is already initialized");

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let world_config = self.view(config.get_world_config());
        let game_config_core = self.view(config.get_game_config_core());
        let space_junk_config = self.view(config.get_space_junk_config());
        let planet_default_stats = self.view(config.get_planet_default_stats(level));
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier(3));

        let planet: Planet = initialize_planet_with_defaults(
            location_id,
            perlin,
            false,
            self.context.timestamp(),
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

        self.call(planet_storage.set(location_id, planet));
    }
}
