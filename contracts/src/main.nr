use dep::aztec::macros::aztec;

mod config;
mod types;

#[aztec]
pub contract Main {
    use dep::aztec::{
        macros::{functions::{external, initializer}, storage::storage},
        protocol_types::address::AztecAddress,
    };
    use dep::aztec::state_vars::{Map, PublicMutable};

    use crate::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetLevelThresholds,
        PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig, WorldConfig,
    };

    use crate::types::{
        PlanetDefaultStats, Upgrade,
    };

    // ========== Storage Structure ==========
    // Full storage structure
    #[storage]
    struct Storage<Context> {

        // ========== Game Configuration ==========
        admin: PublicMutable<AztecAddress, Context>,
        world_config: PublicMutable<WorldConfig, Context>,
        snark_constants: PublicMutable<SnarkConstants, Context>,
        // Game config is split to stay under the public SSTORE write limit (63 writes per call).
        game_config_core: PublicMutable<GameConfigCore, Context>,
        planet_level_thresholds: PublicMutable<PlanetLevelThresholds, Context>,
        planet_type_weights_tier_0: PublicMutable<PlanetTypeWeightsTier, Context>,
        planet_type_weights_tier_1: PublicMutable<PlanetTypeWeightsTier, Context>,
        planet_type_weights_tier_2: PublicMutable<PlanetTypeWeightsTier, Context>,
        planet_type_weights_tier_3: PublicMutable<PlanetTypeWeightsTier, Context>,
        artifacts_config: PublicMutable<ArtifactsConfig, Context>,
        spaceships_config: PublicMutable<SpaceshipsConfig, Context>,
        space_junk_config: PublicMutable<SpaceJunkConfig, Context>,
        capture_zones_config: PublicMutable<CaptureZonesConfig, Context>,

        // ========== Default Stats & Upgrades ==========
        planet_default_stats: Map<u8, PublicMutable<PlanetDefaultStats, Context>, Context>, // level 0-9
        upgrades: Map<u128, PublicMutable<Upgrade, Context>, Context>, // key = branch * 10 + level

    }

    // ========== Constructor ==========
    // Initializes all storage with configuration constants.
    // Note: We pass the admin address explicitly from the deploy script,
    // instead of relying on msg_sender during contract deployment.
    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    #[external("public")]
    fn set_default_world_config() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.world_config.write(WorldConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_world_config(config: WorldConfig) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.world_config.write(config);
    }

    #[external("public")]
    fn set_default_snark_constants() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.snark_constants.write(SnarkConstants::default_dark_forest());
    }

    #[external("public")]
    fn set_snark_constants(constants: SnarkConstants) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.snark_constants.write(constants);
    }

    #[external("public")]
    fn set_default_game_config() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        // Only sets the small parts of game config that fit under the SSTORE limit.
        self.storage.game_config_core.write(GameConfig::default_dark_forest_core());
        self.storage.planet_level_thresholds.write(GameConfig::default_dark_forest_planet_level_thresholds());
    }

    #[external("public")]
    fn set_default_game_config_planet_type_weights_tier(tier: u8) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        let weights = GameConfig::default_dark_forest_planet_type_weights_tier(tier);
        if tier == 0 {
            self.storage.planet_type_weights_tier_0.write(weights);
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1.write(weights);
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2.write(weights);
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3.write(weights);
        } else {
            assert(false, "tier must be 0..=3");
        }
    }

    #[external("public")]
    fn set_game_config_core(config: GameConfigCore) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.game_config_core.write(config);
    }

    #[external("public")]
    fn set_planet_level_thresholds(config: PlanetLevelThresholds) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.planet_level_thresholds.write(config);
    }

    #[external("public")]
    fn set_planet_type_weights_tier(tier: u8, config: PlanetTypeWeightsTier) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        if tier == 0 {
            self.storage.planet_type_weights_tier_0.write(config);
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1.write(config);
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2.write(config);
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3.write(config);
        } else {
            assert(false, "tier must be 0..=3");
        }
    }

    #[external("public")]
    fn set_default_artifacts_config() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.artifacts_config.write(ArtifactsConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_artifacts_config(config: ArtifactsConfig) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.artifacts_config.write(config);
    }

    #[external("public")]
    fn set_default_spaceships_config() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.spaceships_config.write(SpaceshipsConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_spaceships_config(config: SpaceshipsConfig) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.spaceships_config.write(config);
    }

    #[external("public")]
    fn set_default_space_junk_config() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.space_junk_config.write(SpaceJunkConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_space_junk_config(config: SpaceJunkConfig) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.space_junk_config.write(config);
    }

    #[external("public")]
    fn set_default_capture_zones_config() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.capture_zones_config.write(CaptureZonesConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_capture_zones_config(config: CaptureZonesConfig) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.capture_zones_config.write(config);
    }
    
    #[external("public")]
    fn initializeUpgrades() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
            // Initialize upgrade structures (3 branches x 4 levels)
        // Defense branch (branch = 0)
        self.storage.upgrades.at(0).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 100,
                def_multiplier: 120,
            },
        );
        self.storage.upgrades.at(1).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 100,
                def_multiplier: 120,
            },
        );
        self.storage.upgrades.at(2).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 100,
                def_multiplier: 120,
            },
        );
        self.storage.upgrades.at(3).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 100,
                def_multiplier: 120,
            },
        );
        // Range branch (branch = 1)
        self.storage.upgrades.at(10).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 125,
                speed_multiplier: 100,
                def_multiplier: 100,
            },
        );
        self.storage.upgrades.at(11).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 125,
                speed_multiplier: 100,
                def_multiplier: 100,
            },
        );
        self.storage.upgrades.at(12).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 125,
                speed_multiplier: 100,
                def_multiplier: 100,
            },
        );
        self.storage.upgrades.at(13).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 125,
                speed_multiplier: 100,
                def_multiplier: 100,
            },
        );
        // Speed branch (branch = 2)
        self.storage.upgrades.at(20).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 175,
                def_multiplier: 100,
            },
        );
        self.storage.upgrades.at(21).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 175,
                def_multiplier: 100,
            },
        );
        self.storage.upgrades.at(22).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 175,
                def_multiplier: 100,
            },
        );
        self.storage.upgrades.at(23).write(
            Upgrade {
                pop_cap_multiplier: 120,
                pop_gro_multiplier: 120,
                range_multiplier: 100,
                speed_multiplier: 175,
                def_multiplier: 100,
            },
        );
    }

    // ---- defaults & upgrades setters (public) ----
    #[external("public")]
    fn set_planet_default_stats(level: u8, stats: PlanetDefaultStats) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.planet_default_stats.at(level).write(stats);
    }

    /// Key is `branch * 10 + level`, matching storage comment.
    #[external("public")]
    fn set_upgrade(key: u128, upgrade: Upgrade) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.storage.upgrades.at(key).write(upgrade);
    }

    #[external("public")]
    fn set_upgrade_by_branch_level(branch: u128, level: u128, upgrade: Upgrade) {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        let key = branch * 10 + level;
        self.storage.upgrades.at(key).write(upgrade);
    }


    // ========== Storage Access Functions ==========
    // Essential getter functions for accessing contract storage

    #[external("utility")]
    unconstrained fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    // ---- config getters (utility) ----
    #[external("utility")]
    unconstrained fn get_world_config() -> WorldConfig {
        self.storage.world_config.read()
    }

    #[external("utility")]
    unconstrained fn get_snark_constants() -> SnarkConstants {
        self.storage.snark_constants.read()
    }

    #[external("utility")]
    unconstrained fn get_game_config_core() -> GameConfigCore {
        self.storage.game_config_core.read()
    }

    #[external("utility")]
    unconstrained fn get_planet_level_thresholds() -> PlanetLevelThresholds {
        self.storage.planet_level_thresholds.read()
    }

    #[external("utility")]
    unconstrained fn get_planet_type_weights_tier(tier: u8) -> PlanetTypeWeightsTier {
        if tier == 0 {
            self.storage.planet_type_weights_tier_0.read()
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1.read()
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2.read()
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3.read()
        } else {
            assert(false, "tier must be 0..=3");
            self.storage.planet_type_weights_tier_0.read()
        }
    }

    #[external("utility")]
    unconstrained fn get_artifacts_config() -> ArtifactsConfig {
        self.storage.artifacts_config.read()
    }

    #[external("utility")]
    unconstrained fn get_spaceships_config() -> SpaceshipsConfig {
        self.storage.spaceships_config.read()
    }

    #[external("utility")]
    unconstrained fn get_space_junk_config() -> SpaceJunkConfig {
        self.storage.space_junk_config.read()
    }

    #[external("utility")]
    unconstrained fn get_capture_zones_config() -> CaptureZonesConfig {
        self.storage.capture_zones_config.read()
    }

    // ---- defaults & upgrades getters (utility) ----
    #[external("utility")]
    unconstrained fn get_planet_default_stats(level: u8) -> PlanetDefaultStats {
        self.storage.planet_default_stats.at(level).read()
    }

    /// Key is `branch * 10 + level`, matching storage comment.
    #[external("utility")]
    unconstrained fn get_upgrade(key: u128) -> Upgrade {
        self.storage.upgrades.at(key).read()
    }

    #[external("utility")]
    unconstrained fn get_upgrade_by_branch_level(branch: u128, level: u128) -> Upgrade {
        let key = branch * 10 + level;
        self.storage.upgrades.at(key).read()
    }
      
}