use dep::aztec::macros::aztec;

#[aztec]
contract Admin {
    use dep::aztec::{
        macros::{
            events::event,
            functions::{external, initializer, internal, only_self, view},
            storage::storage,
        },
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::Packable},
    };
    use dep::aztec::state_vars::{Map, PublicMutable};

    use dep::types::args::{
        AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs,
    };

    use dep::types::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetDefaultStats,
        PlanetLevelThresholds, PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig,
        SpaceshipsConfig, Upgrade, WorldConfig,
    };

    use dep::types::storage::{
        Arrival, ArrivalType, Artifact, ArtifactRarity, ArtifactState, ArtifactType, GlobalState,
        Planet, PlanetArtifacts, PlanetCaps, PlanetData, PlanetEventMetadata, PlanetEvents,
        PlanetEventType, PlanetFullState, PlanetMeta, PlanetMods, PlanetOwner, PlanetResources,
        PlanetType, Player, RevealedCoords, SpaceType, StateRoot, UpgradeBranch,
    };

    use dep::libs::game_utils::{
        location_id_valid, revert_if_bad_snark_perlin_flags, space_type_from_perlin,
    };
    use dep::libs::planet::{_initialize_planet, initialize_planet_with_defaults};

    use dep::config::Config;

    use dep::global_state_storage::GlobalStateStorage;
    use dep::planet_caps_storage::PlanetCapsStorage;
    use dep::planet_meta_storage::PlanetMetaStorage;
    use dep::planet_mods_storage::PlanetModsStorage;
    use dep::planet_owner_storage::PlanetOwnerStorage;
    use dep::planet_resources_storage::PlanetResourcesStorage;
    use dep::player_storage::PlayerStorage;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        config_storage_address: PublicMutable<AztecAddress, Context>,
        global_state_storage_address: PublicMutable<AztecAddress, Context>,
        player_storage_address: PublicMutable<AztecAddress, Context>,
        planet_meta_storage_address: PublicMutable<AztecAddress, Context>,
        planet_owner_storage_address: PublicMutable<AztecAddress, Context>,
        planet_caps_storage_address: PublicMutable<AztecAddress, Context>,
        planet_resources_storage_address: PublicMutable<AztecAddress, Context>,
        planet_mods_storage_address: PublicMutable<AztecAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(amdinAddress: AztecAddress) {
        self.storage.admin.write(amdinAddress);
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
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
    fn get_global_state_storage_address() -> AztecAddress {
        self.storage.global_state_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_meta_storage_address() -> AztecAddress {
        self.storage.planet_meta_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_owner_storage_address() -> AztecAddress {
        self.storage.planet_owner_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_caps_storage_address() -> AztecAddress {
        self.storage.planet_caps_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_resources_storage_address() -> AztecAddress {
        self.storage.planet_resources_storage_address.read()
    }

    #[internal("public")]
    fn get_planet_mods_storage_address() -> AztecAddress {
        self.storage.planet_mods_storage_address.read()
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
    fn set_global_state_storage_address(global_state_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.global_state_storage_address.write(global_state_storage_address);
    }

    #[external("public")]
    fn set_player_storage_address(player_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.player_storage_address.write(player_storage_address);
    }

    #[external("public")]
    fn set_planet_meta_storage_address(planet_meta_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_meta_storage_address.write(planet_meta_storage_address);
    }

    #[external("public")]
    fn set_planet_owner_storage_address(planet_owner_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_owner_storage_address.write(planet_owner_storage_address);
    }

    #[external("public")]
    fn set_planet_caps_storage_address(planet_caps_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_caps_storage_address.write(planet_caps_storage_address);
    }

    #[external("public")]
    fn set_planet_resources_storage_address(planet_resources_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_resources_storage_address.write(planet_resources_storage_address);
    }

    #[external("public")]
    fn set_planet_mods_storage_address(planet_mods_storage_address: AztecAddress) {
        self.internal.assert_admin();
        self.storage.planet_mods_storage_address.write(planet_mods_storage_address);
    }

    /// Pause the game. Verifies global_state matches on-chain state via GlobalStateStorage.verify(), then sets paused = true.
    #[external("public")]
    fn pause(global_state: GlobalState) {
        self.internal.assert_admin();

        let global_state_storage_address = self.internal.get_global_state_storage_address();
        let global_state_storage = GlobalStateStorage::at(global_state_storage_address);
        let global_state_valid: bool = self.view(global_state_storage.verify(global_state));

        assert(global_state_valid, "Global state is not valid");
        assert(!global_state.paused, "Game is already paused");

        let mut new_global_state = global_state;
        new_global_state.paused = true;
        self.call(global_state_storage.update(new_global_state));
    }

    #[external("public")]
    fn unpause(global_state: GlobalState) {
        self.internal.assert_admin();
        let global_state_storage_address = self.internal.get_global_state_storage_address();
        let global_state_storage = GlobalStateStorage::at(global_state_storage_address);

        let global_state_valid: bool = self.view(global_state_storage.verify(global_state));
        assert(global_state_valid, "Global state is not valid");
        assert(global_state.paused == true, "Game is already unpaused");

        let mut new_global_state = global_state;
        new_global_state.paused = false;
        self.call(global_state_storage.update(new_global_state));
    }

    #[external("public")]
    fn set_owner(planet_id: Field, planet_owner_state: PlanetOwner, new_owner: AztecAddress) {
        self.internal.assert_admin();
        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);

        let planet_owner_valid: bool =
            self.view(planet_owner_storage.verify(planet_id, planet_owner_state));
        assert(planet_owner_valid, "Planet owner is not valid");

        let mut new_planet_owner_state = planet_owner_state;
        new_planet_owner_state.owner = new_owner;
        self.call(planet_owner_storage.set(planet_id, new_planet_owner_state));
    }

    #[external("public")]
    fn deduct_score(player_address: AztecAddress, player_state: Player, amount: u128) {
        self.internal.assert_admin();

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);

        let player_valid: bool = self.view(player_storage.verify(player_address, player_state));
        assert(player_valid, "Player is not valid");

        assert(amount <= player_state.score, "tried to deduct much score");

        let mut new_player_state = player_state;
        new_player_state.score -= amount;
        self.call(player_storage.set(player_address, new_player_state));
    }

    #[external("public")]
    fn add_score(player_address: AztecAddress, player_state: Player, amount: u128) {
        self.internal.assert_admin();

        let player_storage_address = self.internal.get_player_storage_address();
        let player_storage = PlayerStorage::at(player_storage_address);

        let player_valid: bool = self.view(player_storage.verify(player_address, player_state));
        assert(player_valid, "Player is not valid");

        let mut new_player_state = player_state;
        new_player_state.score += amount;
        self.call(player_storage.set(player_address, new_player_state));
    }

    #[external("private")]
    fn safe_set_owner(
        x: Field, // private
        y: Field, // private
        r: u128,
        location_id: Field,
        perlin: u8,
        level: u8,
        new_owner: AztecAddress,
        provided_snark_constants: SnarkConstants,
        planet_owner_state: PlanetOwner,
        planet_caps_state: PlanetCaps,
        planet_resources_state: PlanetResources,
    ) {
        if !provided_snark_constants.disable_zk_checks {
            //todo: implement zk checks
        }

        self.enqueue_self.safe_set_owner_public(
            location_id,
            perlin,
            level,
            new_owner,
            provided_snark_constants,
            planet_owner_state,
            planet_caps_state,
            planet_resources_state,
        );
    }

    #[external("public")]
    #[only_self]
    fn safe_set_owner_public(
        location_id: Field,
        perlin: u8,
        level: u8,
        new_owner: AztecAddress,
        provided_snark_constants: SnarkConstants,
        planet_owner_state: PlanetOwner,
        planet_caps_state: PlanetCaps,
        planet_resources_state: PlanetResources,
    ) {
        self.internal.assert_admin();

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let snark_constants = self.view(config.get_snark_constants_public());

        assert(
            provided_snark_constants.disable_zk_checks == snark_constants.disable_zk_checks,
            "Disable zk checks is not valid",
        );

        let _ = revert_if_bad_snark_perlin_flags(provided_snark_constants, false, snark_constants);

        let planet_default_stats = self.view(config.get_planet_default_stats_public(level));

        let world_config = self.view(config.get_world_config_public());
        let game_config_core = self.view(config.get_game_config_core_public());
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds_public());
        let space_junk_config = self.view(config.get_space_junk_config_public());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier_public(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier_public(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier_public(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier_public(3));

        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);

        let planet_owner_valid: bool =
            self.view(planet_owner_storage.verify(location_id, planet_owner_state));
        assert(planet_owner_valid, "Planet owner is not valid");

        let mut planet = Planet::zero();

        if (!planet_owner_state.is_initialized) {
            planet = initialize_planet_with_defaults(
                location_id,
                perlin,
                planet_owner_state.is_home_planet,
                self.context.timestamp(),
                self.msg_sender().unwrap(),
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

            let (meta, owner, caps, resources, mods) = planet.to_meta_owner_caps_resources_mods();

            let planet_meta_storage_address = self.internal.get_planet_meta_storage_address();
            let planet_meta_storage = PlanetMetaStorage::at(planet_meta_storage_address);
            self.call(planet_meta_storage.set(location_id, meta));

            let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
            let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
            self.call(planet_owner_storage.set(location_id, owner));

            let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
            let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
            self.call(planet_caps_storage.set(location_id, caps));

            let planet_resources_storage_address =
                self.internal.get_planet_resources_storage_address();
            let planet_resources_storage =
                PlanetResourcesStorage::at(planet_resources_storage_address);
            self.call(planet_resources_storage.set(location_id, resources));

            let planet_mods_storage_address = self.internal.get_planet_mods_storage_address();
            let planet_mods_storage = PlanetModsStorage::at(planet_mods_storage_address);
            self.call(planet_mods_storage.set(location_id, mods));
        } else {
            let mut planet_owner_state = planet_owner_state;
            planet_owner_state.owner = new_owner;
            self.call(planet_owner_storage.set(location_id, planet_owner_state));

            let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
            let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
            let planet_caps_valid: bool =
                self.view(planet_caps_storage.verify(location_id, planet_caps_state));
            assert(planet_caps_valid, "Planet caps is not valid");

            let planet_resources_storage_address =
                self.internal.get_planet_resources_storage_address();
            let planet_resources_storage =
                PlanetResourcesStorage::at(planet_resources_storage_address);
            let planet_resources_valid: bool =
                self.view(planet_resources_storage.verify(location_id, planet_resources_state));
            assert(planet_resources_valid, "Planet resources is not valid");

            let mut new_resources = planet_resources_state;
            new_resources.population = planet_caps_state.population_cap;
            new_resources.silver = planet_caps_state.silver_cap;
            self.call(planet_resources_storage.set(location_id, new_resources));
        }
    }

    #[external("public")]
    fn admin_set_world_radius(new_radius: u128, global_state: GlobalState) {
        self.internal.assert_admin();
        let global_state_storage_address = self.internal.get_global_state_storage_address();
        let global_state_storage = GlobalStateStorage::at(global_state_storage_address);
        let global_state_valid: bool = self.view(global_state_storage.verify(global_state));
        assert(global_state_valid, "Global state is not valid");
        let mut new_global_state = global_state;
        new_global_state.world_radius = new_radius;
        self.call(global_state_storage.update(new_global_state));
    }

    // pub struct AdminCreatePlanetArgs {
    //     pub location: Field,
    //     pub perlin: u8,
    //     pub level: u8,
    //     pub planet_type: u8, // PlanetType enum (stored as u8, use helper functions to convert)
    //     pub require_valid_location_id: bool,
    // }

    #[external("public")]
    fn create_planet(args: AdminCreatePlanetArgs) {
        self.internal.assert_admin();

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let world_config = self.view(config.get_world_config_public());
        let game_config_core = self.view(config.get_game_config_core_public());
        let space_junk_config = self.view(config.get_space_junk_config_public());

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

        let planet_default_stats = self.view(config.get_planet_default_stats_public(args.level));

        let mut planet: Planet = _initialize_planet(
            init_args,
            self.context.timestamp(),
            self.msg_sender().unwrap(),
            planet_default_stats,
            world_config,
            space_junk_config,
        );

        let (meta, owner, caps, resources, mods) = planet.to_meta_owner_caps_resources_mods();
        let location_id = planet.location_id;

        let planet_meta_storage_address = self.internal.get_planet_meta_storage_address();
        let planet_meta_storage = PlanetMetaStorage::at(planet_meta_storage_address);
        self.call(planet_meta_storage.set(location_id, meta));

        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        self.call(planet_owner_storage.set(location_id, owner));

        let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
        let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
        self.call(planet_caps_storage.set(location_id, caps));

        let planet_resources_storage_address = self.internal.get_planet_resources_storage_address();
        let planet_resources_storage = PlanetResourcesStorage::at(planet_resources_storage_address);
        self.call(planet_resources_storage.set(location_id, resources));

        let planet_mods_storage_address = self.internal.get_planet_mods_storage_address();
        let planet_mods_storage = PlanetModsStorage::at(planet_mods_storage_address);
        self.call(planet_mods_storage.set(location_id, mods));
    }

    #[external("public")]
    fn admin_initialize_planet(location_id: Field, perlin: u8, level: u8) {
        self.internal.assert_admin();

        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        let planet_owner_is_initialized: bool =
            self.view(planet_owner_storage.is_initialized(location_id));
        assert(!planet_owner_is_initialized, "Planet is already initialized");

        let config_storage_address = self.internal.get_config_storage_address();
        let config = Config::at(config_storage_address);
        let world_config = self.view(config.get_world_config_public());
        let game_config_core = self.view(config.get_game_config_core_public());
        let space_junk_config = self.view(config.get_space_junk_config_public());
        let planet_default_stats = self.view(config.get_planet_default_stats_public(level));
        let planet_level_thresholds = self.view(config.get_planet_level_thresholds_public());
        let planet_type_weights_tier_0 = self.view(config.get_planet_type_weights_tier_public(0));
        let planet_type_weights_tier_1 = self.view(config.get_planet_type_weights_tier_public(1));
        let planet_type_weights_tier_2 = self.view(config.get_planet_type_weights_tier_public(2));
        let planet_type_weights_tier_3 = self.view(config.get_planet_type_weights_tier_public(3));

        let mut planet: Planet = initialize_planet_with_defaults(
            location_id,
            perlin,
            false,
            self.context.timestamp(),
            self.msg_sender().unwrap(),
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

        let (meta, owner, caps, resources, mods) = planet.to_meta_owner_caps_resources_mods();

        let planet_meta_storage_address = self.internal.get_planet_meta_storage_address();
        let planet_meta_storage = PlanetMetaStorage::at(planet_meta_storage_address);
        self.call(planet_meta_storage.set(location_id, meta));

        let planet_owner_storage_address = self.internal.get_planet_owner_storage_address();
        let planet_owner_storage = PlanetOwnerStorage::at(planet_owner_storage_address);
        self.call(planet_owner_storage.set(location_id, owner));

        let planet_caps_storage_address = self.internal.get_planet_caps_storage_address();
        let planet_caps_storage = PlanetCapsStorage::at(planet_caps_storage_address);
        self.call(planet_caps_storage.set(location_id, caps));

        let planet_resources_storage_address = self.internal.get_planet_resources_storage_address();
        let planet_resources_storage = PlanetResourcesStorage::at(planet_resources_storage_address);
        self.call(planet_resources_storage.set(location_id, resources));

        let planet_mods_storage_address = self.internal.get_planet_mods_storage_address();
        let planet_mods_storage = PlanetModsStorage::at(planet_mods_storage_address);
        self.call(planet_mods_storage.set(location_id, mods));
    }

}
