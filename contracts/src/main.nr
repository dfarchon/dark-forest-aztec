use dep::aztec::macros::aztec;

mod config;
mod types;
mod libraries;

#[aztec]
pub contract Main {
    use dep::aztec::{
        macros::{functions::{external, initializer, internal}, storage::storage},
        protocol_types::address::AztecAddress,
    };
    use dep::aztec::state_vars::{Map, PublicMutable};
    use dep::aztec::oracle::execution::get_utility_context;

    use crate::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetLevelThresholds,
        PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig, WorldConfig,
    };

    use crate::types::{
        PlanetDefaultStats, Upgrade, Planet, RevealedCoords, Player,
        ArrivalData, Artifact, PlanetEventMetadata, DFPInitPlanetArgs,
    };

    use crate::libraries::game_utils::{
        calculate_byte_uint_from_location_id,
        is_pop_cap_boost,
        is_pop_gro_boost,
        is_range_boost,
        is_speed_boost,
        is_def_boost,
        is_half_space_junk,
    };
    use crate::libraries::lazy_update::{apply_pending_events, update_planet};
    use crate::libraries::planet::apply_spaceship_arrive;

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

        // ========== Game Storage (from LibStorage.GameStorage) ==========
        // Contract housekeeping
        paused: PublicMutable<bool, Context>,
        token_mint_end_timestamp: PublicMutable<u64, Context>,
        planet_levels_count: PublicMutable<u128, Context>,
        // Arrays stored as Maps with index keys (or use counters + Maps for dynamic arrays)
        cumulative_rarities: Map<u128, PublicMutable<u128, Context>, Context>, // index -> value
        initialized_planet_count_by_level: Map<u128, PublicMutable<u128, Context>, Context>, // level -> count
        // Dynamic arrays: use counters + Maps
        planet_ids_count: PublicMutable<u128, Context>, // length of planet_ids array
        planet_ids: Map<u128, PublicMutable<Field, Context>, Context>, // index -> planet_id (location_id)
        revealed_planet_ids_count: PublicMutable<u128, Context>,
        revealed_planet_ids: Map<u128, PublicMutable<Field, Context>, Context>, // index -> planet_id (location_id)
        player_ids_count: PublicMutable<u128, Context>,
        player_ids: Map<u128, PublicMutable<AztecAddress, Context>, Context>, // index -> player address
        // Game world state
        world_radius: PublicMutable<u128, Context>,
        planet_events_count: PublicMutable<u128, Context>,
        misc_nonce: PublicMutable<u128, Context>,
        // Mappings - planet/location keys use Field
        planets: Map<Field, PublicMutable<Planet, Context>, Context>, // location_id -> Planet
        revealed_coords: Map<Field, PublicMutable<RevealedCoords, Context>, Context>, // location_id -> RevealedCoords
        artifact_id_to_planet_id: Map<Field, PublicMutable<Field, Context>, Context>, // artifact_id -> planet_id (location_id)
        artifact_id_to_voyage_id: Map<Field, PublicMutable<u128, Context>, Context>, // artifact_id -> voyage_id
        players: Map<AztecAddress, PublicMutable<Player, Context>, Context>, // player address -> Player
        // Planet events: mapping(uint256 => PlanetEventMetadata[])
        // Stored as: Map<location_id, Map<event_index, PlanetEventMetadata>>
        planet_events: Map<Field, Map<u128, PublicMutable<PlanetEventMetadata, Context>, Context>, Context>, // location_id -> (index -> event)
        planet_events_count_by_location: Map<Field, PublicMutable<u128, Context>, Context>, // location_id -> count
        // Arrivals: mapping(uint256 => ArrivalData)
        planet_arrivals: Map<u128, PublicMutable<ArrivalData, Context>, Context>, // event_id -> ArrivalData
        // Planet artifacts: mapping(uint256 => uint256[])
        planet_artifacts_count: Map<Field, PublicMutable<u128, Context>, Context>, // planet_id (location_id) -> count
        planet_artifacts: Map<Field, Map<u128, PublicMutable<Field, Context>, Context>, Context>, // planet_id (location_id) -> (index -> artifact_id)
        // Artifacts: mapping(uint256 => Artifact)
        artifacts: Map<Field, PublicMutable<Artifact, Context>, Context>, // artifact_id -> Artifact
        // Capture Zones
        next_change_block: PublicMutable<u32, Context>,

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

    /// Initialize game state arrays: initializedPlanetCountByLevel and cumulativeRarities.
    /// Noir port of DFInitialize.sol lines 204-209.
    ///
    /// - Sets initializedPlanetCountByLevel[0..9] = 0
    /// - Computes cumulativeRarities[i] = (2^24 / thresholds[i]) * planet_rarity for i in 0..9
    #[external("public")]
    fn initialize_game_state_arrays() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");

        let thresholds = self.storage.planet_level_thresholds.read().thresholds;
        let planet_rarity: u128 = self.storage.game_config_core.read().planet_rarity;
        let base: u128 = 1 << 24; // 2^24

        // Initialize initializedPlanetCountByLevel[0..9] = 0
        for level in 0..10 {
            self.storage.initialized_planet_count_by_level.at(level as u128).write(0);
        }

        // Compute cumulativeRarities[i] = (2^24 / thresholds[i]) * planet_rarity
        for i in 0..10 {
            let threshold: u128 = thresholds[i];
            assert(threshold != 0, "threshold must be nonzero");
            let cumulative_rarity: u128 = (base / threshold) * planet_rarity;
            self.storage.cumulative_rarities.at(i as u128).write(cumulative_rarity);
        }
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

    #[external("public")]
    fn initialize_world_radius() {
        assert(self.msg_sender().unwrap() == self.storage.admin.read(), "Only admin");
        self.internal.update_world_radius();
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

    // ---- game state arrays getters (utility) ----
    #[external("utility")]
    unconstrained fn get_initialized_planet_count_by_level(level: u128) -> u128 {
        self.storage.initialized_planet_count_by_level.at(level).read()
    }

    #[external("utility")]
    unconstrained fn get_cumulative_rarity(index: u128) -> u128 {
        self.storage.cumulative_rarities.at(index).read()
    }

    #[external("utility")]
    unconstrained fn get_world_radius() -> u128 {
        self.storage.world_radius.read()
    }

    // ========== LibGameUtils ==========

    /// Noir port of Solidity `LibGameUtils._locationIdValid`.
    /// Returns true iff `loc < ((BN254_PRIME - 1) / planet_rarity)`.
    ///
    /// This bounds `loc` so that `loc * planet_rarity` cannot overflow the BN254 field modulus.
    /// 
    /// Note: We use PRIME_MINUS_ONE (the maximum Field value) instead of PRIME since PRIME
    /// itself cannot be represented as a Field value. This gives a slightly more conservative bound.
    #[internal("public")]
    fn location_id_valid(loc: Field) -> bool {
        let rarity: u128 = self.storage.game_config_core.read().planet_rarity;
        assert(rarity != 0, "planet_rarity must be nonzero");

        // BN254 field modulus - 1 (maximum Field value):
        // 21888242871839275222246405745257275088548364400416034343698204186575808495616
        let PRIME_MINUS_ONE: Field = 21888242871839275222246405745257275088548364400416034343698204186575808495616;
        
        // Compute (PRIME - 1) / rarity, which approximates PRIME / rarity
        // Since (PRIME - 1) / rarity < PRIME - 1, Field division gives the correct integer result
        let max_valid_loc: Field = PRIME_MINUS_ONE / (rarity as Field);
        
        // Use lt method to compare Field values
        loc.lt(max_valid_loc)
    }

    /// Noir port of Solidity `LibGameUtils.revertIfBadSnarkPerlinFlags`.
    /// Validates that the SNARK perlin flags match the configured constants.
    /// 
    /// This function ensures that SNARK proofs use the correct keys and parameters
    /// for this universe. Without this check, a player could create a valid SNARK
    /// proof with wrong keys, creating an invalid planet.
    /// 
    /// # Arguments
    /// - `perlin_flags`: Array of 5 flags [planethash_key, spacetype/biomebase_key, perlin_length_scale, mirror_x, mirror_y]
    /// - `checking_biome`: If true, checks biomebase_key instead of spacetype_key
    /// 
    /// # Returns
    /// `true` if all flags match the configured constants
    #[internal("public")]
    fn revert_if_bad_snark_perlin_flags(
        planethash_key: u128, 
        spacetype_key: u128,
        biomebase_key: u128,
        perlin_mirror_x: bool,
        perlin_mirror_y: bool,
        perlin_length_scale: u128,
        checking_biome: bool
    ) -> bool {

        let snark_constants = self.storage.snark_constants.read();
        assert(planethash_key == snark_constants.planethash_key, "bad planethash mimc key");
        if( checking_biome ) {
            assert(spacetype_key == snark_constants.spacetype_key, "bad spacetype mimc key");
        } else {
            assert(biomebase_key == snark_constants.biomebase_key, "bad biomebase mimc key");
        }
        assert(perlin_length_scale == snark_constants.perlin_length_scale, "bad perlin length scale");
        assert(perlin_mirror_x == snark_constants.perlin_mirror_x, "bad perlin mirror x");
        assert(perlin_mirror_y == snark_constants.perlin_mirror_y, "bad perlin mirror y");
        
        true
    }

    /// Noir port of Solidity `LibGameUtils.spaceTypeFromPerlin`.
    /// Returns SpaceType as u8 (0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace).
    #[internal("public")]
    fn space_type_from_perlin(perlin: u128) -> u8 {
        let cfg = self.storage.game_config_core.read();
        if perlin >= cfg.perlin_threshold_3 {
            3 // SpaceType::DeadSpace
        } else if perlin >= cfg.perlin_threshold_2 {
            2 // SpaceType::DeepSpace
        } else if perlin >= cfg.perlin_threshold_1 {
            1 // SpaceType::Space
        } else {
            0 // SpaceType::Nebula
        }
    }

    /// Noir port of Solidity `LibGameUtils._getPlanetLevelTypeAndSpaceType`.
    /// Returns `(level, planet_type, space_type)` where both planet_type and space_type are u8.
    /// planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
    /// space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
    #[internal("public")]
    fn get_planet_level_type_and_space_type(
        location_id: Field,
        perlin: u128,
    ) -> (u8, u8, u8) {
        let space_type: u8 = space_type_from_perlin(perlin);

        // Solidity: bytes b = abi.encodePacked(uint256(location_id));
        // and then planetLevelUInt = byte[4..=6] interpreted as big-endian.
        let planet_level_uint: u128 = calculate_byte_uint_from_location_id(location_id, 4, 6);

        // Reverse-iterate thresholds (9..0) and pick first where planet_level_uint < threshold[i].
        let thresholds = self.storage.planet_level_thresholds.read().thresholds;
        let mut level: u8 = 0;
        let mut found_level: bool = false;
        for j in 0..10 {
            let idx: u32 = 9 - j; // 9..0
            if !found_level {
                if planet_level_uint < thresholds[idx] {
                    level = idx as u8;
                    found_level = true;
                }
            }
        }
        assert(found_level, "level not found");

        // Clip by space type (matches Solidity).
        // space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
        if space_type == 0 { // Nebula
            if level > 4 {
                level = 4;
            }
        }
        if space_type == 1 { // Space
            if level > 5 {
                level = 5;
            }
        }

        // Clip to <= MAX_NATURAL_PLANET_LEVEL.
        let max_level: u8 = self.storage.game_config_core.read().max_natural_planet_level as u8;
        if level > max_level {
            level = max_level;
        }

        // Get weights row for this (space_type, level).
        // space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
        let tier: PlanetTypeWeightsTier = if space_type == 0 { // Nebula
            self.storage.planet_type_weights_tier_0.read()
        } else if space_type == 1 { // Space
            self.storage.planet_type_weights_tier_1.read()
        } else if space_type == 2 { // DeepSpace
            self.storage.planet_type_weights_tier_2.read()
        } else { // DeadSpace
            self.storage.planet_type_weights_tier_3.read()
        };
        let level_idx: u32 = level as u32;
        let weights: [u128; 5] = tier.weights[level_idx];

        // Build thresholds array exactly like Solidity:
        // thresholds[i] = (cumulative_weights_from_end * 256) / weightSum
        let mut weight_sum: u128 = 0;
        for i in 0..5 {
            weight_sum += weights[i];
        }
        assert(weight_sum != 0, "weight_sum must be nonzero");

        let mut type_thresholds: [u128; 5] = [0; 5];
        type_thresholds[0] = weight_sum - weights[0];
        for i in 1..5 {
            type_thresholds[i] = type_thresholds[i - 1] - weights[i];
        }
        for i in 0..5 {
            type_thresholds[i] = (type_thresholds[i] * 256) / weight_sum;
        }

        // Solidity: uint8 typeByte = uint8(b[8]);
        let type_byte: u128 = calculate_byte_uint_from_location_id(location_id, 8, 8);

        // Pick the first i where type_byte >= threshold[i].
        // planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
        let mut planet_type: u8 = 0; // PlanetType::Planet = 0
        let mut picked: bool = false;
        for i in 0..5 {
            if !picked & type_byte >= type_thresholds[i] {
                planet_type = i as u8;
                picked = true;
            }
        }

        (level, planet_type, space_type)
    }



    /// Noir port of Solidity `LibGameUtils._getRadius`.
    /// Calculates the world radius based on player count and initialized planets.
    /// todo: introduce a better algorithm
    #[internal("public")]
    fn get_radius() -> u128 {
        let n_players: u128 = self.storage.player_ids_count.read();
        let world_radius_min: u128 = self.storage.world_config.read().world_radius_min;
        let initialized_count_level_4: u128 = self.storage.initialized_planet_count_by_level.at(4).read();
        let target4: u128 = initialized_count_level_4 + 20 * n_players;
        let cumulative_rarity_4: u128 = self.storage.cumulative_rarities.at(4).read();
        let target_radius_squared_4: u128 = (target4 * cumulative_rarity_4 * 100) / 314;
        
        // Simple approximation: use a fixed scaling factor to approximate sqrt
        // This avoids complex sqrt calculations while still producing a reasonable radius
        let r4: u128 = target_radius_squared_4 / 1000; // Simple linear approximation
        
        if r4 < world_radius_min {
            world_radius_min
        } else {
            r4
        }
    }

    /// Noir port of Solidity `LibGameUtils._putArtifactOnPlanet`.
    /// Updates internal contract book-keeping to reflect that the given artifact was put on a planet.
    /// Note: This function does not transfer the artifact, it only updates the book-keeping.
    /// 
    /// # Arguments
    /// - `artifact_id`: The ID of the artifact to put on the planet
    /// - `location_id`: The location ID (planet ID) where the artifact is being placed
    #[internal("public")]
    fn put_artifact_on_planet(artifact_id: Field, location_id: Field) {
        // Set artifact_id -> planet_id mapping
        self.storage.artifact_id_to_planet_id.at(artifact_id).write(location_id);
        
        // Get current count of artifacts on this planet
        let current_count = self.storage.planet_artifacts_count.at(location_id).read();
        
        // Add artifact to the planet's artifact list at the next index
        self.storage.planet_artifacts.at(location_id).at(current_count).write(artifact_id);
        
        // Increment the artifact count for this planet
        self.storage.planet_artifacts_count.at(location_id).write(current_count + 1);
    }

    /// Noir port of Solidity `LibGameUtils.getPlanetDefaultSpaceJunk`.
    /// Returns the default space junk for a planet based on its level.
    /// Home planets have 0 space junk.
    /// 
    /// # Arguments
    /// - `planet`: The planet to get default space junk for
    /// 
    /// # Returns
    /// The default space junk value for the planet
    #[internal("public")]
    fn get_planet_default_space_junk(planet: Planet) -> u128 {
        if planet.is_home_planet {
            0
        } else {
            let space_junk_config = self.storage.space_junk_config.read();
            space_junk_config.planet_level_junk[planet.planet_level as u32]
        }
    }

    /// Noir port of Solidity `LibGameUtils.checkPlanetDOS`.
    /// Checks if a planet is rate-limited for arrivals.
    #[internal("public")]
    fn check_planet_dos(location_id: Field, sender: AztecAddress) {
        let mut arrivals_from_owner: u8 = 0;
        let mut arrivals_from_others: u8 = 0;

        let events_count: u128 = self.storage.planet_events_count_by_location.at(location_id).read();
        for i in 0..events_count {
            let event: PlanetEventMetadata = self.storage.planet_events.at(location_id).at(i).read();
            // PlanetEventType::Arrival = 0
            if event.event_type == 0 {
                let arrival: ArrivalData = self.storage.planet_arrivals.at(event.id).read();
                let planet: Planet = self.storage.planets.at(location_id).read();
                if arrival.player == planet.owner {
                    arrivals_from_owner += 1;
                } else {
                    arrivals_from_others += 1;
                }
            }
        }

        let planet: Planet = self.storage.planets.at(location_id).read();
        if sender == planet.owner {
            assert(arrivals_from_owner < 6, "Planet is rate-limited");
        } else {
            assert(arrivals_from_others < 6, "Planet is rate-limited");
        }

        assert(arrivals_from_owner + arrivals_from_others < 12, "Planet is rate-limited");
    }

    /// Noir port of Solidity `LibGameUtils.updateWorldRadius`.
    /// Updates the world radius if it's not locked.
    #[internal("public")]
    fn update_world_radius() {
        let world_config = self.storage.world_config.read();
        if !world_config.world_radius_locked {
            let new_radius = self.internal.get_radius();
            self.storage.world_radius.write(new_radius);
        }
    }


    /// Noir port of Solidity `LibGameUtils._defaultPlanet`.
    /// Creates a default planet with the given parameters.
    /// planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
    /// space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
    #[internal("public")]
    fn default_planet(
        location: Field,
        level: u128,
        planet_type: u8,
        space_type: u8,
    ) -> Planet {
        let planet_default_stats: PlanetDefaultStats = self.storage.planet_default_stats.at(level as u8).read();
        let world_config = self.storage.world_config.read();
        let time_factor_hundredths: u128 = world_config.time_factor_hundredths;

        // space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
        let dead_space: bool = space_type == 3; // DeadSpace
        let deep_space: bool = space_type == 2; // DeepSpace
        let medium_space: bool = space_type == 1; // Space

        let mut planet = Planet {
            owner: AztecAddress::zero(),
            planet_level: level as u8,
            population: 0, // Will be calculated after all buffs/debuffs are applied
            population_cap: planet_default_stats.population_cap,
            population_growth: planet_default_stats.population_growth,
            range: planet_default_stats.range,
            speed: planet_default_stats.speed,
            defense: planet_default_stats.defense,
            silver_cap: planet_default_stats.silver_cap,
            silver_growth: 0,
            silver: 0,
            planet_type: planet_type, // Already u8: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
            is_home_planet: false,
            is_initialized: false,
            created_at: 0,
            last_updated: 0,
            perlin: 0,
            space_type: space_type, // Already u8: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
            upgrade_state_0: 0,
            upgrade_state_1: 0,
            upgrade_state_2: 0,
            hat_level: 0,
            has_tried_finding_artifact: false,
            prospected_block_number: 0,
            destroyed: false,
            space_junk: 0,
            pausers: 0,
            energy_gro_doublers: 0,
            silver_gro_doublers: 0,
            invader: AztecAddress::zero(),
            invade_start_block: 0,
            capturer: AztecAddress::zero(),
            location_id: location,
        };

        // planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
        if planet_type == 1 { // PlanetType::SilverMine
            planet.silver_growth = planet_default_stats.silver_growth;
        }

        if is_pop_cap_boost(location) {
            planet.population_cap *= 2;
        }
        if is_pop_gro_boost(location) {
            planet.population_growth *= 2;
        }
        if is_range_boost(location) {
            planet.range *= 2;
        }
        if is_speed_boost(location) {
            planet.speed *= 2;
        }
        if is_def_boost(location) {
            planet.defense *= 2;
        }

        // Space type buffs and debuffs
        if dead_space {
            // Dead space buff
            planet.range = planet.range * 2;
            planet.speed = planet.speed * 2;
            planet.population_cap = planet.population_cap * 2;
            planet.population_growth = planet.population_growth * 2;
            planet.silver_cap = planet.silver_cap * 2;
            planet.silver_growth = planet.silver_growth * 2;

            // Dead space debuff
            planet.defense = (planet.defense * 3) / 20;
        } else if deep_space {
            // Deep space buff
            planet.range = (planet.range * 3) / 2;
            planet.speed = (planet.speed * 3) / 2;
            planet.population_cap = (planet.population_cap * 3) / 2;
            planet.population_growth = (planet.population_growth * 3) / 2;
            planet.silver_cap = (planet.silver_cap * 3) / 2;
            planet.silver_growth = (planet.silver_growth * 3) / 2;

            // Deep space debuff
            planet.defense = planet.defense / 4;
        } else if medium_space {
            // Buff
            planet.range = (planet.range * 5) / 4;
            planet.speed = (planet.speed * 5) / 4;
            planet.population_cap = (planet.population_cap * 5) / 4;
            planet.population_growth = (planet.population_growth * 5) / 4;
            planet.silver_cap = (planet.silver_cap * 5) / 4;
            planet.silver_growth = (planet.silver_growth * 5) / 4;

            // Debuff
            planet.defense = planet.defense / 2;
        }

        // Apply buffs/debuffs for nonstandard planets
        // planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
        if planet_type == 1 { // PlanetType::SilverMine
            planet.silver_cap *= 2;
            planet.defense /= 2;
        } else if planet_type == 4 { // PlanetType::SilverBank
            planet.speed /= 2;
            planet.silver_cap *= 10;
            planet.population_growth = 0;
            planet.population_cap *= 5;
        } else if planet_type == 3 { // PlanetType::TradingPost
            planet.defense /= 2;
            planet.silver_cap *= 2;
        }

        // Initial population (pirates) and silver
        planet.population = (planet.population_cap * planet_default_stats.barbarian_percentage) / 100;

        // Pirates adjusted for def debuffs, and buffed in space/deepspace
        if dead_space {
            planet.population *= 20;
        } else if deep_space {
            planet.population *= 10;
        } else if medium_space {
            planet.population *= 4;
        }
        // planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
        if planet_type == 4 { // PlanetType::SilverBank
            planet.population /= 2;
        }

        // Adjust silver cap for mine
        if planet_type == 1 { // PlanetType::SilverMine
            planet.silver = planet.silver_cap / 2;
        }

        // Apply time factor
        planet.speed = planet.speed * time_factor_hundredths / 100;
        planet.population_growth = planet.population_growth * time_factor_hundredths / 100;
        planet.silver_growth = planet.silver_growth * time_factor_hundredths / 100;

        planet
    }

    // ========== LibPlanet ==========

    /// Noir port of Solidity `LibPlanet.revealLocation`.
    /// Reveals the coordinates of a planet location.
    /// 
    /// This function:
    /// 1. Optionally checks if enough time has passed since the last reveal (cooldown)
    /// 2. Verifies the location hasn't been revealed already
    /// 3. Adds the location to the revealed planets list
    /// 4. Stores the revealed coordinates
    /// 5. Updates the player's last reveal timestamp
    /// 
    /// # Arguments
    /// - `location`: The location ID to reveal
    /// - `perlin`: The perlin value at that location
    /// - `x`: The x coordinate
    /// - `y`: The y coordinate
    /// - `check_timestamp`: Whether to check the cooldown period
    /// - `timestamp`: The current timestamp
    #[internal("public")]
    fn reveal_location(
        location: Field,
        perlin: u128,
        x: u128,
        y: u128,
        check_timestamp: bool
    ) {
        let sender = self.msg_sender().unwrap();
        let timestamp = get_utility_context().timestamp();

        // Check cooldown if requested
        if check_timestamp {
            let player: Player = self.storage.players.at(sender).read();
            let world_config = self.storage.world_config.read();
            let cooldown = world_config.location_reveal_cooldown_s;
            assert(
                timestamp > player.last_reveal_timestamp + cooldown,
                "wait for cooldown before revealing again"
            );
        }
        
        // Check if location is already revealed
        let existing_coords: RevealedCoords = self.storage.revealed_coords.at(location).read();
        assert(existing_coords.location_id == 0 as Field, "Location already revealed");
        
        // Add location to revealed planets list
        let revealed_count = self.storage.revealed_planet_ids_count.read();
        self.storage.revealed_planet_ids.at(revealed_count).write(location);
        self.storage.revealed_planet_ids_count.write(revealed_count + 1);
        
        // Store revealed coordinates
        let revealed_coords = RevealedCoords {
            location_id: location,
            x: x,
            y: y,
            revealer: sender,
        };
        self.storage.revealed_coords.at(location).write(revealed_coords);
        
        // Update player's last reveal timestamp
        let mut player: Player = self.storage.players.at(sender).read();
        player.last_reveal_timestamp = timestamp;
        self.storage.players.at(sender).write(player);
    }

    /// Noir port of Solidity `LibPlanet.getDefaultInitPlanetArgs`.
    /// Returns default initialization arguments for a planet.
    /// 
    /// This function calls `get_planet_level_type_and_space_type` internally
    /// and accesses world config to get `time_factor_hundredths`.
    #[internal("public")]
    fn get_default_init_planet_args(
        location: Field,
        perlin: u128,
        is_home_planet: bool,
    ) -> DFPInitPlanetArgs {
        let (level, planet_type, space_type) = get_planet_level_type_and_space_type(location, perlin);

        // Validate home planet requirements (matching Solidity behavior)
        if is_home_planet {
            assert(level == 0, "Can only initialize on planet level 0");
            assert(planet_type == 0, "Can only initialize on regular planets"); // PlanetType::Planet = 0
        }

        let time_factor_hundredths: u128 = self.storage.world_config.read().time_factor_hundredths;

        DFPInitPlanetArgs {
            location,
            perlin,
            level,
            time_factor_hundredths,
            space_type,
            planet_type,
            is_home_planet,
        }
    }

 

    /// Noir port of Solidity `LibPlanet.initializePlanetWithDefaults`.
    /// Initializes a planet with default values using location and perlin.
    /// 
    /// This function:
    /// 1. Validates the location ID
    /// 2. Gets default initialization arguments
    /// 3. Initializes the planet
    /// 4. Adds the planet to the planet IDs list
    /// 5. Increments the initialized planet count for the level
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet
    /// - `perlin`: The perlin value at that location
    /// - `is_home_planet`: Whether this is a home planet
    #[internal("public")]
    fn initialize_planet_with_defaults(
        location: Field,
        perlin: u128,
        is_home_planet: bool,
    ) {
        // Validate location
        assert(self.internal.location_id_valid(location), "Not a valid planet location");

        // Get default initialization arguments
        let init_args = self.internal.get_default_init_planet_args(location, perlin, is_home_planet);

        // Initialize the planet
        self.internal._initialize_planet(init_args);

        // Add planet to planet IDs list
        let planet_ids_count = self.storage.planet_ids_count.read();
        self.storage.planet_ids.at(planet_ids_count).write(location);
        self.storage.planet_ids_count.write(planet_ids_count + 1);

        // Increment initialized planet count for the level
        let level_count = self.storage.initialized_planet_count_by_level.at(init_args.level as u128).read();
        self.storage.initialized_planet_count_by_level.at(init_args.level as u128).write(level_count + 1);
    }

    /// Noir port of Solidity `LibPlanet._initializePlanet`.
    /// Internal function to initialize a planet with the given arguments.
    /// 
    /// This function:
    /// 1. Checks the planet is not already initialized
    /// 2. Gets default planet values
    /// 3. Sets all planet fields
    /// 4. Handles home planet special cases
    /// 5. Sets space junk for non-home planets
    /// 
    /// # Arguments
    /// - `args`: The initialization arguments for the planet
    #[internal("public")]
    fn _initialize_planet(args: DFPInitPlanetArgs) {
        let mut planet: Planet = self.storage.planets.at(args.location).read();
        
        // Can't initialize a planet twice
        assert(!planet.is_initialized, "Planet is already initialized");

        // Get default planet
        let default_planet = self.internal.default_planet(
            args.location,
            args.level as u128,
            args.planet_type,
            args.space_type,
        );

        // Set all planet fields from default planet
        planet.location_id = args.location;
        planet.owner = default_planet.owner;
        planet.is_home_planet = default_planet.is_home_planet;
        planet.range = default_planet.range;
        planet.speed = default_planet.speed;
        planet.defense = default_planet.defense;
        planet.population = default_planet.population;
        planet.population_cap = default_planet.population_cap;
        planet.population_growth = default_planet.population_growth;
        planet.silver_cap = default_planet.silver_cap;
        planet.silver_growth = default_planet.silver_growth;
        planet.silver = default_planet.silver;
        planet.planet_level = default_planet.planet_level;
        planet.planet_type = default_planet.planet_type;

        planet.is_initialized = true;
        planet.perlin = args.perlin as u8;
        planet.space_type = args.space_type;
        
        // Set timestamps using utility context
        let timestamp = get_utility_context().timestamp();
        planet.created_at = timestamp;
        planet.last_updated = timestamp;
        
        planet.upgrade_state_0 = 0;
        planet.upgrade_state_1 = 0;
        planet.upgrade_state_2 = 0;
        planet.pausers = 0;
        planet.energy_gro_doublers = 0;
        planet.silver_gro_doublers = 0;

        // Handle home planet special cases
        if args.is_home_planet {
            planet.is_home_planet = true;
            planet.owner = self.msg_sender().unwrap();
            planet.population = 50000;
        } else {
            // Set space junk for non-home planets
            planet.space_junk = self.internal.get_planet_default_space_junk(planet);
            
            // Check if half space junk applies
            if is_half_space_junk(args.location) {
                planet.space_junk = planet.space_junk / 2;
            }
        }

        // Write planet to storage
        self.storage.planets.at(args.location).write(planet);
    }

    /// Noir port of Solidity `LibPlanet.checkPlayerInit`.
    /// Validates that a player can initialize at the given location.
    /// 
    /// Checks:
    /// - Player is not already initialized
    /// - Radius is within world radius
    /// - If SPAWN_RIM_AREA is set, player must spawn at the universe rim
    /// - Perlin value is within allowed range (INIT_PERLIN_MIN <= perlin < INIT_PERLIN_MAX)
    /// 
    /// # Arguments
    /// - `location`: The location ID where the player wants to initialize
    /// - `perlin`: The perlin value at that location
    /// - `radius`: The radius of the initialization
    /// - `sender`: The address of the player attempting to initialize
    /// 
    /// # Returns
    /// `true` if all checks pass
    #[internal("public")]
    fn check_player_init(
        location: Field,
        perlin: u128,
        radius: u128,
        sender: AztecAddress,
    ) -> bool {
        let player: Player = self.storage.players.at(sender).read();
        assert(!player.is_initialized, "Player is already initialized");

        let world_radius: u128 = self.storage.world_radius.read();
        assert(radius <= world_radius, "Init radius is bigger than the current world radius");

        let game_config: GameConfigCore = self.storage.game_config_core.read();
        let world_config: WorldConfig = self.storage.world_config.read();

        if world_config.spawn_rim_area != 0 {
            let radius_squared_times_pi: u128 = (radius * radius * 314) / 100;
            let world_radius_squared_times_pi: u128 = (world_radius * world_radius * 314) / 100;
            assert(
                radius_squared_times_pi + world_config.spawn_rim_area >= world_radius_squared_times_pi,
                "Player can only spawn at the universe rim"
            );
        }

        assert(
            perlin >= game_config.init_perlin_min,
            "Init not allowed in perlin value less than INIT_PERLIN_MIN"
        );
        assert(
            perlin < game_config.init_perlin_max,
            "Init not allowed in perlin value greater than or equal to the INIT_PERLIN_MAX"
        );

        true
    }

    /// Noir port of Solidity `LibPlanet.getRefreshedPlanet`.
    /// Refreshes a planet's state by applying pending events and updating resources.
    /// 
    /// This function:
    /// 1. Reads the planet and its events from storage
    /// 2. Applies pending events (arrivals, etc.)
    /// 3. Applies spaceship artifacts that have arrived
    /// 4. Updates planet resources (population, silver) based on time elapsed
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet to refresh
    /// - `timestamp`: The current timestamp to update to
    /// 
    /// # Returns
    /// A tuple containing:
    /// - `planet`: The refreshed planet
    /// - `events_to_remove`: Array of 12 event IDs to remove
    /// - `artifacts_to_add`: Array of 12 artifact IDs that are new on the planet
    #[internal("public")]
    fn get_refreshed_planet(
        location: Field,
        timestamp: u64,
    ) -> (Planet, [u128; 12], [u128; 12]) {
        let mut planet: Planet = self.storage.planets.at(location).read();

        // Read events from storage
        let events_count: u128 = self.storage.planet_events_count_by_location.at(location).read();
        let mut events: [PlanetEventMetadata; 24] = [PlanetEventMetadata {
            id: 0,
            event_type: 0,
            time_trigger: 0,
            time_created: 0,
        }; 24];
        let mut arrivals: [ArrivalData; 24] = [ArrivalData {
            id: 0,
            player: AztecAddress::zero(),
            from_planet: 0 as Field,
            to_planet: 0 as Field,
            pop_arriving: 0,
            silver_moved: 0,
            departure_time: 0,
            arrival_time: 0,
            arrival_type: 0,
            carried_artifact_id: 0,
            distance: 0,
        }; 24];

        // Read events and corresponding arrivals
        for i in 0..events_count {
            if i < 24 {
                events[i as u32] = self.storage.planet_events.at(location).at(i).read();
                // PlanetEventType::Arrival = 0
                if events[i as u32].event_type == 0 {
                    arrivals[i as u32] = self.storage.planet_arrivals.at(events[i as u32].id).read();
                }
            }
        }

        // Apply pending events
        let (updated_planet, event_ids_and_artifacts) = apply_pending_events(
            timestamp,
            planet,
            events,
            events_count,
            arrivals,
        );
        planet = updated_planet;

        // Split the result: first 12 are event ids to remove, last 12 are artifact ids
        let mut events_to_remove: [u128; 12] = [0; 12];
        let mut artifacts_to_add: [u128; 12] = [0; 12];
        for i in 0..12 {
            events_to_remove[i] = event_ids_and_artifacts[i];
            artifacts_to_add[i] = event_ids_and_artifacts[i + 12];
        }

        // Apply spaceship artifacts
        for i in 0..12 {
            if artifacts_to_add[i] != 0 {
                let artifact: Artifact = self.storage.artifacts.at(artifacts_to_add[i] as Field).read();
                planet = apply_spaceship_arrive(artifact, planet);
            }
        }

        // Update planet resources
        planet = update_planet(timestamp, planet);

        (planet, events_to_remove, artifacts_to_add)
    }

    /// Noir port of Solidity `LibPlanet.refreshPlanet`.
    /// Refreshes a planet's state by applying pending events and updating resources.
    /// 
    /// This function:
    /// 1. Gets the refreshed planet state from `get_refreshed_planet`
    /// 2. Updates the planet in storage
    /// 3. Removes completed events
    /// 4. Adds artifacts that have arrived to the planet
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet to refresh
    /// - `timestamp`: The current timestamp to update to
    #[internal("public")]
    fn refresh_planet(location: Field, timestamp: u64) {
        // Check if planet is initialized
        let planet: Planet = self.storage.planets.at(location).read();
        assert(planet.is_initialized, "Planet has not been initialized");

        // Get refreshed planet state
        let (refreshed_planet, events_to_remove, artifact_ids_to_add_to_planet) = 
            self.internal.get_refreshed_planet(location, timestamp);

        // Update planet in storage
        self.storage.planets.at(location).write(refreshed_planet);

        // Remove events
        // In Solidity, this uses swap-and-pop pattern
        // In Noir with Map storage, we need to find and remove events differently
        let mut events_count = self.storage.planet_events_count_by_location.at(location).read();
        
        // For each event to remove, find it and remove it
        for to_remove_idx in 0..12 {
            let event_id_to_remove = events_to_remove[to_remove_idx];
            if event_id_to_remove != 0 {
                // Find the event with matching ID
                let mut found_index: u128 = events_count; // Use events_count as "not found" marker
                let mut found: bool = false;
                for i in 0..events_count {
                    let event = self.storage.planet_events.at(location).at(i).read();
                    if event.id == event_id_to_remove {
                        found_index = i;
                        found = true;
                    }
                }
                
                // If found, remove it by swapping with last element
                if found {
                    // Get the last event
                    let last_index = events_count - 1;
                    if found_index < last_index {
                        // Swap: copy last event to found position
                        let last_event = self.storage.planet_events.at(location).at(last_index).read();
                        self.storage.planet_events.at(location).at(found_index).write(last_event);
                    }
                    // Decrement count (effectively removes the last element)
                    events_count = events_count - 1;
                    self.storage.planet_events_count_by_location.at(location).write(events_count);
                }
            }
        }

        // Add artifacts that have arrived to the planet
        for i in 0..12 {
            let artifact_id = artifact_ids_to_add_to_planet[i];
            if artifact_id != 0 {
                // Set voyage_id to 0 (artifact has arrived)
                self.storage.artifact_id_to_voyage_id.at(artifact_id as Field).write(0);
                // Add artifact to planet
                self.internal.put_artifact_on_planet(artifact_id as Field, location);
            }
        }
    }

}