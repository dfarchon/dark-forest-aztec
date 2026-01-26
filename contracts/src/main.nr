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

    use crate::config::{
        ArtifactsConfig, CaptureZonesConfig, GameConfig, GameConfigCore, PlanetLevelThresholds,
        PlanetTypeWeightsTier, SnarkConstants, SpaceJunkConfig, SpaceshipsConfig, WorldConfig,
    };

    use crate::types::{
        PlanetDefaultStats, Upgrade, Planet, RevealedCoords, Player,
        ArrivalData, Artifact, PlanetEventMetadata,
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
        token_mint_end_timestamp: PublicMutable<u128, Context>,
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
        next_change_block: PublicMutable<u128, Context>,

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
}