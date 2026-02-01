use dep::aztec::macros::aztec;

mod config;
mod types;

// Re-export config types for consumers (e.g. Main contract)
pub use config::{
    ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetLevelThresholds,
    PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig, WorldConfig,
};
pub use types::{PlanetDefaultStats, Upgrade};

#[aztec]
pub contract Config {
    use dep::aztec::{
        macros::{functions::{external, initializer, internal, view}, storage::storage},
        protocol_types::address::AztecAddress,
    };
    use dep::aztec::state_vars::{Map, PublicMutable};

    use crate::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetLevelThresholds,
        PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig, WorldConfig,
    };

    use crate::types::{PlanetDefaultStats, Upgrade};

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
    
        cumulative_rarities: Map<u128, PublicMutable<u128, Context>, Context>, // index -> value
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

    #[internal("public")]
    fn is_admin() -> bool {
        self.msg_sender().unwrap() == self.storage.admin.read()
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.internal.is_admin(), "Only admin");
    }

    #[external("public")]
    fn set_default_world_config() {
        self.internal.assert_admin();
        self.storage.world_config.write(WorldConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_world_config(config: WorldConfig) {
        self.internal.assert_admin();
        self.storage.world_config.write(config);
    }

    #[external("public")]
    fn set_default_snark_constants() {
        self.internal.assert_admin();
        self.storage.snark_constants.write(SnarkConstants::default_dark_forest());
    }

    #[external("public")]
    fn set_snark_constants(constants: SnarkConstants) {
        self.internal.assert_admin();
        self.storage.snark_constants.write(constants);
    }

    #[external("public")]
    fn set_default_game_config() {
        self.internal.assert_admin();
        // Only sets the small parts of game config that fit under the SSTORE limit.
        self.storage.game_config_core.write(GameConfig::default_dark_forest_core());
        self.storage.planet_level_thresholds.write(GameConfig::default_dark_forest_planet_level_thresholds());
    }

    #[external("public")]
    fn set_game_config_core(config: GameConfigCore) {
        self.internal.assert_admin();
        self.storage.game_config_core.write(config);
    }

    #[external("public")]
    fn set_planet_level_thresholds(config: PlanetLevelThresholds) {
        self.internal.assert_admin();
        self.storage.planet_level_thresholds.write(config);
    }

    #[external("public")]
    fn set_default_game_config_planet_type_weights_tier(tier: u8) {
        self.internal.assert_admin();
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
    fn set_planet_type_weights_tier(tier: u8, config: PlanetTypeWeightsTier) {
        self.internal.assert_admin();
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
        self.internal.assert_admin();
        self.storage.artifacts_config.write(ArtifactsConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_artifacts_config(config: ArtifactsConfig) {
        self.internal.assert_admin();
        self.storage.artifacts_config.write(config);
    }

    #[external("public")]
    fn set_default_spaceships_config() {
        self.internal.assert_admin();
        self.storage.spaceships_config.write(SpaceshipsConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_spaceships_config(config: SpaceshipsConfig) {
        self.internal.assert_admin();
        self.storage.spaceships_config.write(config);
    }

    #[external("public")]
    fn set_default_space_junk_config() {
        self.internal.assert_admin();
        self.storage.space_junk_config.write(SpaceJunkConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_space_junk_config(config: SpaceJunkConfig) {
        self.internal.assert_admin();
        self.storage.space_junk_config.write(config);
    }

    #[external("public")]
    fn set_default_capture_zones_config() {
        self.internal.assert_admin();
        self.storage.capture_zones_config.write(CaptureZonesConfig::default_dark_forest());
    }

    #[external("public")]
    fn set_capture_zones_config(config: CaptureZonesConfig) {
        self.internal.assert_admin();
        self.storage.capture_zones_config.write(config);
    }
    
    #[external("public")]
    fn initializeUpgrades() {
        self.internal.assert_admin();
        
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

    #[external("public")]
    fn initialize_cumulative_rarities() {
        self.internal.assert_admin();

        let thresholds = self.storage.planet_level_thresholds.read().thresholds;
        let planet_rarity: u128 = self.storage.game_config_core.read().planet_rarity;
        let base: u128 = 1 << 24; // 2^24

        // Compute cumulativeRarities[i] = (2^24 / thresholds[i]) * planet_rarity
        for i in 0..10 {
            let threshold: u128 = thresholds[i];
            assert(threshold != 0, "threshold must be nonzero");
            let cumulative_rarity: u128 = (base / threshold) * planet_rarity;
            self.storage.cumulative_rarities.at(i as u128).write(cumulative_rarity);
        }
    }

    // ---- defaults & upgrades setters (public) ----
    #[external("public")]
    fn set_planet_default_stats(level: u8, stats: PlanetDefaultStats) {
        self.internal.assert_admin();
        self.storage.planet_default_stats.at(level).write(stats);
    }

    /// Key is `branch * 10 + level`, matching storage comment.
    #[external("public")]
    fn set_upgrade(key: u128, upgrade: Upgrade) {
        self.internal.assert_admin();
        self.storage.upgrades.at(key).write(upgrade);
    }

    #[external("public")]
    fn set_upgrade_by_branch_level(branch: u128, level: u128, upgrade: Upgrade) {
        self.internal.assert_admin();
        let key = branch * 10 + level;
        self.storage.upgrades.at(key).write(upgrade);
    }

    // ========== Config Getters (public, for cross-contract calls) ==========
    // These functions allow Main and other contracts to read config during transaction execution via .view().
    // Unlike #[external("utility")] getters, these are onchain-callable public functions.

    /// Returns the admin/owner address of the Config contract.
    #[external("public")]
    #[view]
    fn get_admin_public() -> AztecAddress {
        self.storage.admin.read()
    }

    /// Returns WorldConfig (world radius, time factor, reveal cooldown, etc.).
    #[external("public")]
    #[view]
    fn get_world_config_public() -> WorldConfig {
        self.storage.world_config.read()
    }

    /// Returns SNARK constants (Perlin keys, mirror flag, etc.).
    #[external("public")]
    #[view]
    fn get_snark_constants_public() -> SnarkConstants {
        self.storage.snark_constants.read()
    }

    /// Returns GameConfigCore (Perlin thresholds, planet_rarity, etc.).
    #[external("public")]
    #[view]
    fn get_game_config_core_public() -> GameConfigCore {
        self.storage.game_config_core.read()
    }

    /// Returns the planet level thresholds array [10].
    #[external("public")]
    #[view]
    fn get_planet_level_thresholds_public() -> PlanetLevelThresholds {
        self.storage.planet_level_thresholds.read()
    }

    /// Returns planet type weights for the given tier (0..=3).
    #[external("public")]
    #[view]
    fn get_planet_type_weights_tier_public(tier: u8) -> PlanetTypeWeightsTier {
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

    /// Returns ArtifactsConfig (artifact points, photoid delay, etc.).
    #[external("public")]
    #[view]
    fn get_artifacts_config_public() -> ArtifactsConfig {
        self.storage.artifacts_config.read()
    }

    /// Returns SpaceshipsConfig (gear, mothership toggles, etc.).
    #[external("public")]
    #[view]
    fn get_spaceships_config_public() -> SpaceshipsConfig {
        self.storage.spaceships_config.read()
    }

    /// Returns SpaceJunkConfig (space_junk_limit, planet_level_junk, etc.).
    #[external("public")]
    #[view]
    fn get_space_junk_config_public() -> SpaceJunkConfig {
        self.storage.space_junk_config.read()
    }

    /// Returns CaptureZonesConfig.
    #[external("public")]
    #[view]
    fn get_capture_zones_config_public() -> CaptureZonesConfig {
        self.storage.capture_zones_config.read()
    }

    /// Returns default planet stats for the given level.
    #[external("public")]
    #[view]
    fn get_planet_default_stats_public(level: u8) -> PlanetDefaultStats {
        self.storage.planet_default_stats.at(level).read()
    }

    /// Returns Upgrade for the given key (branch * 10 + level).
    #[external("public")]
    #[view]
    fn get_upgrade_public(key: u128) -> Upgrade {
        self.storage.upgrades.at(key).read()
    }

    /// Returns Upgrade by branch and level.
    #[external("public")]
    #[view]
    fn get_upgrade_by_branch_level_public(branch: u128, level: u128) -> Upgrade {
        let key = branch * 10 + level;
        self.storage.upgrades.at(key).read()
    }

    #[external("public")]
    #[view]
    fn get_cumulative_rarity_public(index: u128) -> u128 {
        self.storage.cumulative_rarities.at(index).read()
    }

    // ========== Storage Access Functions ==========
    // Essential getter functions for accessing contract storage

    #[external("utility")]
    unconstrained fn get_admin_utility() -> AztecAddress {
        self.storage.admin.read()
    }

    /// Noir port of Solidity `DFGetterFacet.adminAddress`.
    /// Returns the admin/owner address of the contract.
    #[external("utility")]
    unconstrained fn admin_address() -> AztecAddress {
        self.storage.admin.read()
    }

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

    /// Noir port of Solidity `DFGetterFacet.getTypeWeights`.
    /// Returns the full [4][10][5] planet type weights table.
    #[external("utility")]
    unconstrained fn get_type_weights() -> [[[u128; 5]; 10]; 4] {
        let tier0: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_0.read();
        let tier1: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_1.read();
        let tier2: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_2.read();
        let tier3: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_3.read();

        [tier0.weights, tier1.weights, tier2.weights, tier3.weights]
    }

    /// Noir port of Solidity `DFGetterFacet.getUpgrades`.
    /// Returns the full [3][4] upgrades table: [branch][level].
    #[external("utility")]
    unconstrained fn get_upgrades() -> [[Upgrade; 4]; 3] {
        // Branch 0 (Defense): keys 0..3
        let branch0: [Upgrade; 4] = [
            self.storage.upgrades.at(0).read(),
            self.storage.upgrades.at(1).read(),
            self.storage.upgrades.at(2).read(),
            self.storage.upgrades.at(3).read(),
        ];

        // Branch 1 (Range): keys 10..13
        let branch1: [Upgrade; 4] = [
            self.storage.upgrades.at(10).read(),
            self.storage.upgrades.at(11).read(),
            self.storage.upgrades.at(12).read(),
            self.storage.upgrades.at(13).read(),
        ];

        // Branch 2 (Speed): keys 20..23
        let branch2: [Upgrade; 4] = [
            self.storage.upgrades.at(20).read(),
            self.storage.upgrades.at(21).read(),
            self.storage.upgrades.at(22).read(),
            self.storage.upgrades.at(23).read(),
        ];

        [branch0, branch1, branch2]
    }   

    /// Noir port of Solidity `DFGetterFacet.getDefaultStats`.
    /// Returns the full array of default planet stats for levels 0..9.
    #[external("utility")]
    unconstrained fn get_default_stats() -> [PlanetDefaultStats; 10] {
        [
            self.storage.planet_default_stats.at(0).read(),
            self.storage.planet_default_stats.at(1).read(),
            self.storage.planet_default_stats.at(2).read(),
            self.storage.planet_default_stats.at(3).read(),
            self.storage.planet_default_stats.at(4).read(),
            self.storage.planet_default_stats.at(5).read(),
            self.storage.planet_default_stats.at(6).read(),
            self.storage.planet_default_stats.at(7).read(),
            self.storage.planet_default_stats.at(8).read(),
            self.storage.planet_default_stats.at(9).read(),
        ]
    }

    #[external("utility")]
    unconstrained fn get_cumulative_rarity_utility(index: u128) -> u128 {
        self.storage.cumulative_rarities.at(index).read()
    }

    /// Noir port of Solidity `DFGetterFacet.getArtifactPointValues`.
    /// Returns the artifact point values array [6].
    #[external("utility")]
    unconstrained fn get_artifact_point_values() -> [u128; 6] {
        let artifacts_config = self.storage.artifacts_config.read();
        artifacts_config.artifact_point_values
    }

    /// Noir port of Solidity `DFGetterFacet.getRevealCooldown`.
    /// Returns the location reveal cooldown in seconds.
    #[external("utility")]
    unconstrained fn get_reveal_cooldown() -> u64 {
        let world_config = self.storage.world_config.read();
        world_config.location_reveal_cooldown_s
    }
}