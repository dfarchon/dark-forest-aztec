use dep::aztec::macros::aztec;

mod types;
mod libraries;
mod circuits;

#[aztec]
pub contract Main {
    use dep::aztec::{
        macros::{events::event, functions::{external, initializer, internal, only_self}, storage::storage},
        protocol_types::address::AztecAddress,
    };

    use dep::config::{
        Config,
        ArtifactsConfig, GameConfigCore, PlanetDefaultStats, PlanetTypeWeightsTier,
        SnarkConstants, SpaceJunkConfig, Upgrade, WorldConfig,
    };

    use dep::aztec::state_vars::{Map, PublicMutable};

    use crate::types::{
        Planet, RevealedCoords, Player,
        ArrivalData, Artifact, PlanetEventMetadata, DFPInitPlanetArgs,
        AdminCreatePlanetArgs, DFPMoveArgs, DFPCreateArrivalArgs,
    };

    use crate::libraries::game_utils::{
        calculate_byte_uint_from_location_id,
        revert_if_bad_snark_perlin_flags,
        space_type_from_perlin,
        location_id_valid,
        is_pop_cap_boost,
        is_pop_gro_boost,
        is_range_boost,
        is_speed_boost,
        is_def_boost,
        is_half_space_junk,
    };
    use crate::libraries::lazy_update::{apply_pending_events, update_planet};
    use crate::libraries::planet::apply_spaceship_arrive;
    use crate::circuits::init::init_proof;
    use crate::circuits::reveal::reveal_proof;
    use crate::circuits::move::move_proof;

    // ========== Storage Structure ==========
    // Full storage structure
    #[storage]
    struct Storage<Context> {
        
        // ========== Config Storage ==========
        admin: PublicMutable<AztecAddress, Context>,
        config_address: PublicMutable<AztecAddress, Context>,

        // ========== Game Storage (from LibStorage.GameStorage) ==========
        // Contract housekeeping
        paused: PublicMutable<bool, Context>,
        token_mint_end_timestamp: PublicMutable<u64, Context>,
       
        // Arrays stored as Maps with index keys (or use counters + Maps for dynamic arrays)
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
    fn constructor(admin: AztecAddress,config_address: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.config_address.write(config_address);
    }

    #[external("public")]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("utility")]
    unconstrained fn get_admin_utility() -> AztecAddress {
        self.storage.admin.read()
    }

    #[internal("public")]
    fn is_admin() -> bool {
        self.msg_sender().unwrap() == self.storage.admin.read()
    }

    #[internal("public")]
    fn assert_admin() {
        assert(self.internal.is_admin(), "Only admin");
    }

    #[internal("public")]
    fn get_config_address() -> AztecAddress {
        self.storage.config_address.read()
    }

    #[external("public")]
    fn initialize_game_state_arrays() {
        self.internal.assert_admin();
        // Initialize initializedPlanetCountByLevel[0..9] = 0
        for level in 0..10 {
            self.storage.initialized_planet_count_by_level.at(level as u128).write(0);
        }
    }

    #[external("public")]
    fn initialize_world_radius() {
        self.internal.assert_admin();
        self.internal.update_world_radius();
    }

    // ========== LibGameUtils ==========
    /// Noir port of Solidity `LibGameUtils._getPlanetLevelTypeAndSpaceType`.
    /// Returns `(level, planet_type, space_type)` where both planet_type and space_type are u8.
    /// planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
    /// space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
    #[internal("public")]
    fn get_planet_level_type_and_space_type(
        location_id: Field,
        perlin: u8,
    ) -> (u8, u8, u8) {
        let game_config_core: GameConfigCore = self.view(Config::at(self.internal.get_config_address()).get_game_config_core_public());
        let space_type: u8 = space_type_from_perlin(perlin, game_config_core);

        // Solidity: bytes b = abi.encodePacked(uint256(location_id));
        // and then planetLevelUInt = byte[4..=6] interpreted as big-endian.
        let planet_level_uint: u128 = calculate_byte_uint_from_location_id(location_id, 4, 6);

        // Reverse-iterate thresholds (9..0) and pick first where planet_level_uint < threshold[i].
        let thresholds = self.view(Config::at(self.internal.get_config_address()).get_planet_level_thresholds_public()).thresholds;
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
        let max_level: u8 = self.view(Config::at(self.internal.get_config_address()).get_game_config_core_public()).max_natural_planet_level as u8;
        if level > max_level {
            level = max_level;
        }

        // Get weights row for this (space_type, level).
        // space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
        let config_addr = self.internal.get_config_address();
        let tier: PlanetTypeWeightsTier = if space_type == 0 { // Nebula
            self.view(Config::at(config_addr).get_planet_type_weights_tier_public(0))
        } else if space_type == 1 { // Space
            self.view(Config::at(config_addr).get_planet_type_weights_tier_public(1))
        } else if space_type == 2 { // DeepSpace
            self.view(Config::at(config_addr).get_planet_type_weights_tier_public(2))
        } else { // DeadSpace
            self.view(Config::at(config_addr).get_planet_type_weights_tier_public(3))
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
        let world_radius_min: u128 = self.view(Config::at(self.internal.get_config_address()).get_world_config_public()).world_radius_min;
        let initialized_count_level_4: u128 = self.storage.initialized_planet_count_by_level.at(4).read();
        let target4: u128 = initialized_count_level_4 + 20 * n_players;

        let config_addr = self.internal.get_config_address();
        let cumulative_rarity_4 = self.view(Config::at(config_addr).get_cumulative_rarity_public(4));
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
            let space_junk_config: SpaceJunkConfig = self.view(Config::at(self.internal.get_config_address()).get_space_junk_config_public());
            space_junk_config.planet_level_junk[planet.planet_level as u32]
        }
    }

    /// Noir port of Solidity `LibGameUtils._buffPlanet`.
    /// Applies upgrade multipliers to a planet's stats.
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet
    /// - `upgrade`: The upgrade multipliers to apply
    #[internal("public")]
    fn buff_planet(location: Field, upgrade: Upgrade) {
        let mut planet: Planet = self.storage.planets.at(location).read();
        
        planet.population_cap = (planet.population_cap * upgrade.pop_cap_multiplier) / 100;
        planet.population_growth = (planet.population_growth * upgrade.pop_gro_multiplier) / 100;
        planet.range = (planet.range * upgrade.range_multiplier) / 100;
        planet.speed = (planet.speed * upgrade.speed_multiplier) / 100;
        planet.defense = (planet.defense * upgrade.def_multiplier) / 100;
        
        self.storage.planets.at(location).write(planet);
    }

    /// Noir port of Solidity `LibGameUtils._debuffPlanet`.
    /// Removes upgrade multipliers from a planet's stats.
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet
    /// - `upgrade`: The upgrade multipliers to remove
    #[internal("public")]
    fn debuff_planet(location: Field, upgrade: Upgrade) {
        let mut planet: Planet = self.storage.planets.at(location).read();
        
        planet.population_cap = (planet.population_cap * 100) / upgrade.pop_cap_multiplier;
        planet.population_growth = (planet.population_growth * 100) / upgrade.pop_gro_multiplier;
        planet.range = (planet.range * 100) / upgrade.range_multiplier;
        planet.speed = (planet.speed * 100) / upgrade.speed_multiplier;
        planet.defense = (planet.defense * 100) / upgrade.def_multiplier;
        
        self.storage.planets.at(location).write(planet);
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
        let world_config: WorldConfig = self.view(Config::at(self.internal.get_config_address()).get_world_config_public());
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
        let config_addr = self.internal.get_config_address();
        let planet_default_stats: PlanetDefaultStats = self.view(Config::at(config_addr).get_planet_default_stats_public(level as u8));
        let world_config: WorldConfig = self.view(Config::at(config_addr).get_world_config_public());
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
    fn reveal_location_internal(
        location: Field,
        perlin: u8,
        x: Field,
        y: Field,
        check_timestamp: bool,
        timestamp: u64,
    ) {
        let sender = self.msg_sender().unwrap();

        // Check cooldown if requested
        if check_timestamp {
            let player: Player = self.storage.players.at(sender).read();
            let world_config: WorldConfig = self.view(Config::at(self.internal.get_config_address()).get_world_config_public());
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
        perlin: u8,
        is_home_planet: bool,
    ) -> DFPInitPlanetArgs {
        let (level, planet_type, space_type) = self.internal.get_planet_level_type_and_space_type(location, perlin);

        // Validate home planet requirements (matching Solidity behavior)
        if is_home_planet {
            assert(level == 0, "Can only initialize on planet level 0");
            assert(planet_type == 0, "Can only initialize on regular planets"); // PlanetType::Planet = 0
        }

        let time_factor_hundredths: u128 = self.view(Config::at(self.internal.get_config_address()).get_world_config_public()).time_factor_hundredths;

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
    /// - `timestamp`: The current timestamp
    #[internal("public")]
    fn initialize_planet_with_defaults(
        location: Field,
        perlin: u8,
        is_home_planet: bool,
        timestamp: u64,
    ) {
        // Validate location
        let max_location_id: Field = self.view(Config::at(self.internal.get_config_address()).get_game_config_core_public()).max_location_id;
        assert(location_id_valid(location, max_location_id), "Not a valid planet location");

        // Get default initialization arguments
        let init_args = self.internal.get_default_init_planet_args(location, perlin, is_home_planet);

        // Initialize the planet
        self.internal._initialize_planet(init_args, timestamp);

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
    /// - `timestamp`: The current timestamp
    #[internal("public")]
    fn _initialize_planet(args: DFPInitPlanetArgs, timestamp: u64) {
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
        
        // Set timestamps
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
        perlin: u8,
        radius: u128,
        sender: AztecAddress,
    ) -> bool {
        let player: Player = self.storage.players.at(sender).read();
        assert(!player.is_initialized, "Player is already initialized");

        let world_radius: u128 = self.storage.world_radius.read();
        assert(radius <= world_radius, "Init radius is bigger than the current world radius");

        let config_addr = self.internal.get_config_address();
        let game_config: GameConfigCore = self.view(Config::at(config_addr).get_game_config_core_public());
        let world_config: WorldConfig = self.view(Config::at(config_addr).get_world_config_public());

        if world_config.spawn_rim_area != 0 {
            let radius_squared_times_pi: u128 = (radius * radius * 314) / 100;
            let world_radius_squared_times_pi: u128 = (world_radius * world_radius * 314) / 100;
            assert(
                radius_squared_times_pi + world_config.spawn_rim_area >= world_radius_squared_times_pi,
                "Player can only spawn at the universe rim"
            );
        }

        assert(
            (perlin as u128) >= game_config.init_perlin_min,
            "Init not allowed in perlin value less than INIT_PERLIN_MIN"
        );
        assert(
            (perlin as u128) < game_config.init_perlin_max,
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
    /// - `artifacts_to_add`: Array of 12 artifact IDs (Field) that are new on the planet
    #[internal("public")]
    fn get_refreshed_planet(
        location: Field,
        timestamp: u64,
    ) -> (Planet, [u128; 12], [Field; 12]) {
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

        // Split the result: first 12 are event ids to remove, last 12 are artifact ids (Field)
        let mut events_to_remove: [u128; 12] = [0; 12];
        let mut artifacts_to_add: [Field; 12] = [0 as Field; 12];
        for i in 0..12 {
            events_to_remove[i] = event_ids_and_artifacts[i] as u128;
            artifacts_to_add[i] = event_ids_and_artifacts[i + 12];
        }

        // Apply spaceship artifacts
        for i in 0..12 {
            if artifacts_to_add[i] != 0 {
                let artifact: Artifact = self.storage.artifacts.at(artifacts_to_add[i]).read();
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
    fn refresh_planet_internal(location: Field, timestamp: u64) {
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
            let artifact_id: Field = artifact_ids_to_add_to_planet[i];
            if artifact_id != 0 {
                // Set voyage_id to 0 (artifact has arrived)
                self.storage.artifact_id_to_voyage_id.at(artifact_id).write(0);
                // Add artifact to planet
                self.internal.put_artifact_on_planet(artifact_id, location);
            }
        }
    }

    // ========== DFAdminFacet ==========

    // Event definitions
    #[event]
    struct PauseStateChanged {
        paused: bool,
    }

    #[event]
    struct AdminOwnershipChanged {
        loc: Field,
        new_owner: AztecAddress,
    }

    #[event]
    struct AdminPlanetCreated {
        loc: Field,
    }

    /// Noir port of Solidity `DFAdminFacet.pause`.
    /// Pauses the game. Only admin can call this.
    #[external("public")]
    fn pause() {
        self.internal.assert_admin();
        assert(!self.storage.paused.read(), "Game is already paused");
        self.storage.paused.write(true);
        self.emit(PauseStateChanged { paused: true });
    }

    /// Noir port of Solidity `DFAdminFacet.unpause`.
    /// Unpauses the game. Only admin can call this.
    #[external("public")]
    fn unpause() {
        self.internal.assert_admin();
        assert(self.storage.paused.read(), "Game is already unpaused");
        self.storage.paused.write(false);
        self.emit(PauseStateChanged { paused: false });
    }

    /// Noir port of Solidity `DFAdminFacet.setOwner`.
    /// Sets the owner of an initialized planet. Only admin can call this.
    /// Only works for initialized planets.
    #[external("public")]
    fn set_owner(planet_id: Field, new_owner: AztecAddress) {
        self.internal.assert_admin();
        let mut planet: Planet = self.storage.planets.at(planet_id).read();
        assert(planet.is_initialized, "Planet is not initialized");
        planet.owner = new_owner;
        self.storage.planets.at(planet_id).write(planet);
        self.emit(AdminOwnershipChanged { loc: planet_id, new_owner: new_owner });
    }

    /// Noir port of Solidity `DFAdminFacet.deductScore`.
    /// Deducts score from a player. Only admin can call this.
    #[external("public")]
    fn deduct_score(player_address: AztecAddress, amount: u128) {
        self.internal.assert_admin();
        let mut player: Player = self.storage.players.at(player_address).read();
        assert(player.is_initialized, "player does not exist");
        assert(amount <= player.score, "tried to deduct much score");
        player.score -= amount;
        self.storage.players.at(player_address).write(player);
    }

    /// Noir port of Solidity `DFAdminFacet.addScore`.
    /// Adds score to a player. Only admin can call this.
    #[external("public")]
    fn add_score(player_address: AztecAddress, amount: u128) {
        self.internal.assert_admin();
        let mut player: Player = self.storage.players.at(player_address).read();
        assert(player.is_initialized, "player does not exist");
        player.score += amount;
        self.storage.players.at(player_address).write(player);
    }

    /// Noir port of Solidity `DFAdminFacet.changeWorldRadiusMin`.
    /// Changes the minimum world radius constant and updates the world radius.
    #[external("public")]
    fn change_world_radius_min(new_constant: u128) {
        self.internal.assert_admin();
        let config_addr = self.internal.get_config_address();
        let mut world_config: WorldConfig = self.view(Config::at(config_addr).get_world_config_public());
        world_config.world_radius_min = new_constant;
        self.call(Config::at(config_addr).set_world_config(world_config));
        self.internal.update_world_radius();
    }

    /// Noir port of Solidity `DFAdminFacet.adminSetWorldRadius`.
    /// Sets the world radius directly. Only admin can call this.
    #[external("public")]
    fn admin_set_world_radius(new_radius: u128) {
        self.internal.assert_admin();
        self.storage.world_radius.write(new_radius);
    }

    /// Noir port of Solidity `DFAdminFacet.changeLocationRevealCooldown`.
    /// Changes the location reveal cooldown. Only admin can call this.
    #[external("public")]
    fn change_location_reveal_cooldown(new_cooldown: u64) {
        self.internal.assert_admin();
        let config_addr = self.internal.get_config_address();
        let mut world_config: WorldConfig = self.view(Config::at(config_addr).get_world_config_public());
        world_config.location_reveal_cooldown_s = new_cooldown;
        self.call(Config::at(config_addr).set_world_config(world_config));
    }

    /// Noir port of Solidity `DFAdminFacet.setTokenMintEndTime`.
    /// Sets the token mint end timestamp. Only admin can call this.
    #[external("public")]
    fn set_token_mint_end_time(new_token_mint_end_time: u64) {
        self.internal.assert_admin();
        self.storage.token_mint_end_timestamp.write(new_token_mint_end_time);
    }

    /// Noir port of Solidity `DFAdminFacet.createPlanet`.
    /// Creates a planet with the given arguments. Only admin can call this.
    #[external("public")]
    fn create_planet(args: AdminCreatePlanetArgs) {
        self.internal.assert_admin();
        let world_config: WorldConfig = self.view(Config::at(self.internal.get_config_address()).get_world_config_public());
        assert(world_config.admin_can_add_planets, "admin can no longer add planets");
        
        if args.require_valid_location_id {
            let max_location_id: Field = self.view(Config::at(self.internal.get_config_address()).get_game_config_core_public()).max_location_id;
            assert(location_id_valid(args.location, max_location_id), "Not a valid planet location");
        }


        let game_config_core: GameConfigCore = self.view(Config::at(self.internal.get_config_address()).get_game_config_core_public());
        let space_type = space_type_from_perlin(args.perlin, game_config_core);
        let time_factor_hundredths = world_config.time_factor_hundredths;
        
        let init_args = DFPInitPlanetArgs {
            location: args.location,
            perlin: args.perlin,
            level: args.level,
            time_factor_hundredths: time_factor_hundredths,
            space_type: space_type,
            planet_type: args.planet_type,
            is_home_planet: false,
        };
        
        // Get timestamp for initialization
        let timestamp = self.context.timestamp();
        self.internal._initialize_planet(init_args, timestamp);
        
        // Add planet to planet IDs list
        let planet_ids_count = self.storage.planet_ids_count.read();
        self.storage.planet_ids.at(planet_ids_count).write(args.location);
        self.storage.planet_ids_count.write(planet_ids_count + 1);
        
        // Increment initialized planet count for the level
        let level_count = self.storage.initialized_planet_count_by_level.at(args.level as u128).read();
        self.storage.initialized_planet_count_by_level.at(args.level as u128).write(level_count + 1);
        
        self.emit(AdminPlanetCreated { loc: args.location });
    }

    /// Noir port of Solidity `DFAdminFacet.adminInitializePlanet`.
    /// Initializes a planet with defaults. Only admin can call this.
    #[external("public")]
    fn admin_initialize_planet(location_id: Field, perlin: u8) {
        self.internal.assert_admin();
        let planet: Planet = self.storage.planets.at(location_id).read();
        assert(!planet.is_initialized, "planet is already initialized");
        
        // Get timestamp for initialization
        let timestamp = self.context.timestamp();
        self.internal.initialize_planet_with_defaults(location_id, perlin, false, timestamp);
    }

    /// Noir port of Solidity `DFAdminFacet.setPlanetTransferEnabled`.
    /// Sets whether planet transfer is enabled. Only admin can call this.
    #[external("public")]
    fn set_planet_transfer_enabled(enabled: bool) {
        self.internal.assert_admin();
        let config_addr = self.internal.get_config_address();
        let mut world_config: WorldConfig = self.view(Config::at(config_addr).get_world_config_public());
        world_config.planet_transfer_enabled = enabled;
        self.call(Config::at(config_addr).set_world_config(world_config));
    }

    /// Noir port of Solidity `DFAdminFacet.safeSetOwner`.
    /// Sets the owner of a planet, even if it's not initialized.
    /// If the planet is not initialized, it will be initialized first.
    /// After setting owner, sets silver and population to their maximum values.
    /// 
    /// Note: In Noir, we use direct coordinates instead of SNARK proof parameters.
    /// The caller must provide valid coordinates that satisfy the init circuit constraints.
    /// Private function that validates ZK proof and enqueues public state change
    #[external("private")]
    fn safe_set_owner( 
        x: Field, // private 
        y: Field, // private 
        r: u128,
        location_id: Field,
        perlin: u8,
        new_owner: AztecAddress,
        disable_zk_checks: bool,
        planet_hash_key: u128, 
        space_type_key: u128, 
        biomebase_key: u128,
        scale: u128, 
        x_mirror: bool, 
        y_mirror: bool, 
      
    ) {
        if !disable_zk_checks {
            // init_proof takes: r, planet_hash_key, space_type_key, scale, x_mirror, y_mirror, x, y
            // Returns (planet_hash: Field, perlin: u8)
            let (planet_hash, computed_perlin) = init_proof(
                r as Field,
                planet_hash_key as Field,
                space_type_key as Field,
                scale,
                x_mirror,
                y_mirror,
                x,
                y,
            );

            assert(planet_hash == location_id, "Planet hash mismatch");
            assert(computed_perlin == perlin, "Perlin value mismatch");
        }

        // Enqueue the public function call
        self.enqueue_self.pub_safe_set_owner(
            location_id, 
            perlin,
            new_owner,
            disable_zk_checks,
            planet_hash_key,
            space_type_key, 
            biomebase_key,
            scale, 
            x_mirror, 
            y_mirror
        );
    }
 
    /// Public function that updates planet state
    #[external("public")]
    #[only_self]
    fn pub_safe_set_owner(
        planet_id: Field,
        perlin: u8,
        new_owner: AztecAddress,
        disable_zk_checks: bool,
        planethash_key: u128, 
        spacetype_key: u128, 
        biomebase_key: u128,
        perlin_length_scale: u128, 
        perlin_mirror_x: bool, 
        perlin_mirror_y: bool
    ) {
        self.internal.assert_admin();
        assert(disable_zk_checks == self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public()).disable_zk_checks, "disable_zk_checks mismatch");
        
        let planet = self.storage.planets.at(planet_id).read();
        if !planet.is_initialized {
            let snark_constants: SnarkConstants = self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public());
            let _ = revert_if_bad_snark_perlin_flags(
                planethash_key,
                spacetype_key,
                biomebase_key,
                perlin_mirror_x,
                perlin_mirror_y,
                perlin_length_scale,
                false,
                snark_constants
            );      
    
            self.internal.initialize_planet_with_defaults(
                planet_id,
                perlin,
                planet.is_home_planet,
                self.context.timestamp(),
            );
        }        

        // Set silver and population to maximum
        let mut updated_planet: Planet = self.storage.planets.at(planet_id).read();
        updated_planet.silver = updated_planet.silver_cap;
        updated_planet.population = updated_planet.population_cap;
        updated_planet.owner = new_owner;
        
        // Write updated planet
        self.storage.planets.at(planet_id).write(updated_planet);

        // Emit event
        self.emit(AdminOwnershipChanged { loc: planet_id, new_owner: new_owner });
    }

    // ========== DFCoreFacet ==========

    #[event]
    struct LocationRevealed {
        revealer: AztecAddress,
        loc: Field,
        x: Field,
        y: Field,
    }

    #[event]
    struct PlayerInitialized {
        player: AztecAddress,
        loc: Field,
    }

    #[event]
    struct PlanetTransferred {
        from: AztecAddress,
        loc: Field,
        to: AztecAddress,
    }

    #[event]
    struct PlanetSilverWithdrawn {
        player: AztecAddress,
        loc: Field,
        amount: u128,
    }

    #[event]
    struct PlanetUpgraded {
        player: AztecAddress,
        loc: Field,
        branch: u128,
        new_level: u8,
    }

    /// Noir port of Solidity `DFCoreFacet.refreshPlanet`.
    /// Public function to refresh a planet's state.
    /// 
    /// This function requires the game to not be paused.
    /// It updates the planet's state by applying all pending events and resource growth.
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet to refresh
    #[external("public")]
    fn refresh_planet(location: Field) {
        // Check game is not paused (notPaused modifier)
        assert(!self.storage.paused.read(), "Game is paused");
        
        // Get current timestamp and call internal refresh_planet
        let timestamp = self.context.timestamp();
        self.internal.refresh_planet_internal(location, timestamp);
    }

    /// Noir port of Solidity `DFCoreFacet.revealLocation`.
    /// Reveals the coordinates of a planet location.
    /// 
    /// Since x, y are being revealed publicly, no privacy is needed.
    /// The proof verifies that the coordinates hash to the location_id.
    /// 
    /// This function:
    /// 1. Verifies the proof that coordinates match the location hash and perlin
    /// 2. Initializes the planet if not already initialized
    /// 3. Reveals the location coordinates
    /// 4. Emits a LocationRevealed event
    /// 
    /// # Arguments
    /// - `location_id`: The expected planet hash (location ID)
    /// - `perlin`: The expected perlin value
    /// - `x`: The x coordinate to reveal
    /// - `y`: The y coordinate to reveal
    #[external("public")]
    fn reveal_location(
        location_id: Field,
        perlin: u8,
        x: Field,
        y: Field,
    ) {
        // Check game is not paused
        assert(!self.storage.paused.read(), "Game is paused");

        // Verify proof: coordinates hash to location_id and perlin is correct
        let snark_constants: SnarkConstants = self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public());
        if !snark_constants.disable_zk_checks {
            let (computed_hash, computed_perlin) = reveal_proof(
                x,
                y,
                snark_constants.planethash_key as Field,
                snark_constants.spacetype_key as Field,
                snark_constants.perlin_length_scale,
                snark_constants.perlin_mirror_x,
                snark_constants.perlin_mirror_y,
            );
            
            assert(computed_hash == location_id, "Planet hash mismatch");
            assert(computed_perlin == perlin, "Perlin value mismatch");
        }

        // Validate SNARK perlin flags
        let snark_constants: SnarkConstants = self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public());
        let _ = revert_if_bad_snark_perlin_flags(
            snark_constants.planethash_key,
            snark_constants.spacetype_key,
            snark_constants.biomebase_key,
            snark_constants.perlin_mirror_x,
            snark_constants.perlin_mirror_y,
            snark_constants.perlin_length_scale,
            false, // checking_biome = false,
            snark_constants
        );

        // Initialize planet if not already initialized
        let planet = self.storage.planets.at(location_id).read();
        if !planet.is_initialized {
            self.internal.initialize_planet_with_defaults(
                location_id,
                perlin,
                false, // is_home_planet = false
                self.context.timestamp(),
            );
        }

        // Check if sender is admin (for cooldown bypass)
        let sender = self.msg_sender().unwrap();
        let admin = self.storage.admin.read();
        let check_timestamp = sender != admin;

        // Reveal the location
        self.internal.reveal_location_internal(
            location_id,
            perlin,
            x,
            y,
            check_timestamp,
            self.context.timestamp(),
        );

        // Emit event
        self.emit(LocationRevealed {
            revealer: sender,
            loc: location_id,
            x: x,
            y: y,
        });
    } 

    /// Noir port of Solidity `DFCoreFacet.initializePlayer`.
    /// Initializes a new player at their home planet.
    /// 
    /// This is a private function because the player's home planet coordinates (x, y)
    /// must remain secret - only the location hash is revealed publicly.
    /// 
    /// This function:
    /// 1. Verifies the ZK proof that coordinates hash to location_id
    /// 2. Validates player can initialize at this location
    /// 3. Initializes the home planet
    /// 4. Creates player data
    /// 5. Updates world radius
    /// 6. Emits PlayerInitialized event
    /// 
    /// # Arguments
    /// - `location_id`: The planet hash (home planet location)
    /// - `perlin`: The perlin value at the location
    /// - `radius`: The distance from origin (for spawn validation)
    /// - `x`: The x coordinate (private)
    /// - `y`: The y coordinate (private)
    /// - `planet_hash_key`: Key for planet hash calculation
    /// - `space_type_key`: Key for space type perlin
    /// - `scale`: Perlin scale
    /// - `x_mirror`: X mirror flag
    /// - `y_mirror`: Y mirror flag
    #[external("private")]
    fn initialize_player(
        x: Field, // private 
        y: Field, // private
        radius: u128,
        location_id: Field,
        perlin: u8,
        disable_zk_checks : bool,
        planet_hash_key: u128,
        space_type_key: u128,
        scale: u128,
        x_mirror: bool,
        y_mirror: bool,
      
    ) {
        if !disable_zk_checks {
            let (computed_hash, computed_perlin) = init_proof(
                radius as Field,
                planet_hash_key as Field,
                space_type_key as Field,
                scale,
                x_mirror,
                y_mirror,
                x,
                y,
            );
            assert(computed_hash == location_id, "Planet hash mismatch");
            assert(computed_perlin == perlin, "Perlin value mismatch");
        }

        // Enqueue public function
        self.enqueue_self.pub_initialize_player(
            location_id,
            perlin,
            radius,
            disable_zk_checks,
            planet_hash_key,
            space_type_key,
            scale,
            x_mirror,
            y_mirror,
        );
    }

    /// Public function that updates state for player initialization
    #[external("public")]
    #[only_self]
    fn pub_initialize_player(
        location_id: Field,
        perlin: u8,
        radius: u128,
        disable_zk_checks: bool,
        planethash_key: u128,
        spacetype_key: u128,
        perlin_length_scale: u128,
        perlin_mirror_x: bool,
        perlin_mirror_y: bool,
    ) {
        assert(disable_zk_checks == self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public()).disable_zk_checks, "disable_zk_checks mismatch");

        // Validate SNARK perlin flags
        let snark_constants: SnarkConstants = self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public());
        let _ = revert_if_bad_snark_perlin_flags(
            planethash_key,
            spacetype_key,
            snark_constants.biomebase_key,
            perlin_mirror_x,
            perlin_mirror_y,
            perlin_length_scale,
            false, // checking_biome = false
            snark_constants
        );

        // Initialize the home planet
        self.internal.initialize_planet_with_defaults(
            location_id,
            perlin,
            true, // is_home_planet = true
            self.context.timestamp(),
        );

        // Check player init requirements
        let sender = self.msg_sender().unwrap();
        let _ = self.internal.check_player_init(
            location_id,
            perlin,
            radius,
            sender,
        );

        // Initialize player data
        let player_ids_count = self.storage.player_ids_count.read();
        self.storage.player_ids.at(player_ids_count).write(sender);
        self.storage.player_ids_count.write(player_ids_count + 1);

        // Create player struct
        let space_junk_config: SpaceJunkConfig = self.view(Config::at(self.internal.get_config_address()).get_space_junk_config_public());
        let player = Player {
            is_initialized: true,
            player: sender,
            init_timestamp: self.context.timestamp(),
            home_planet_id: location_id,
            last_reveal_timestamp: 0,
            score: 0,
            space_junk: 0,
            space_junk_limit: space_junk_config.space_junk_limit,
            claimed_ships: false,
            final_rank: 0,
            claimed_reward: false,
        };
        self.storage.players.at(sender).write(player);

        // Update world radius
        self.internal.update_world_radius();

        // Emit event
        self.emit(PlayerInitialized {
            player: sender,
            loc: location_id,
        });
    }

    /// Noir port of Solidity `DFCoreFacet.transferPlanet`.
    /// Transfers ownership of a planet to another initialized player.
    ///
    /// This function:
    /// 1. Checks that planet transfer is enabled
    /// 2. Ensures the planet is initialized
    /// 3. Refreshes the planet state
    /// 4. Validates ownership and target player
    /// 5. Transfers ownership and emits a PlanetTransferred event
    ///
    /// # Arguments
    /// - `location`: The location ID of the planet to transfer
    /// - `new_owner`: The address of the player to receive the planet
    #[external("public")]
    fn transfer_planet(location: Field, new_owner: AztecAddress) {
        // Check game is not paused (notPaused modifier)
        assert(!self.storage.paused.read(), "Game is paused");

        // Check that planet transfer is enabled
        let world_config: WorldConfig = self.view(Config::at(self.internal.get_config_address()).get_world_config_public());
        assert(world_config.planet_transfer_enabled, "planet transferring is disabled");

        // Ensure planet is initialized
        let mut planet: Planet = self.storage.planets.at(location).read();
        assert(planet.is_initialized, "Planet is not initialized");

        // Refresh planet state
        let timestamp = self.context.timestamp();
        self.internal.refresh_planet_internal(location, timestamp);

        // Re-read planet after refresh
        planet = self.storage.planets.at(location).read();

        // Ownership check
        let sender = self.msg_sender().unwrap();
        assert(
            planet.owner == sender,
            "Only owner account can perform that operation on planet."
        );

        // Cannot transfer to self
        assert(new_owner != sender, "Cannot transfer planet to self");

        // Target player must be initialized
        let target_player: Player = self.storage.players.at(new_owner).read();
        assert(
            target_player.is_initialized,
            "Can only transfer ownership to initialized players"
        );

        // Planet must not be destroyed
        assert(!planet.destroyed, "can't transfer a destroyed planet");

        // Perform transfer
        planet.owner = new_owner;
        self.storage.planets.at(location).write(planet);

        // Emit event
        self.emit(PlanetTransferred {
            from: sender,
            loc: location,
            to: new_owner,
        });
    }

    /// Noir port of Solidity `DFCoreFacet.withdrawSilver`.
    /// Withdraws silver from a trading post planet and converts it to player score.
    ///
    /// This function:
    /// 1. Refreshes the planet state
    /// 2. Checks ownership and planet type
    /// 3. Ensures sufficient silver is available
    /// 4. Deducts silver and increases player score
    /// 5. Emits PlanetSilverWithdrawn event
    ///
    /// # Arguments
    /// - `location`: The location ID of the planet to withdraw from
    /// - `amount`: The amount of silver to withdraw (contract precision units)
    #[external("public")]
    fn withdraw_silver(location: Field, amount: u128) {
        // Check game is not paused
        assert(!self.storage.paused.read(), "Game is paused");

        // Refresh planet first
        let timestamp = self.context.timestamp();
        self.internal.refresh_planet_internal(location, timestamp);

        // Load planet
        let mut planet: Planet = self.storage.planets.at(location).read();

        // Ownership check
        let sender = self.msg_sender().unwrap();
        assert(planet.owner == sender, "you must own this planet");

        // Planet type must be TradingPost
        // PlanetType::TradingPost = 3
        assert(
            planet.planet_type == 3,
            "can only withdraw silver from trading posts"
        );

        // Planet must not be destroyed
        assert(!planet.destroyed, "planet is destroyed");

        // Sufficient silver check
        assert(
            planet.silver >= amount,
            "tried to withdraw more silver than exists on planet"
        );

        // Deduct silver
        planet.silver -= amount;
        self.storage.planets.at(location).write(planet);

        // Convert silver to score
        // CONTRACT_PRECISION = 1000 (as in Solidity comment)
        let mut score_gained: u128 = amount / 1000;
        let world_config: WorldConfig = self.view(Config::at(self.internal.get_config_address()).get_world_config_public());
        score_gained = (score_gained * world_config.silver_score_value) / 100;

        // Add score to player
        let mut player: Player = self.storage.players.at(sender).read();
        player.score += score_gained;
        self.storage.players.at(sender).write(player);

        // Emit event
        self.emit(PlanetSilverWithdrawn {
            player: sender,
            loc: location,
            amount,
        });
    }

    /// Noir port of Solidity `LibPlanet.upgradePlanet`.
    /// Upgrades a planet along the specified branch, applying buffs and deducting silver.
    /// 
    /// # Arguments
    /// - `location`: The location ID of the planet to upgrade
    /// - `branch`: The upgrade branch (0=Defense, 1=Range, 2=Speed)
    #[internal("public")]
    fn upgrade_planet_internal(location: Field, branch: u128) {
        let sender = self.msg_sender().unwrap();
        let mut planet: Planet = self.storage.planets.at(location).read();

        // Ownership and basic checks
        assert(planet.owner == sender, "Only owner account can perform that operation on planet.");
        assert(planet.planet_level as u128 > 0, "Planet level is not high enough for this upgrade");
        assert(branch < 3, "Upgrade branch not valid");
        // PlanetType::Planet = 0
        assert(planet.planet_type == 0, "Can only upgrade regular planets");
        assert(!planet.destroyed, "planet is destroyed");

        // Total upgrade level limits by space type
        let total_level: u8 =
            planet.upgrade_state_0 + planet.upgrade_state_1 + planet.upgrade_state_2;
        // SpaceType: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
        let nebula: bool = planet.space_type == 0;
        let space: bool = planet.space_type == 1;
        let deep_space: bool = planet.space_type == 2;
        let dead_space: bool = planet.space_type == 3;
        // Noir does not support && / || operators; expand logic with ifs.
        let mut can_upgrade: bool = false;
        if nebula {
            if total_level < 3 {
                can_upgrade = true;
            }
        }
        if space {
            if total_level < 4 {
                can_upgrade = true;
            }
        }
        if deep_space {
            if total_level < 5 {
                can_upgrade = true;
            }
        }
        if dead_space {
            if total_level < 5 {
                can_upgrade = true;
            }
        }
        assert(can_upgrade, "Planet at max total level");

        // Current level for the selected branch
        let mut branch_level: u8 = 0;
        if branch == 0 {
            branch_level = planet.upgrade_state_0;
        } else if branch == 1 {
            branch_level = planet.upgrade_state_1;
        } else {
            // branch == 2 by assertion above
            branch_level = planet.upgrade_state_2;
        }
        assert(branch_level < 4, "Upgrade branch already maxed");

        // Lookup upgrade parameters
        let key: u128 = branch * 10 + branch_level as u128;
        let upgrade: Upgrade = self.view(Config::at(self.internal.get_config_address()).get_upgrade_public(key));

        // Compute and check upgrade cost
        let upgrade_cost: u128 = (planet.silver_cap * 20 * (total_level as u128 + 1)) / 100;
        assert(planet.silver >= upgrade_cost, "Insufficient silver to upgrade");

        // Apply upgrade buffs
        self.internal.buff_planet(location, upgrade);

        // Update planet silver and branch level
        let mut updated_planet: Planet = self.storage.planets.at(location).read();
        updated_planet.silver -= upgrade_cost;
        if branch == 0 {
            updated_planet.upgrade_state_0 += 1;
        } else if branch == 1 {
            updated_planet.upgrade_state_1 += 1;
        } else {
            updated_planet.upgrade_state_2 += 1;
        }
        self.storage.planets.at(location).write(updated_planet);

        // Emit event
        self.emit(PlanetUpgraded {
            player: sender,
            loc: location,
            branch,
            new_level: branch_level + 1,
        });
    }

    /// Noir port of Solidity `DFCoreFacet.upgradePlanet`.
    /// Upgrades a planet along one of three upgrade branches.
    ///
    /// This function:
    /// 1. Refreshes the planet state
    /// 2. Calls internal `upgrade_planet_internal`
    /// 3. Returns the location and branch
    ///
    /// # Arguments
    /// - `location`: The location ID of the planet to upgrade
    /// - `branch`: The upgrade branch (0=Defense, 1=Range, 2=Speed)
    ///
    /// # Returns
    /// - `(location, branch)` for convenience / parity with Solidity
    #[external("public")]
    fn upgrade_planet(location: Field, branch: u128) -> (Field, u128) {
        // Check game is not paused
        assert(!self.storage.paused.read(), "Game is paused");

        // Refresh planet first
        let timestamp = self.context.timestamp();
        self.internal.refresh_planet_internal(location, timestamp);

        // Perform upgrade
        self.internal.upgrade_planet_internal(location, branch);

        (location, branch)
    } 
    
    
    // ========== DFMoveFacet ==========

    #[event]
    struct ArrivalQueued {
        player: AztecAddress,
        arrival_id: u128,
        from: Field,
        to: Field,
        artifact_id: Field,
        abandoning: u128,
    }

    /// Noir port of Solidity `DFMoveFacet._getDecayedPop`.
    /// Calculates linearly-decayed population based purely on distance and range,
    /// without applying the original "big planet debuff".
    #[internal("public")]
    fn get_decayed_pop(
        pop_moved: u128,
        dist_times_hundred: u128,
        range: u128,
        population_cap: u128,
    ) -> u128 {
        // Linear decay:
        // - effective_dist = min(dist_times_hundred, range * 100)
        // - decay factor = 1 - effective_dist / (range * 100)
        // - pop_arriving = pop_moved * decay factor

        let range_times_hundred: u128 = range * 100;

        // Clamp distance to [0, range * 100]
        let mut effective_dist: u128 = dist_times_hundred;
        if effective_dist > range_times_hundred {
            effective_dist = range_times_hundred;
        }

        // Linear decay fraction: (range*100 - effective_dist) / (range*100)
        let remaining_num: u128 = range_times_hundred - effective_dist;
        let pop_arriving: u128 = (pop_moved * remaining_num) / range_times_hundred;

        pop_arriving
    }

    /// Noir port of Solidity `DFMoveFacet._isSpaceshipMove`.
    /// Checks if the move is a spaceship move.
    #[internal("public")]
    fn is_spaceship_move(args: DFPMoveArgs) -> bool {
        self.internal.is_spaceship_artifact(args.moved_artifact_id)
    }

    /// Helper: checks if an artifact (by id) is a spaceship type.
    #[internal("public")]
    fn is_spaceship_artifact(moved_artifact_id: Field) -> bool {
        if moved_artifact_id == 0 {
            false
        } else {
            let artifact = self.storage.artifacts.at(moved_artifact_id).read();
            // ArtifactType::Spaceship = 12, ShipMothership = 9, ShipCrescent = 10, ShipWhale = 11, ShipGear = 12, ShipTitan = 13
            let mut inner = false;
            if artifact.artifact_type >= 9 {
                if artifact.artifact_type <= 13 {
                    inner = true;
                }
            }
            inner
        }
    }

         /// Helper to remove artifact from a planet.
    /// Inverse of put_artifact_on_planet.
    #[internal("public")]
    fn take_artifact_off_planet(artifact_id: Field, location_id: Field) {
        let artifacts_count = self.storage.planet_artifacts_count.at(location_id).read();
        
        // Find and remove artifact
        let mut found_index: u128 = artifacts_count;
        for i in 0..artifacts_count {
            let stored_id = self.storage.planet_artifacts.at(location_id).at(i).read();
            if stored_id == artifact_id {
                found_index = i;
            }
        }
        
        if found_index < artifacts_count {
            // Swap with last element
            let last_index = artifacts_count - 1;
            if found_index < last_index {
                let last_id = self.storage.planet_artifacts.at(location_id).at(last_index).read();
                self.storage.planet_artifacts.at(location_id).at(found_index).write(last_id);
            }
            // Decrement count
            self.storage.planet_artifacts_count.at(location_id).write(artifacts_count - 1);
        }
        
        // Clear artifact_id -> planet_id mapping
        self.storage.artifact_id_to_planet_id.at(artifact_id).write(0 as Field);
    }
   
    /// Noir port of Solidity `DFMoveFacet._createArrival`.
    /// Creates arrival data and handles artifact movement.
    #[internal("public")]
    fn create_arrival_internal(args: DFPCreateArrivalArgs, timestamp: u64) {
        let origin_planet = self.storage.planets.at(args.old_loc).read();

        // Calculate decayed population
        let pop_arriving = self.internal.get_decayed_pop(
            args.pop_moved,
            args.effective_dist_times_hundred,
            origin_planet.range,
            origin_planet.population_cap,
        );

        // Check if spaceship move
        let is_spaceship = self.internal.is_spaceship_artifact(args.moved_artifact_id);

        // Not enough forces: need pop_arriving > 0 OR is_spaceship (Noir has no ||)
        let has_forces = if pop_arriving > 0 {
            true
        } else {
            if is_spaceship {
                true
            } else {
                false
            }
        };
        assert(has_forces, "Not enough forces to make move");

        // Spaceship moves must move 0 energy (Noir has no ternary ?:)
        if is_spaceship {
            assert(args.pop_moved == 0, "spaceship moves must be 0 energy moves");
        }

        let arrival_id = self.storage.planet_events_count.read();

        // Create arrival data
        let arrival_data = ArrivalData {
            id: arrival_id,
            player: args.player,
            from_planet: args.old_loc,
            to_planet: args.new_loc,
            pop_arriving,
            silver_moved: args.silver_moved,
            departure_time: timestamp,
            arrival_time: timestamp + args.travel_time,
            arrival_type: args.arrival_type,
            carried_artifact_id: args.moved_artifact_id,
            distance: args.actual_dist,
        };
        self.storage.planet_arrivals.at(arrival_id).write(arrival_data);

        // Handle artifact movement
        if args.moved_artifact_id != 0 {
            self.internal.take_artifact_off_planet(args.moved_artifact_id, args.old_loc);
            self.storage.artifact_id_to_voyage_id.at(args.moved_artifact_id).write(arrival_id);
        }
    }

    /// Noir port of Solidity `DFMoveFacet._transferPlanetSpaceJunkToPlayer`.
    /// Transfers space junk from destination planet to player.
    #[internal("public")]
    fn transfer_planet_space_junk_to_player(args: DFPMoveArgs) {
        let dest_planet = self.storage.planets.at(args.new_loc).read();
        let mut player = self.storage.players.at(args.sender).read();
        
        assert(
            player.space_junk + dest_planet.space_junk <= player.space_junk_limit,
            "Tried to take on more space junk than your limit"
        );
        
        if dest_planet.space_junk != 0 {
            player.space_junk += dest_planet.space_junk;
            self.storage.players.at(args.sender).write(player);
            
            let mut updated_dest_planet = dest_planet;
            updated_dest_planet.space_junk = 0;
            self.storage.planets.at(args.new_loc).write(updated_dest_planet);
        }
    }

    /// Noir port of Solidity `DFMoveFacet._abandonPlanet`.
    /// Handles abandoning a planet logic.
    #[internal("public")]
    fn abandon_planet(args: DFPMoveArgs, timestamp: u64) -> (u128, u128, u128, Upgrade) {
        // Check no incoming voyages
        let events_count = self.storage.planet_events_count_by_location.at(args.old_loc).read();
        assert(events_count == 0, "Cannot abandon a planet that has incoming voyages.");
        
        let origin_planet = self.storage.planets.at(args.old_loc).read();
        assert(!origin_planet.is_home_planet, "Cannot abandon home planet");
        
        // Always send full energy and silver
        let pop_moved = origin_planet.population;
        let silver_moved = origin_planet.silver;
        
        // Get default planet to compute remaining population (double pirates)
        let default_planet = self.internal.default_planet(
            args.old_loc,
            origin_planet.planet_level as u128,
            origin_planet.planet_type,
            origin_planet.space_type,
        );
        let remaining_origin_planet_population = default_planet.population * 2;
        
        // Abandoning upgrade (range/speed boost)
        let temporary_upgrade = Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 150,
            speed_multiplier: 150,
            def_multiplier: 100,
        };
        
        // Transfer space junk
        let planet_space_junk = self.internal.get_planet_default_space_junk(origin_planet);
        let mut final_space_junk = planet_space_junk;
        if is_half_space_junk(args.old_loc) {
            final_space_junk = final_space_junk / 2;
        }
        
        let mut player = self.storage.players.at(args.sender).read();
        if final_space_junk >= player.space_junk {
            player.space_junk = 0;
        } else {
            player.space_junk -= final_space_junk;
        }
        self.storage.players.at(args.sender).write(player);
        
        // Update planet
        let mut updated_planet = origin_planet;
        updated_planet.space_junk = final_space_junk;
        updated_planet.owner = AztecAddress::zero();
        self.storage.planets.at(args.old_loc).write(updated_planet);
        
        (pop_moved, silver_moved, remaining_origin_planet_population, temporary_upgrade)
    }


      /// Noir port of Solidity `DFMoveFacet._checkPhotoid`.
    /// Checks if a photoid cannon is active and returns temporary upgrade.
    #[internal("public")]
    fn check_photoid(args: DFPMoveArgs, timestamp: u64) -> (bool, Upgrade) {
        let default_upgrade = Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: 100,
        };

        let mut found: bool = false;
        let mut result_upgrade: Upgrade = default_upgrade;

        // Get active artifact from origin planet
        let artifacts_count = self.storage.planet_artifacts_count.at(args.old_loc).read();
        let mut i: u128 = 0;
        while i < artifacts_count {
            if !found {
                let artifact_id = self.storage.planet_artifacts.at(args.old_loc).at(i).read();
                let artifact = self.storage.artifacts.at(artifact_id).read();
                // ArtifactType::PhotoidCannon = 16 (Noir has no &&, use nested if)
                if artifact.is_initialized {
                    if artifact.artifact_type == 16 {
                        let artifacts_config: ArtifactsConfig = self.view(Config::at(self.internal.get_config_address()).get_artifacts_config_public());
                        let activation_delay: u128 = artifacts_config.photoid_activation_delay_s;
                        // timestamp and last_activated are u64; activation_delay is u128 - cast for comparison
                        let lhs: u128 = timestamp as u128;
                        let rhs: u128 = (artifact.last_activated as u128) + activation_delay;
                        if lhs >= rhs {
                            // Deactivate artifact (simplified - set last_deactivated)
                            let mut updated_artifact = artifact;
                            updated_artifact.last_deactivated = timestamp;
                            self.storage.artifacts.at(artifact_id).write(updated_artifact);

                            // PhotoidCannon upgrades: range = [100, 200, 200, 200, 200, 200], speed = [100, 500, 1000, 1500, 2000, 2500]
                            let range_boosts: [u128; 6] = [100, 200, 200, 200, 200, 200];
                            let speed_boosts: [u128; 6] = [100, 500, 1000, 1500, 2000, 2500];
                            let rarity_idx: u32 = artifact.rarity as u32;
                            let range_mult: u128 = if rarity_idx < 6 { range_boosts[rarity_idx] } else { 100 };
                            let speed_mult: u128 = if rarity_idx < 6 { speed_boosts[rarity_idx] } else { 100 };

                            result_upgrade = Upgrade {
                                pop_cap_multiplier: 100,
                                pop_gro_multiplier: 100,
                                range_multiplier: range_mult,
                                speed_multiplier: speed_mult,
                                def_multiplier: 100,
                            };
                            found = true;
                        }
                    }
                }
            }
            i += 1;
        }

        (found, result_upgrade)
    }

    /// Noir port of Solidity `DFMoveFacet._checkWormhole`.
    /// Checks if a wormhole is present and returns distance modifier.
    #[internal("public")]
    fn check_wormhole(args: DFPMoveArgs) -> (bool, u128) {
        let mut relevant_wormhole: Artifact = Artifact {
            is_initialized: false,
            id: 0,
            planet_discovered_on: 0 as Field,
            rarity: 0,
            planet_biome: 0,
            minted_at_timestamp: 0,
            discoverer: AztecAddress::zero(),
            artifact_type: 0,
            activations: 0,
            last_activated: 0,
            last_deactivated: 0,
            wormhole_to: 0 as Field,
            controller: AztecAddress::zero(),
        };

        let artifacts_count_old = self.storage.planet_artifacts_count.at(args.old_loc).read();
        let artifacts_count_new = self.storage.planet_artifacts_count.at(args.new_loc).read();

        // Check origin planet artifacts for wormhole (Noir has no &&, use nested if)
        let mut i: u128 = 0;
        while i < artifacts_count_old {
            let artifact_id = self.storage.planet_artifacts.at(args.old_loc).at(i).read();
            let artifact = self.storage.artifacts.at(artifact_id).read();
            if artifact.is_initialized {
                if artifact.artifact_type == 14 {
                    if artifact.wormhole_to == args.new_loc {
                        relevant_wormhole = artifact;
                    }
                }
            }
            i += 1;
        }

        // Check destination planet artifacts for wormhole if none found on origin
        let found_on_origin: bool = relevant_wormhole.is_initialized;
        if !found_on_origin {
            let mut j: u128 = 0;
            while j < artifacts_count_new {
                let artifact_id = self.storage.planet_artifacts.at(args.new_loc).at(j).read();
                let artifact = self.storage.artifacts.at(artifact_id).read();
                if artifact.is_initialized {
                    if artifact.artifact_type == 14 {
                        if artifact.wormhole_to == args.old_loc {
                            relevant_wormhole = artifact;
                        }
                    }
                }
                j += 1;
            }
        }

        // Compute result (Noir has no return, use expression at end)
        let mut found: bool = false;
        let mut dist_modifier: u128 = 1;
        if relevant_wormhole.is_initialized {
            let speed_boosts: [u128; 6] = [1, 2, 4, 8, 16, 32];
            let rarity_idx: u32 = relevant_wormhole.rarity as u32;
            if rarity_idx < 6 {
                found = true;
                dist_modifier = speed_boosts[rarity_idx];
            }
        }

        (found, dist_modifier)
    }

    /// Noir port of Solidity `DFMoveFacet._removeSpaceshipEffectsFromOriginPlanet`.
    /// Removes spaceship effects from the origin planet.
    #[internal("public")]
    fn remove_spaceship_effects_from_origin_planet(args: DFPMoveArgs, timestamp: u64) {
        if args.moved_artifact_id != 0 {
            let moved_artifact = self.storage.artifacts.at(args.moved_artifact_id).read();
            let origin_planet = self.storage.planets.at(args.old_loc).read();
            let updated_planet = self.internal.apply_spaceship_depart(moved_artifact, origin_planet, timestamp);
            self.storage.planets.at(args.old_loc).write(updated_planet);
        }
    }

    /// Noir port of Solidity `DFMoveFacet.applySpaceshipDepart`.
    /// Removes spaceship effects from a planet when the ship departs.
    #[internal("public")]
    fn apply_spaceship_depart(artifact: Artifact, planet: Planet, timestamp: u64) -> Planet {
        let mut planet = planet;
        // Noir has no early return - use nested if to skip logic when is_home_planet
        if !planet.is_home_planet {
            // ArtifactType::ShipMothership = 9
            if artifact.artifact_type == 9 {
                if planet.energy_gro_doublers == 1 {
                    planet.energy_gro_doublers -= 1;
                    planet.population_growth = planet.population_growth / 2;
                } else if planet.energy_gro_doublers > 1 {
                    planet.energy_gro_doublers -= 1;
                }
            } else if artifact.artifact_type == 11 {
                // ArtifactType::ShipWhale = 11
                if planet.silver_gro_doublers == 1 {
                    planet.silver_gro_doublers -= 1;
                    planet.silver_growth = planet.silver_growth / 2;
                } else if planet.silver_gro_doublers > 1 {
                    planet.silver_gro_doublers -= 1;
                }
            } else if artifact.artifact_type == 13 {
                // ArtifactType::ShipTitan = 13
                planet.last_updated = timestamp;
                planet.pausers -= 1;
            }
        }

        planet
    }


        /// Noir port of Solidity `DFMoveFacet._checkMoveValidity`.
    /// Validates that a move is legal.
    #[internal("public")]
    fn check_move_validity(args: DFPMoveArgs) {
        if self.internal.is_spaceship_move(args) {
            assert(args.pop_moved == 0, "ship moves must move 0 energy");
            assert(args.silver_moved == 0, "ship moves must move 0 silver");
            let artifact = self.storage.artifacts.at(args.moved_artifact_id).read();
            assert(artifact.controller == args.sender, "you can only move your own ships");
        } else {
            let origin_planet = self.storage.planets.at(args.old_loc).read();
            assert(
                origin_planet.population > args.pop_moved,
                "Tried to move more population that what exists"
            );
            let dest_planet = self.storage.planets.at(args.new_loc).read();
            // Noir has no && - use separate asserts
            assert(!dest_planet.destroyed, "planet is destroyed");
            assert(!origin_planet.destroyed, "planet is destroyed");
            assert(
                origin_planet.owner == args.sender,
                "Only owner account can perform that operation on planet."
            );
        }

        let origin_planet = self.storage.planets.at(args.old_loc).read();
        assert(
            origin_planet.silver >= args.silver_moved,
            "Tried to move more silver than what exists"
        );

        if args.moved_artifact_id != 0 {
            let artifacts_count = self.storage.planet_artifacts_count.at(args.new_loc).read();
            assert(artifacts_count < 5, "too many artifacts on this planet");
        }
    }



    /// Noir port of Solidity `DFMoveFacet._executeMove`.
    /// Executes the move logic including validation, artifact handling, and arrival creation.
    #[internal("public")]
    fn execute_move_internal(args: DFPMoveArgs, new_perlin: u8, timestamp: u64) {
        // Check move validity
        self.internal.check_move_validity(args);
        
        let mut effective_dist_times_hundred: u128 = args.max_dist * 100;
        let mut arrival_type: u8 = 1; // ArrivalType::Normal = 1
        let mut temporary_upgrade = Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: 100,
        };
        
        // Check for wormhole
        let (wormhole_present, dist_modifier) = self.internal.check_wormhole(args);
        if wormhole_present {
            effective_dist_times_hundred = effective_dist_times_hundred / dist_modifier;
            arrival_type = 3; // ArrivalType::Wormhole = 3
        }
        
        // Check for photoid (only for non-spaceship moves)
        if !self.internal.is_spaceship_move(args) {
            let (photoid_present, new_temp_upgrade) = self.internal.check_photoid(args, timestamp);
            if photoid_present {
                temporary_upgrade = new_temp_upgrade;
                arrival_type = 2; // ArrivalType::Photoid = 2
            }
        }
        
        // Remove spaceship effects from origin planet
        self.internal.remove_spaceship_effects_from_origin_planet(args, timestamp);
        
        let mut pop_moved: u128 = args.pop_moved;
        let mut silver_moved: u128 = args.silver_moved;

        let origin_planet = self.storage.planets.at(args.old_loc).read();
        let mut remaining_origin_planet_population: u128 = origin_planet.population - pop_moved;
        
        // Handle space junk and abandoning (Noir has no &&, use nested if)
        let space_junk_config: SpaceJunkConfig = self.view(Config::at(self.internal.get_config_address()).get_space_junk_config_public());
        if space_junk_config.space_junk_enabled {
            if !self.internal.is_spaceship_move(args) {
                if args.abandoning != 0 {
                    let (new_pop_moved, new_silver_moved, new_remaining, abandon_upgrade) =
                        self.internal.abandon_planet(args, timestamp);
                    pop_moved = new_pop_moved;
                    silver_moved = new_silver_moved;
                    remaining_origin_planet_population = new_remaining;
                    temporary_upgrade = abandon_upgrade;
                }

                self.internal.transfer_planet_space_junk_to_player(args);
            }
        }
        
        // Apply temporary upgrade buff
        self.internal.buff_planet(args.old_loc, temporary_upgrade);
        
        // Calculate travel time
        let planet_after_buff = self.storage.planets.at(args.old_loc).read();
        let mut travel_time: u64 = (effective_dist_times_hundred / planet_after_buff.speed) as u64;
        
        // Don't allow 0 second voyages
        if travel_time == 0 {
            travel_time = 1;
        }
        
        // Get events count for this arrival
        let arrival_id = self.storage.planet_events_count.read();
        
        // Add arrival event to destination planet
        let events_count = self.storage.planet_events_count_by_location.at(args.new_loc).read();
        let event_metadata = PlanetEventMetadata {
            id: arrival_id,
            event_type: 0, // PlanetEventType::Arrival = 0
            time_trigger: timestamp + travel_time,
            time_created: timestamp,
        };
        self.storage.planet_events.at(args.new_loc).at(events_count).write(event_metadata);
        self.storage.planet_events_count_by_location.at(args.new_loc).write(events_count + 1);
        
        // Create arrival data
        let create_args = DFPCreateArrivalArgs {
            player: args.sender,
            old_loc: args.old_loc,
            new_loc: args.new_loc,
            actual_dist: args.max_dist,
            effective_dist_times_hundred,
            pop_moved,
            silver_moved,
            travel_time,
            moved_artifact_id: args.moved_artifact_id,
            arrival_type,
        };
        self.internal.create_arrival_internal(create_args, timestamp);
        
        // Remove temporary upgrade debuff
        self.internal.debuff_planet(args.old_loc, temporary_upgrade);
        
        // Update origin planet silver and population
        let mut origin_planet = self.storage.planets.at(args.old_loc).read();
        origin_planet.silver -= silver_moved;
        origin_planet.population = remaining_origin_planet_population;
        self.storage.planets.at(args.old_loc).write(origin_planet);
    }


    /// Noir port of Solidity `DFMoveFacet.move`.
    /// Private function that verifies ZK proof for a move.
    /// 
    /// This function:
    /// 1. Verifies the move ZK proof using move_proof circuit
    /// 2. Validates SNARK perlin flags
    /// 3. Enqueues the public move function
    /// 
    /// # Arguments
    /// - `old_loc`: Expected source planet location ID
    /// - `new_loc`: Expected destination planet location ID  
    /// - `new_perlin`: Expected perlin value at destination
    /// - `new_radius`: Radius of destination from origin
    /// - `max_dist`: Maximum distance allowed
    /// - `x1`, `y1`: Source planet coordinates (private)
    /// - `x2`, `y2`: Destination planet coordinates (private)
    /// - `pop_moved`: Population to move
    /// - `silver_moved`: Silver to move
    /// - `moved_artifact_id`: Artifact ID being moved (0 if none)
    /// - `is_abandoning`: Whether abandoning the planet (0 or 1)
    /// - `planet_hash_key`: Planet hash key for proof
    /// - `space_type_key`: Space type key for proof
    /// - `scale`: Perlin scale
    /// - `x_mirror`: X mirror flag
    /// - `y_mirror`: Y mirror flag
    #[external("private")]
    fn move(
        old_loc: Field,
        new_loc: Field,
        new_perlin: u8,
        new_radius: u128,
        max_dist: u128,
        x1: Field,
        y1: Field,
        x2: Field,
        y2: Field,
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        is_abandoning: u128,
        disable_zk_checks: bool,
        planet_hash_key: u128,
        space_type_key: u128,
        biomebase_key: u128,
        scale: u128,
        x_mirror: bool,
        y_mirror: bool,
    ) {
        
        if !disable_zk_checks {
            // Private context cannot read PublicMutable (snark_constants) or call internal("public") functions.
            // Always verify ZK proof here; snark perlin flag validation is done in pub_move.
            let r = new_radius as Field;
            let dist_max = max_dist as Field;
            let (computed_old_loc, computed_new_loc, computed_perlin) = move_proof(
                r,
                dist_max,
                planet_hash_key as Field,
                space_type_key as Field,
                scale,
                x_mirror,
                y_mirror,
                x1,
                y1,
                x2,
                y2,
            );
        
            assert(computed_old_loc == old_loc, "Source planet hash mismatch");
            assert(computed_new_loc == new_loc, "Destination planet hash mismatch");
            assert(computed_perlin == new_perlin, "Perlin value mismatch");
        }

        // Enqueue public function
        self.enqueue_self.pub_move(
            old_loc,
            new_loc,
            new_perlin,
            new_radius,
            max_dist,
            pop_moved,
            silver_moved,
            moved_artifact_id,
            is_abandoning,
            disable_zk_checks,
        );
    }

    /// Public function that executes the move and updates state.
    /// 
    /// This function:
    /// 1. Checks game is not paused
    /// 2. Validates radius bounds
    /// 3. Refreshes origin planet
    /// 4. Initializes or refreshes destination planet
    /// 5. Executes the move logic
    /// 6. Updates world radius
    /// 7. Emits ArrivalQueued event
    /// 
    /// # Arguments
    /// - `old_loc`: Source planet location ID
    /// - `new_loc`: Destination planet location ID
    /// - `new_perlin`: Perlin value at destination
    /// - `new_radius`: Radius of destination from origin
    /// - `max_dist`: Maximum distance allowed
    /// - `pop_moved`: Population to move
    /// - `silver_moved`: Silver to move
    /// - `moved_artifact_id`: Artifact ID being moved (0 if none)
    /// - `is_abandoning`: Whether abandoning the planet (0 or 1)
    /// 
    /// # Returns
    /// The arrival event ID
    #[external("public")]
    #[only_self]
    fn pub_move(
        old_loc: Field,
        new_loc: Field,
        new_perlin: u8,
        new_radius: u128,
        max_dist: u128,
        pop_moved: u128,
        silver_moved: u128,
        moved_artifact_id: Field,
        is_abandoning: u128,
        disable_zk_checks: bool,
    ) -> u128 {
        // Check game is not paused
        assert(!self.storage.paused.read(), "Game is paused");

        assert(disable_zk_checks == self.view(Config::at(self.internal.get_config_address()).get_snark_constants_public()).disable_zk_checks, "disable_zk_checks mismatch");
        
        // Check radius bounds
        let world_radius = self.storage.world_radius.read();
        assert(new_radius <= world_radius, "Attempting to move out of bounds");
        
        // Get sender
        let sender = self.msg_sender().unwrap();
        
        // Build move args (DFPMoveArgs.moved_artifact_id is Field)
        let args = DFPMoveArgs {
            old_loc,
            new_loc,
            max_dist,
            pop_moved,
            silver_moved,
            moved_artifact_id: moved_artifact_id,
            abandoning: is_abandoning,
            sender,
        };

        // Refresh origin planet first
        let timestamp = self.context.timestamp();
        self.internal.refresh_planet_internal(old_loc, timestamp);
        
        // Increment planet events count
        let events_count = self.storage.planet_events_count.read();
        self.storage.planet_events_count.write(events_count + 1);
        
        // Initialize or refresh destination planet
        let dest_planet = self.storage.planets.at(new_loc).read();
        if !dest_planet.is_initialized {
            self.internal.initialize_planet_with_defaults(new_loc, new_perlin, false, timestamp);
        } else {
            self.internal.refresh_planet_internal(new_loc, timestamp);
            self.internal.check_planet_dos(new_loc, sender);
        }
        
        // Execute move
        self.internal.execute_move_internal(args, new_perlin, timestamp);
        
        // Update world radius
        self.internal.update_world_radius();
        
        // Get final events count for event emission
        let arrival_id = self.storage.planet_events_count.read();
        
        // Emit event (ArrivalQueued.artifact_id is Field)
        self.emit(ArrivalQueued {
            player: sender,
            arrival_id,
            from: old_loc,
            to: new_loc,
            artifact_id: moved_artifact_id,
            abandoning: is_abandoning,
        });
        
        arrival_id
    }

}