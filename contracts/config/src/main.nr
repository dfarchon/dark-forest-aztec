use ::aztec::macros::aztec;

#[aztec]
pub contract Config {
    use ::aztec::{
        macros::{functions::{external, initializer, internal, view}, storage::storage},
        protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Serialize},
    };
    use ::aztec::state_vars::{Map, PublicMutable};

    use ::types::args::{
        AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs,
    };

    use ::types::config::{
        artifacts::ArtifactsConfig,
        capture_zones::CaptureZonesConfig,
        default_stats::PlanetDefaultStats,
        game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
        snark::SnarkConfig,
        space_junk::SpaceJunkConfig,
        spaceships::SpaceshipsConfig,
        upgrade::{Upgrade, UpgradeConfig},
        world::WorldConfig,
    };

    // ========== Storage Structure ==========
    // Full storage structure
    #[storage]
    struct Storage<Context> {

        // ========== Game Configuration ==========
        admin: PublicMutable<AztecAddress, Context>,
        world_config: PublicMutable<WorldConfig, Context>,
        snark_config: PublicMutable<SnarkConfig, Context>,
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
        upgrade_config: PublicMutable<UpgradeConfig, Context>,

        // ========== Config Hashes (for off-chain verification) ==========
        world_config_hash: PublicMutable<Field, Context>,
        snark_config_hash: PublicMutable<Field, Context>,
        game_config_core_hash: PublicMutable<Field, Context>,
        planet_level_thresholds_hash: PublicMutable<Field, Context>,
        planet_type_weights_tier_0_hash: PublicMutable<Field, Context>,
        planet_type_weights_tier_1_hash: PublicMutable<Field, Context>,
        planet_type_weights_tier_2_hash: PublicMutable<Field, Context>,
        planet_type_weights_tier_3_hash: PublicMutable<Field, Context>,
        artifacts_config_hash: PublicMutable<Field, Context>,
        spaceships_config_hash: PublicMutable<Field, Context>,
        space_junk_config_hash: PublicMutable<Field, Context>,
        capture_zones_config_hash: PublicMutable<Field, Context>,
        upgrade_config_hash: PublicMutable<Field, Context>,
        planet_default_stats_hash: Map<u8, PublicMutable<Field, Context>, Context>, // level 0-9 hashes

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
        self.msg_sender() == self.storage.admin.read()
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.internal.is_admin(), "Only admin");
    }

    #[external("public")]
    fn set_default_world_config() {
        self.internal.assert_admin();
        let config = WorldConfig::zero();
        self.storage.world_config.write(config);
        self.storage.world_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_world_config(config: WorldConfig) {
        self.internal.assert_admin();
        self.storage.world_config.write(config);
        self.storage.world_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_snark_config() {
        self.internal.assert_admin();
        let config = SnarkConfig::zero();
        self.storage.snark_config.write(config);
        self.storage.snark_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_snark_config(config: SnarkConfig) {
        self.internal.assert_admin();
        self.storage.snark_config.write(config);
        self.storage.snark_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_game_config() {
        self.internal.assert_admin();
        // Only sets the small parts of game config that fit under the SSTORE limit.
        let core = GameConfigCore::zero();
        let thresholds = PlanetLevelThresholds::zero();
        self.storage.game_config_core.write(core);
        self.storage.planet_level_thresholds.write(thresholds);
        self.storage.game_config_core_hash.write(poseidon2_hash(core.serialize()));
        self.storage.planet_level_thresholds_hash.write(poseidon2_hash(thresholds.serialize()));
    }

    #[external("public")]
    fn set_game_config_core(config: GameConfigCore) {
        self.internal.assert_admin();
        self.storage.game_config_core.write(config);
        self.storage.game_config_core_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_planet_level_thresholds(config: PlanetLevelThresholds) {
        self.internal.assert_admin();
        self.storage.planet_level_thresholds.write(config);
        self.storage.planet_level_thresholds_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_game_config_planet_type_weights_tier(tier: u8) {
        self.internal.assert_admin();
        let weights = PlanetTypeWeightsTier::zero(tier);
        let hash = poseidon2_hash(weights.serialize());
        if tier == 0 {
            self.storage.planet_type_weights_tier_0.write(weights);
            self.storage.planet_type_weights_tier_0_hash.write(hash);
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1.write(weights);
            self.storage.planet_type_weights_tier_1_hash.write(hash);
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2.write(weights);
            self.storage.planet_type_weights_tier_2_hash.write(hash);
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3.write(weights);
            self.storage.planet_type_weights_tier_3_hash.write(hash);
        } else {
            assert(false, "tier must be 0..=3");
        }
    }

    #[external("public")]
    fn set_planet_type_weights_tier(tier: u8, config: PlanetTypeWeightsTier) {
        self.internal.assert_admin();
        let hash = poseidon2_hash(config.serialize());
        if tier == 0 {
            self.storage.planet_type_weights_tier_0.write(config);
            self.storage.planet_type_weights_tier_0_hash.write(hash);
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1.write(config);
            self.storage.planet_type_weights_tier_1_hash.write(hash);
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2.write(config);
            self.storage.planet_type_weights_tier_2_hash.write(hash);
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3.write(config);
            self.storage.planet_type_weights_tier_3_hash.write(hash);
        } else {
            assert(false, "tier must be 0..=3");
        }
    }

    #[external("public")]
    fn set_default_artifacts_config() {
        self.internal.assert_admin();
        let config = ArtifactsConfig::zero();
        self.storage.artifacts_config.write(config);
        self.storage.artifacts_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_artifacts_config(config: ArtifactsConfig) {
        self.internal.assert_admin();
        self.storage.artifacts_config.write(config);
        self.storage.artifacts_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_spaceships_config() {
        self.internal.assert_admin();
        let config = SpaceshipsConfig::zero();
        self.storage.spaceships_config.write(config);
        self.storage.spaceships_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_spaceships_config(config: SpaceshipsConfig) {
        self.internal.assert_admin();
        self.storage.spaceships_config.write(config);
        self.storage.spaceships_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_space_junk_config() {
        self.internal.assert_admin();
        let config = SpaceJunkConfig::zero();
        self.storage.space_junk_config.write(config);
        self.storage.space_junk_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_space_junk_config(config: SpaceJunkConfig) {
        self.internal.assert_admin();
        self.storage.space_junk_config.write(config);
        self.storage.space_junk_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_capture_zones_config() {
        self.internal.assert_admin();
        let config = CaptureZonesConfig::zero();
        self.storage.capture_zones_config.write(config);
        self.storage.capture_zones_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_capture_zones_config(config: CaptureZonesConfig) {
        self.internal.assert_admin();
        self.storage.capture_zones_config.write(config);
        self.storage.capture_zones_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_default_upgrade_config() {
        self.internal.assert_admin();
        let config = UpgradeConfig::zero();
        self.storage.upgrade_config.write(config);
        self.storage.upgrade_config_hash.write(poseidon2_hash(config.serialize()));
    }

    #[external("public")]
    fn set_upgrade_config(config: UpgradeConfig) {
        self.internal.assert_admin();
        self.storage.upgrade_config.write(config);
        self.storage.upgrade_config_hash.write(poseidon2_hash(config.serialize()));
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

    #[external("public")]
    fn set_planet_default_stats(level: u8, stats: PlanetDefaultStats) {
        self.internal.assert_admin();
        self.storage.planet_default_stats.at(level).write(stats);
        self.storage.planet_default_stats_hash.at(level).write(poseidon2_hash(stats.serialize()));
    }

    /// Batch set planet default stats for up to 5 levels in a single transaction.
    /// 5 x (8 stats fields + 1 hash) = 45 storage writes, well under the 63-write limit.
    #[external("public")]
    fn set_planet_default_stats_batch(levels: [u8; 5], stats: [PlanetDefaultStats; 5], count: u8) {
        self.internal.assert_admin();
        for i in 0..5 {
            if (i as u8) < count {
                self.storage.planet_default_stats.at(levels[i]).write(stats[i]);
                self.storage.planet_default_stats_hash.at(levels[i]).write(poseidon2_hash(stats[i]
                    .serialize()));
            }
        }
    }

    /// Batch initialize default configs (part 1): world, snark, game_core, thresholds, artifacts, spaceships.
    /// Total storage writes: ~55 slots (under 63-write limit).
    #[external("public")]
    fn set_default_configs_batch_1() {
        self.internal.assert_admin();

        let world = WorldConfig::zero();
        self.storage.world_config.write(world);
        self.storage.world_config_hash.write(poseidon2_hash(world.serialize()));

        let snark = SnarkConfig::zero();
        self.storage.snark_config.write(snark);
        self.storage.snark_config_hash.write(poseidon2_hash(snark.serialize()));

        let core = GameConfigCore::zero();
        let thresholds = PlanetLevelThresholds::zero();
        self.storage.game_config_core.write(core);
        self.storage.planet_level_thresholds.write(thresholds);
        self.storage.game_config_core_hash.write(poseidon2_hash(core.serialize()));
        self.storage.planet_level_thresholds_hash.write(poseidon2_hash(thresholds.serialize()));

        let artifacts = ArtifactsConfig::zero();
        self.storage.artifacts_config.write(artifacts);
        self.storage.artifacts_config_hash.write(poseidon2_hash(artifacts.serialize()));

        let spaceships = SpaceshipsConfig::zero();
        self.storage.spaceships_config.write(spaceships);
        self.storage.spaceships_config_hash.write(poseidon2_hash(spaceships.serialize()));
    }

    /// Batch initialize default configs (part 2): space_junk, capture_zones.
    /// Total storage writes: ~31 slots (under 63-write limit).
    #[external("public")]
    fn set_default_configs_batch_2() {
        self.internal.assert_admin();

        let space_junk = SpaceJunkConfig::zero();
        self.storage.space_junk_config.write(space_junk);
        self.storage.space_junk_config_hash.write(poseidon2_hash(space_junk.serialize()));

        let capture_zones = CaptureZonesConfig::zero();
        self.storage.capture_zones_config.write(capture_zones);
        self.storage.capture_zones_config_hash.write(poseidon2_hash(capture_zones.serialize()));
    }

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
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    /// Returns WorldConfig (world radius, time factor, reveal cooldown, etc.).
    #[external("public")]
    #[view]
    fn get_world_config() -> WorldConfig {
        self.storage.world_config.read()
    }

    /// Returns SNARK constants (Perlin keys, mirror flag, etc.).
    #[external("public")]
    #[view]
    fn get_snark_config() -> SnarkConfig {
        self.storage.snark_config.read()
    }

    /// Returns GameConfigCore (Perlin thresholds, planet_rarity, etc.).
    #[external("public")]
    #[view]
    fn get_game_config_core() -> GameConfigCore {
        self.storage.game_config_core.read()
    }

    /// Returns the planet level thresholds array [10].
    #[external("public")]
    #[view]
    fn get_planet_level_thresholds() -> PlanetLevelThresholds {
        self.storage.planet_level_thresholds.read()
    }

    /// Returns planet type weights for the given tier (0..=3).
    #[external("public")]
    #[view]
    fn get_planet_type_weights_tier(tier: u8) -> PlanetTypeWeightsTier {
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
    fn get_artifacts_config() -> ArtifactsConfig {
        self.storage.artifacts_config.read()
    }

    /// Returns SpaceshipsConfig (gear, mothership toggles, etc.).
    #[external("public")]
    #[view]
    fn get_spaceships_config() -> SpaceshipsConfig {
        self.storage.spaceships_config.read()
    }

    /// Returns SpaceJunkConfig (space_junk_limit, planet_level_junk, etc.).
    #[external("public")]
    #[view]
    fn get_space_junk_config() -> SpaceJunkConfig {
        self.storage.space_junk_config.read()
    }

    /// Returns CaptureZonesConfig.
    #[external("public")]
    #[view]
    fn get_capture_zones_config() -> CaptureZonesConfig {
        self.storage.capture_zones_config.read()
    }

    /// Returns UpgradeConfig (upgrade costs and level caps).
    #[external("public")]
    #[view]
    fn get_upgrade_config() -> UpgradeConfig {
        self.storage.upgrade_config.read()
    }

    /// Returns default planet stats for the given level.
    #[external("public")]
    #[view]
    fn get_planet_default_stats(level: u8) -> PlanetDefaultStats {
        self.storage.planet_default_stats.at(level).read()
    }

    /// Returns Upgrade for the given key (branch * 10 + level).
    #[external("public")]
    #[view]
    fn get_upgrade(key: u128) -> Upgrade {
        self.storage.upgrades.at(key).read()
    }

    /// Returns Upgrade by branch and level.
    #[external("public")]
    #[view]
    fn get_upgrade_by_branch_level(branch: u128, level: u128) -> Upgrade {
        let key = branch * 10 + level;
        self.storage.upgrades.at(key).read()
    }

    #[external("public")]
    #[view]
    fn get_cumulative_rarity(index: u128) -> u128 {
        self.storage.cumulative_rarities.at(index).read()
    }

    // ========== Config Hash Getters (on-chain verification) ==========

    /// Returns the stored hash of WorldConfig.
    #[external("public")]
    #[view]
    fn get_world_config_hash() -> Field {
        self.storage.world_config_hash.read()
    }

    /// Returns the stored hash of SnarkConfig.
    #[external("public")]
    #[view]
    fn get_snark_config_hash() -> Field {
        self.storage.snark_config_hash.read()
    }

    /// Returns the stored hash of GameConfigCore.
    #[external("public")]
    #[view]
    fn get_game_config_core_hash() -> Field {
        self.storage.game_config_core_hash.read()
    }

    /// Returns the stored hash of PlanetLevelThresholds.
    #[external("public")]
    #[view]
    fn get_planet_level_thresholds_hash() -> Field {
        self.storage.planet_level_thresholds_hash.read()
    }

    /// Returns the stored hash of PlanetTypeWeightsTier for the given tier.
    #[external("public")]
    #[view]
    fn get_planet_type_weights_tier_hash(tier: u8) -> Field {
        if tier == 0 {
            self.storage.planet_type_weights_tier_0_hash.read()
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1_hash.read()
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2_hash.read()
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3_hash.read()
        } else {
            assert(false, "tier must be 0..=3");
            0
        }
    }

    /// Returns the stored hash of ArtifactsConfig.
    #[external("public")]
    #[view]
    fn get_artifacts_config_hash() -> Field {
        self.storage.artifacts_config_hash.read()
    }

    /// Returns the stored hash of SpaceshipsConfig.
    #[external("public")]
    #[view]
    fn get_spaceships_config_hash() -> Field {
        self.storage.spaceships_config_hash.read()
    }

    /// Returns the stored hash of SpaceJunkConfig.
    #[external("public")]
    #[view]
    fn get_space_junk_config_hash() -> Field {
        self.storage.space_junk_config_hash.read()
    }

    /// Returns the stored hash of CaptureZonesConfig.
    #[external("public")]
    #[view]
    fn get_capture_zones_config_hash() -> Field {
        self.storage.capture_zones_config_hash.read()
    }

    /// Returns the stored hash of UpgradeConfig.
    #[external("public")]
    #[view]
    fn get_upgrade_config_hash() -> Field {
        self.storage.upgrade_config_hash.read()
    }

    /// Returns the stored hash of PlanetDefaultStats for the given level.
    #[external("public")]
    #[view]
    fn get_planet_default_stats_hash(level: u8) -> Field {
        self.storage.planet_default_stats_hash.at(level).read()
    }

    /// Returns all planet default stats hashes for levels 0-9.
    #[external("public")]
    #[view]
    fn get_all_planet_default_stats_hashes() -> [Field; 10] {
        [
            self.storage.planet_default_stats_hash.at(0).read(),
            self.storage.planet_default_stats_hash.at(1).read(),
            self.storage.planet_default_stats_hash.at(2).read(),
            self.storage.planet_default_stats_hash.at(3).read(),
            self.storage.planet_default_stats_hash.at(4).read(),
            self.storage.planet_default_stats_hash.at(5).read(),
            self.storage.planet_default_stats_hash.at(6).read(),
            self.storage.planet_default_stats_hash.at(7).read(),
            self.storage.planet_default_stats_hash.at(8).read(),
            self.storage.planet_default_stats_hash.at(9).read(),
        ]
    }

    // ========== Config Verification Functions (on-chain) ==========

    /// Verifies that the given WorldConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_world_config(config: WorldConfig) -> bool {
        self.storage.world_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given SnarkConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_snark_config(config: SnarkConfig) -> bool {
        self.storage.snark_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given GameConfigCore matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_game_config_core(config: GameConfigCore) -> bool {
        self.storage.game_config_core_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given PlanetLevelThresholds matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_planet_level_thresholds(config: PlanetLevelThresholds) -> bool {
        self.storage.planet_level_thresholds_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given PlanetTypeWeightsTier matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_planet_type_weights_tier(tier: u8, config: PlanetTypeWeightsTier) -> bool {
        let stored_hash = if tier == 0 {
            self.storage.planet_type_weights_tier_0_hash.read()
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1_hash.read()
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2_hash.read()
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3_hash.read()
        } else {
            assert(false, "tier must be 0..=3");
            0
        };
        stored_hash == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given ArtifactsConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_artifacts_config(config: ArtifactsConfig) -> bool {
        self.storage.artifacts_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given SpaceshipsConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_spaceships_config(config: SpaceshipsConfig) -> bool {
        self.storage.spaceships_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given SpaceJunkConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_space_junk_config(config: SpaceJunkConfig) -> bool {
        self.storage.space_junk_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given CaptureZonesConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_capture_zones_config(config: CaptureZonesConfig) -> bool {
        self.storage.capture_zones_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given UpgradeConfig matches the stored hash.
    #[external("public")]
    #[view]
    fn verify_upgrade_config(config: UpgradeConfig) -> bool {
        self.storage.upgrade_config_hash.read() == poseidon2_hash(config.serialize())
    }

    /// Verifies that the given PlanetDefaultStats matches the stored hash for the given level.
    #[external("public")]
    #[view]
    fn verify_planet_default_stats(level: u8, stats: PlanetDefaultStats) -> bool {
        self.storage.planet_default_stats_hash.at(level).read() == poseidon2_hash(stats.serialize())
    }

    // ========== Config Hash Verification Functions (direct hash comparison) ==========

    /// Verifies that the given hash matches the stored WorldConfig hash.
    #[external("public")]
    #[view]
    fn verify_world_config_hash(hash: Field) -> bool {
        self.storage.world_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored SnarkConfig hash.
    #[external("public")]
    #[view]
    fn verify_snark_config_hash(hash: Field) -> bool {
        self.storage.snark_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored GameConfigCore hash.
    #[external("public")]
    #[view]
    fn verify_game_config_core_hash(hash: Field) -> bool {
        self.storage.game_config_core_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored PlanetLevelThresholds hash.
    #[external("public")]
    #[view]
    fn verify_planet_level_thresholds_hash(hash: Field) -> bool {
        self.storage.planet_level_thresholds_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored PlanetTypeWeightsTier hash for the given tier.
    #[external("public")]
    #[view]
    fn verify_planet_type_weights_tier_hash(tier: u8, hash: Field) -> bool {
        let stored_hash = if tier == 0 {
            self.storage.planet_type_weights_tier_0_hash.read()
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1_hash.read()
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2_hash.read()
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3_hash.read()
        } else {
            assert(false, "tier must be 0..=3");
            0
        };
        stored_hash == hash
    }

    /// Verifies that the given hash matches the stored ArtifactsConfig hash.
    #[external("public")]
    #[view]
    fn verify_artifacts_config_hash(hash: Field) -> bool {
        self.storage.artifacts_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored SpaceshipsConfig hash.
    #[external("public")]
    #[view]
    fn verify_spaceships_config_hash(hash: Field) -> bool {
        self.storage.spaceships_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored SpaceJunkConfig hash.
    #[external("public")]
    #[view]
    fn verify_space_junk_config_hash(hash: Field) -> bool {
        self.storage.space_junk_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored CaptureZonesConfig hash.
    #[external("public")]
    #[view]
    fn verify_capture_zones_config_hash(hash: Field) -> bool {
        self.storage.capture_zones_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored UpgradeConfig hash.
    #[external("public")]
    #[view]
    fn verify_upgrade_config_hash(hash: Field) -> bool {
        self.storage.upgrade_config_hash.read() == hash
    }

    /// Verifies that the given hash matches the stored PlanetDefaultStats hash for the given level.
    #[external("public")]
    #[view]
    fn verify_planet_default_stats_hash(level: u8, hash: Field) -> bool {
        self.storage.planet_default_stats_hash.at(level).read() == hash
    }

    /// Verifies all planet default stats hashes at once. Returns true if all match.
    #[external("public")]
    #[view]
    fn verify_all_planet_default_stats_hashes(hashes: [Field; 10]) -> bool {
        let mut all_match = true;
        for i in 0..10 {
            if self.storage.planet_default_stats_hash.at(i as u8).read() != hashes[i] {
                all_match = false;
            }
        }
        all_match
    }

    /// Verifies config hashes needed for the move function.
    /// Order: [snark, world, game_core, thresholds, space_junk, tier0, tier1, tier2, tier3]
    /// Also verifies planet_default_stats_hash for the given level.
    #[external("public")]
    #[view]
    fn verify_move_config_hashes(
        level: u8,
        planet_default_stats_hash: Field,
        hashes: [Field; 9],
    ) -> bool {
        (self.storage.snark_config_hash.read() == hashes[0])
            & (self.storage.world_config_hash.read() == hashes[1])
            & (self.storage.game_config_core_hash.read() == hashes[2])
            & (self.storage.planet_level_thresholds_hash.read() == hashes[3])
            & (self.storage.space_junk_config_hash.read() == hashes[4])
            & (self.storage.planet_type_weights_tier_0_hash.read() == hashes[5])
            & (self.storage.planet_type_weights_tier_1_hash.read() == hashes[6])
            & (self.storage.planet_type_weights_tier_2_hash.read() == hashes[7])
            & (self.storage.planet_type_weights_tier_3_hash.read() == hashes[8])
            & (self.storage.planet_default_stats_hash.at(level).read() == planet_default_stats_hash)
    }

    /// Verifies all config hashes at once. Returns true if all match.
    /// Order: [world, snark, game_core, thresholds, tier0, tier1, tier2, tier3, artifacts, spaceships, space_junk, capture_zones, upgrade]
    #[external("public")]
    #[view]
    fn verify_all_config_hashes(hashes: [Field; 13]) -> bool {
        (self.storage.world_config_hash.read() == hashes[0])
            & (self.storage.snark_config_hash.read() == hashes[1])
            & (self.storage.game_config_core_hash.read() == hashes[2])
            & (self.storage.planet_level_thresholds_hash.read() == hashes[3])
            & (self.storage.planet_type_weights_tier_0_hash.read() == hashes[4])
            & (self.storage.planet_type_weights_tier_1_hash.read() == hashes[5])
            & (self.storage.planet_type_weights_tier_2_hash.read() == hashes[6])
            & (self.storage.planet_type_weights_tier_3_hash.read() == hashes[7])
            & (self.storage.artifacts_config_hash.read() == hashes[8])
            & (self.storage.spaceships_config_hash.read() == hashes[9])
            & (self.storage.space_junk_config_hash.read() == hashes[10])
            & (self.storage.capture_zones_config_hash.read() == hashes[11])
            & (self.storage.upgrade_config_hash.read() == hashes[12])
    }

    // ========== Storage Access Functions ==========
    // Essential getter functions for accessing contract storage

    #[external("utility")]
    unconstrained fn get_admin_unconstrained() -> AztecAddress {
        self.storage.admin.read()
    }

    /// Noir port of Solidity `DFGetterFacet.adminAddress`.
    /// Returns the admin/owner address of the contract.
    #[external("utility")]
    unconstrained fn admin_address_unconstrained() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    unconstrained fn get_world_config_unconstrained() -> WorldConfig {
        self.storage.world_config.read()
    }

    #[external("utility")]
    unconstrained fn get_snark_config_unconstrained() -> SnarkConfig {
        self.storage.snark_config.read()
    }

    #[external("utility")]
    unconstrained fn get_game_config_core_unconstrained() -> GameConfigCore {
        self.storage.game_config_core.read()
    }

    #[external("utility")]
    unconstrained fn get_planet_level_thresholds_unconstrained() -> PlanetLevelThresholds {
        self.storage.planet_level_thresholds.read()
    }

    #[external("utility")]
    unconstrained fn get_planet_type_weights_tier_unconstrained(tier: u8) -> PlanetTypeWeightsTier {
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
    unconstrained fn get_artifacts_config_unconstrained() -> ArtifactsConfig {
        self.storage.artifacts_config.read()
    }

    #[external("utility")]
    unconstrained fn get_spaceships_config_unconstrained() -> SpaceshipsConfig {
        self.storage.spaceships_config.read()
    }

    #[external("utility")]
    unconstrained fn get_space_junk_config_unconstrained() -> SpaceJunkConfig {
        self.storage.space_junk_config.read()
    }

    #[external("utility")]
    unconstrained fn get_capture_zones_config_unconstrained() -> CaptureZonesConfig {
        self.storage.capture_zones_config.read()
    }

    #[external("utility")]
    unconstrained fn get_upgrade_config_unconstrained() -> UpgradeConfig {
        self.storage.upgrade_config.read()
    }

    #[external("utility")]
    unconstrained fn get_planet_default_stats_unconstrained(level: u8) -> PlanetDefaultStats {
        self.storage.planet_default_stats.at(level).read()
    }

    /// Key is `branch * 10 + level`, matching storage comment.
    #[external("utility")]
    unconstrained fn get_upgrade_unconstrained(key: u128) -> Upgrade {
        self.storage.upgrades.at(key).read()
    }

    #[external("utility")]
    unconstrained fn get_upgrade_by_branch_level_unconstrained(
        branch: u128,
        level: u128,
    ) -> Upgrade {
        let key = branch * 10 + level;
        self.storage.upgrades.at(key).read()
    }

    /// Noir port of Solidity `DFGetterFacet.getTypeWeights`.
    /// Returns the full [4][10][5] planet type weights table.
    #[external("utility")]
    unconstrained fn get_type_weights_unconstrained() -> [[[u128; 5]; 10]; 4] {
        let tier0: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_0.read();
        let tier1: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_1.read();
        let tier2: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_2.read();
        let tier3: PlanetTypeWeightsTier = self.storage.planet_type_weights_tier_3.read();

        [tier0.weights, tier1.weights, tier2.weights, tier3.weights]
    }

    /// Noir port of Solidity `DFGetterFacet.getUpgrades`.
    /// Returns the full [3][4] upgrades table: [branch][level].
    #[external("utility")]
    unconstrained fn get_upgrades_unconstrained() -> [[Upgrade; 4]; 3] {
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
    unconstrained fn get_default_stats_unconstrained() -> [PlanetDefaultStats; 10] {
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
    unconstrained fn get_cumulative_rarity_unconstrained(index: u128) -> u128 {
        self.storage.cumulative_rarities.at(index).read()
    }

    /// Noir port of Solidity `DFGetterFacet.getArtifactPointValues`.
    /// Returns the artifact point values array [6].
    #[external("utility")]
    unconstrained fn get_artifact_point_values_unconstrained() -> [u128; 6] {
        let artifacts_config = self.storage.artifacts_config.read();
        artifacts_config.artifact_point_values
    }

    /// Noir port of Solidity `DFGetterFacet.getRevealCooldown`.
    /// Returns the location reveal cooldown in seconds.
    #[external("utility")]
    unconstrained fn get_reveal_cooldown_unconstrained() -> u64 {
        let world_config = self.storage.world_config.read();
        world_config.location_reveal_cooldown
    }

    // ========== Config Hash Getters (off-chain reading) ==========

    /// Returns the stored hash of WorldConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_world_config_hash_unconstrained() -> Field {
        self.storage.world_config_hash.read()
    }

    /// Returns the stored hash of SnarkConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_snark_config_hash_unconstrained() -> Field {
        self.storage.snark_config_hash.read()
    }

    /// Returns the stored hash of GameConfigCore (unconstrained).
    #[external("utility")]
    unconstrained fn get_game_config_core_hash_unconstrained() -> Field {
        self.storage.game_config_core_hash.read()
    }

    /// Returns the stored hash of PlanetLevelThresholds (unconstrained).
    #[external("utility")]
    unconstrained fn get_planet_level_thresholds_hash_unconstrained() -> Field {
        self.storage.planet_level_thresholds_hash.read()
    }

    /// Returns the stored hash of PlanetTypeWeightsTier for the given tier (unconstrained).
    #[external("utility")]
    unconstrained fn get_planet_type_weights_tier_hash_unconstrained(tier: u8) -> Field {
        if tier == 0 {
            self.storage.planet_type_weights_tier_0_hash.read()
        } else if tier == 1 {
            self.storage.planet_type_weights_tier_1_hash.read()
        } else if tier == 2 {
            self.storage.planet_type_weights_tier_2_hash.read()
        } else if tier == 3 {
            self.storage.planet_type_weights_tier_3_hash.read()
        } else {
            assert(false, "tier must be 0..=3");
            0
        }
    }

    /// Returns the stored hash of ArtifactsConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_artifacts_config_hash_unconstrained() -> Field {
        self.storage.artifacts_config_hash.read()
    }

    /// Returns the stored hash of SpaceshipsConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_spaceships_config_hash_unconstrained() -> Field {
        self.storage.spaceships_config_hash.read()
    }

    /// Returns the stored hash of SpaceJunkConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_space_junk_config_hash_unconstrained() -> Field {
        self.storage.space_junk_config_hash.read()
    }

    /// Returns the stored hash of CaptureZonesConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_capture_zones_config_hash_unconstrained() -> Field {
        self.storage.capture_zones_config_hash.read()
    }

    /// Returns the stored hash of UpgradeConfig (unconstrained).
    #[external("utility")]
    unconstrained fn get_upgrade_config_hash_unconstrained() -> Field {
        self.storage.upgrade_config_hash.read()
    }

    /// Returns the stored hash of PlanetDefaultStats for the given level (unconstrained).
    #[external("utility")]
    unconstrained fn get_planet_default_stats_hash_unconstrained(level: u8) -> Field {
        self.storage.planet_default_stats_hash.at(level).read()
    }

    /// Returns all planet default stats hashes for levels 0-9 (unconstrained).
    #[external("utility")]
    unconstrained fn get_all_planet_default_stats_hashes_unconstrained() -> [Field; 10] {
        [
            self.storage.planet_default_stats_hash.at(0).read(),
            self.storage.planet_default_stats_hash.at(1).read(),
            self.storage.planet_default_stats_hash.at(2).read(),
            self.storage.planet_default_stats_hash.at(3).read(),
            self.storage.planet_default_stats_hash.at(4).read(),
            self.storage.planet_default_stats_hash.at(5).read(),
            self.storage.planet_default_stats_hash.at(6).read(),
            self.storage.planet_default_stats_hash.at(7).read(),
            self.storage.planet_default_stats_hash.at(8).read(),
            self.storage.planet_default_stats_hash.at(9).read(),
        ]
    }

    /// Returns all config hashes in a single call (unconstrained).
    /// Order: [world, snark, game_core, thresholds, tier0, tier1, tier2, tier3, artifacts, spaceships, space_junk, capture_zones, upgrade]
    #[external("utility")]
    unconstrained fn get_all_config_hashes_unconstrained() -> [Field; 13] {
        [
            self.storage.world_config_hash.read(),
            self.storage.snark_config_hash.read(),
            self.storage.game_config_core_hash.read(),
            self.storage.planet_level_thresholds_hash.read(),
            self.storage.planet_type_weights_tier_0_hash.read(),
            self.storage.planet_type_weights_tier_1_hash.read(),
            self.storage.planet_type_weights_tier_2_hash.read(),
            self.storage.planet_type_weights_tier_3_hash.read(),
            self.storage.artifacts_config_hash.read(),
            self.storage.spaceships_config_hash.read(),
            self.storage.space_junk_config_hash.read(),
            self.storage.capture_zones_config_hash.read(),
            self.storage.upgrade_config_hash.read(),
        ]
    }
}
