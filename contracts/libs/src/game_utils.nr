use ::types::args::{AdminCreatePlanetArgs, DFPCreateArrivalArgs, DFPInitPlanetArgs, DFPMoveArgs};

use ::types::config::{
    artifacts::ArtifactsConfig,
    capture_zones::CaptureZonesConfig,
    default_stats::PlanetDefaultStats,
    game::{GameConfigCore, PlanetLevelThresholds, PlanetTypeWeightsTier},
    snark::SnarkConfig,
    space_junk::SpaceJunkConfig,
    spaceships::SpaceshipsConfig,
    upgrade::Upgrade,
    world::WorldConfig,
};

use ::types::storage::{
    arrival::{Arrival, ArrivalType},
    artifact::{Artifact, ArtifactLocation, ArtifactRarity, ArtifactType},
    planet::{
        Biome, Planet, PlanetArtifacts, PlanetEventMetadata, PlanetEvents, PlanetEventType,
        PlanetType, SpaceType, UpgradeBranch,
    },
    player::Player,
    world::World,
};

use ::aztec::protocol::address::AztecAddress;

// Game utility functions that don't require storage access
// Pure computation functions extracted from LibGameUtils

/// Noir port of Solidity `LibPlanet._calculateByteUInt`.
/// Extract a big-endian integer from the byte slice of `location_id`.
///
/// Matches Solidity `bytes memory b = abi.encodePacked(uint256(location_id));`:
/// - 32-byte big-endian, left-padded with zeros.
///
/// Note: Returns `u128`, so `end_byte - start_byte` must be < 16.
pub fn calculate_byte_uint_from_location_id(
    location_id: Field,
    start_byte: u32,
    end_byte: u32,
) -> u128 {
    assert(start_byte <= end_byte, "start_byte must be <= end_byte");
    assert(end_byte < 32, "end_byte out of bounds (expected < 32)");
    assert(end_byte - start_byte < 16, "byte range must fit in u128");

    // Convert Field to 32-byte big-endian array (matches Solidity abi.encodePacked)
    let bytes: [u8; 32] = location_id.to_be_bytes();

    // Extract the requested byte range as big-endian integer
    let mut acc: u128 = 0;
    for i in start_byte..=end_byte {
        acc = acc * 256 + (bytes[i] as u128);
    }
    acc
}

/// Noir port of Solidity `LibGameUtils._locationIdValid`.
pub fn location_id_valid(loc: Field, max_location_id: Field) -> bool {
    loc.lt(max_location_id)
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
pub fn revert_if_bad_snark_perlin_flags(
    provided_snark_config: SnarkConfig,
    expected_snark_config: SnarkConfig,
) {
    assert(
        provided_snark_config.planethash_key == expected_snark_config.planethash_key,
        "bad planethash key",
    );

    assert(
        provided_snark_config.spacetype_key == expected_snark_config.spacetype_key,
        "bad spacetype key",
    );

    assert(
        provided_snark_config.biomebase_key == expected_snark_config.biomebase_key,
        "bad biomebase key",
    );

    assert(
        provided_snark_config.perlin_length_scale == expected_snark_config.perlin_length_scale,
        "bad perlin length scale",
    );
    assert(
        provided_snark_config.perlin_mirror_x == expected_snark_config.perlin_mirror_x,
        "bad perlin mirror x",
    );
    assert(
        provided_snark_config.perlin_mirror_y == expected_snark_config.perlin_mirror_y,
        "bad perlin mirror y",
    );
}

/// Noir port of Solidity `LibGameUtils.spaceTypeFromPerlin`.
/// Returns SpaceType as u8 (0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace).
/// `perlin` here is a u8 value in [0, 255].
pub fn space_type_from_perlin(perlin: u8, game_config_core: GameConfigCore) -> u8 {
    if perlin >= game_config_core.perlin_threshold_3 {
        SpaceType::DeadSpace()
    } else if perlin >= game_config_core.perlin_threshold_2 {
        SpaceType::DeepSpace()
    } else if perlin >= game_config_core.perlin_threshold_1 {
        SpaceType::Space()
    } else {
        SpaceType::Nebula()
    }
}

/// Noir port of Solidity `LibGameUtils._getPlanetLevelTypeAndSpaceType`.
/// Returns `(level, planet_type, space_type)` where both planet_type and space_type are u8.
/// planet_type: 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
/// space_type: 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
pub fn get_planet_level_type_and_space_type(
    location_id: Field,
    perlin: u8,
    game_config_core: GameConfigCore,
    planet_level_thresholds: PlanetLevelThresholds,
    planet_type_weights_tier_0: PlanetTypeWeightsTier,
    planet_type_weights_tier_1: PlanetTypeWeightsTier,
    planet_type_weights_tier_2: PlanetTypeWeightsTier,
    planet_type_weights_tier_3: PlanetTypeWeightsTier,
) -> (u8, u8, u8) {
    let space_type: u8 = space_type_from_perlin(perlin, game_config_core);
    let planet_level_uint: u128 = calculate_byte_uint_from_location_id(location_id, 4, 6);
    let mut level: u8 = 0;
    let mut found_level: bool = false;
    for j in 0..10 {
        let idx: u32 = 9 - j; // 9..0
        if !found_level {
            if planet_level_uint < planet_level_thresholds.thresholds[idx] {
                level = idx as u8;
                found_level = true;
            }
        }
    }
    assert(found_level, "level not found");

    if space_type == 0 {
        // Nebula
        if level > 4 {
            level = 4;
        }
    }
    if space_type == 1 {
        // Space
        if level > 5 {
            level = 5;
        }
    }

    let max_level: u8 = game_config_core.max_natural_planet_level as u8;
    if level > max_level {
        level = max_level;
    }

    let tier: PlanetTypeWeightsTier = if space_type == 0 {
        // Nebula
        planet_type_weights_tier_0
    } else if space_type == 1 {
        // Space
        planet_type_weights_tier_1
    } else if space_type == 2 {
        // DeepSpace
        planet_type_weights_tier_2
    } else {
        // DeadSpace
        planet_type_weights_tier_3
    };

    let level_idx: u32 = level as u32;
    let weights: [u128; 5] = tier.weights[level_idx];
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
/// todo: implement this
pub fn _get_radius(world_config: WorldConfig) -> u128 {
    world_config.world_radius_min
}

/// Noir port of Solidity `LibGameUtils._randomArtifactTypeAndLevelBonus`.
/// todo: implement this
pub fn _random_artifact_type_and_level_bonus(
    artifact_seed: Field,
    biome: u8,
    space_type: u8,
) -> (u8, u8) {
    let artifact_type: u8 = 0;
    let level_bonus: u8 = 0;
    (artifact_type, level_bonus)
}

/// Noir port of Solidity `LibGameUtils._getBiome`.
/// Returns the biome based on the space type and biomebase.
/// biome: 0=Corrupted, 1=Forest, 2=Swamp, 3=Desert, 4=Tundra, 5=Volcanic, 6=Glacier, 7=Ocean, 8=Void
pub fn _get_biome(space_type: u8, biomebase: u8, game_config_core: GameConfigCore) -> u8 {
    if space_type == 3 {
        0
    } else {
        let mut biome: u8 = 3 * space_type;
        if biomebase < game_config_core.biome_threshold_1 {
            biome += 1;
        } else if biomebase < game_config_core.biome_threshold_2 {
            biome += 2;
        } else {
            biome += 3;
        }
        biome
    }
}

/// Noir port of Solidity `LibGameUtils.defaultUpgrade`.
pub fn default_upgrade() -> Upgrade {
    Upgrade {
        pop_cap_multiplier: 100,
        pop_gro_multiplier: 100,
        range_multiplier: 100,
        speed_multiplier: 100,
        def_multiplier: 100,
    }
}

/// Noir port of Solidity `LibGameUtils.timeDelayUpgrade`.
pub fn time_delay_upgrade(artifact: Artifact) -> Upgrade {
    if artifact.artifact_type == ArtifactType::PhotoidCannon() {
        let range: [u128; 6] = [100, 200, 200, 200, 200, 200];
        let speed_boosts: [u128; 6] = [100, 500, 1000, 1500, 2000, 2500];

        Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: range[artifact.rarity as u32],
            speed_multiplier: speed_boosts[artifact.rarity as u32],
            def_multiplier: 100,
        }
    } else {
        default_upgrade()
    }
}

/// Noir port of Solidity `LibGameUtils.abandoningUpgrade`.
pub fn abandoning_upgrade(space_junk_config: SpaceJunkConfig) -> Upgrade {
    Upgrade {
        pop_cap_multiplier: 100,
        pop_gro_multiplier: 100,
        range_multiplier: space_junk_config.abandon_range_change_percent,
        speed_multiplier: space_junk_config.abandon_speed_change_percent,
        def_multiplier: 100,
    }
}

/// Noir port of Solidity `LibGameUtils._getUpgradeForArtifact`.
pub fn _get_upgrade_for_artifact(artifact: Artifact) -> Upgrade {
    if artifact.artifact_type == ArtifactType::PlanetaryShield() {
        let defense_multipliers_per_rarity: [u128; 6] = [100, 150, 200, 300, 450, 650];
        Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 20,
            speed_multiplier: 20,
            def_multiplier: defense_multipliers_per_rarity[artifact.rarity as u32],
        }
    } else if artifact.artifact_type == ArtifactType::PhotoidCannon() {
        let defense_multipliers_per_rarity: [u128; 6] = [100, 50, 40, 30, 20, 10];
        Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: defense_multipliers_per_rarity[artifact.rarity as u32],
        }
    } else if artifact.artifact_type >= ArtifactType::Wormhole() {
        Upgrade {
            pop_cap_multiplier: 100,
            pop_gro_multiplier: 100,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: 100,
        }
    } else {
        let mut upgrade: Upgrade = default_upgrade();
        if artifact.artifact_type == ArtifactType::Monolith() {
            upgrade.pop_cap_multiplier += 5;
            upgrade.pop_gro_multiplier += 5;
        } else if artifact.artifact_type == ArtifactType::Colossus() {
            upgrade.speed_multiplier += 5;
        } else if artifact.artifact_type == ArtifactType::Spaceship() {
            upgrade.range_multiplier += 5;
        } else if artifact.artifact_type == ArtifactType::Pyramid() {
            upgrade.def_multiplier += 5;
        }

        if artifact.planet_biome == Biome::Ocean() {
            upgrade.speed_multiplier += 5;
            upgrade.def_multiplier += 5;
        } else if artifact.planet_biome == Biome::Forest() {
            upgrade.def_multiplier += 5;
            upgrade.pop_cap_multiplier += 5;
        } else if artifact.planet_biome == Biome::Grassland() {
            upgrade.pop_cap_multiplier += 5;
            upgrade.pop_gro_multiplier += 5;
            upgrade.range_multiplier += 5;
        } else if artifact.planet_biome == Biome::Tundra() {
            upgrade.def_multiplier += 5;
            upgrade.range_multiplier += 5;
        } else if artifact.planet_biome == Biome::Swamp() {
            upgrade.speed_multiplier += 5;
            upgrade.range_multiplier += 5;
        } else if artifact.planet_biome == Biome::Desert() {
            upgrade.speed_multiplier += 10;
        } else if artifact.planet_biome == Biome::Ice() {
            upgrade.range_multiplier += 10;
        } else if artifact.planet_biome == Biome::Wasteland() {
            upgrade.def_multiplier += 10;
        } else if artifact.planet_biome == Biome::Lava() {
            upgrade.pop_cap_multiplier += 10;
            upgrade.pop_gro_multiplier += 10;
        } else if artifact.planet_biome == Biome::Corrupted() {
            upgrade.range_multiplier += 5;
            upgrade.speed_multiplier += 5;
            upgrade.pop_cap_multiplier += 5;
            upgrade.pop_gro_multiplier += 5;
        }
        let scale: u128 = 1 + (artifact.rarity as u128) / 2;
        upgrade.pop_cap_multiplier = scale * upgrade.pop_cap_multiplier - (scale - 1) * 100;
        upgrade.pop_gro_multiplier = scale * upgrade.pop_gro_multiplier - (scale - 1) * 100;
        upgrade.speed_multiplier = scale * upgrade.speed_multiplier - (scale - 1) * 100;
        upgrade.range_multiplier = scale * upgrade.range_multiplier - (scale - 1) * 100;
        upgrade.def_multiplier = scale * upgrade.def_multiplier - (scale - 1) * 100;
        upgrade
    }
}

/// Noir port of Solidity `LibGameUtils.artifactRarityFromPlanetLevel`.
pub fn artifact_rarity_from_planet_level(planet_level: u8) -> u8 {
    if planet_level <= 1 {
        ArtifactRarity::Common()
    } else if planet_level <= 3 {
        ArtifactRarity::Rare()
    } else if planet_level <= 5 {
        ArtifactRarity::Epic()
    } else if planet_level <= 7 {
        ArtifactRarity::Legendary()
    } else {
        ArtifactRarity::Mythic()
    }
}

/// Noir port of Solidity `LibGameUtils._putArtifactOnPlanet`.
///
/// planets can have multiple artifacts on them. this function updates all the
/// internal contract book-keeping to reflect that the given artifact was
/// put on. note that this function does not transfer the artifact.
pub fn _put_artifact_on_planet(
    artifact_id: Field,
    mut artifact_location: ArtifactLocation,
    location_id: Field,
    mut planet_artifacts: PlanetArtifacts,
) -> (Field, ArtifactLocation, Field, PlanetArtifacts) {
    artifact_location.planet_id = location_id;
    artifact_location.voyage_id = 0;

    let cnt: u32 = planet_artifacts.count;
    planet_artifacts.ids[cnt] = artifact_id;
    planet_artifacts.count = cnt + 1;

    (artifact_id, artifact_location, location_id, planet_artifacts)
}

/// Noir port of Solidity `LibGameUtils._takeArtifactOffPlanet`.
///
// planets can have multiple artifacts on them. this function updates all the
// internal contract book-keeping to reflect that the given artifact was
// taken off the given planet. note that this function does not transfer the
// artifact.
//
// if the given artifact is not on the given planet, reverts
// if the given artifact is currently activated, reverts
pub fn _take_artifact_off_planet(
    artifact_id: Field,
    mut artifact_location: ArtifactLocation,
    artifact: Artifact,
    location_id: Field,
    mut planet_artifacts: PlanetArtifacts,
) -> (Field, ArtifactLocation, Field, PlanetArtifacts) {
    let artifacts_on_this_planet: u32 = planet_artifacts.count;
    let mut had_the_artifact: bool = false;
    let mut found_index: u32 = 0;
    // Use fixed array size 20 as compile-time constant for loop bound
    for i in 0..20 {
        if i < artifacts_on_this_planet {
            if !had_the_artifact {
                if planet_artifacts.ids[i] == artifact_id {
                    let activated: bool = is_activated(artifact);
                    assert(!activated, "you cannot take an activated artifact off a planet");

                    found_index = i;
                    had_the_artifact = true;
                }
            }
        }
    }
    assert(had_the_artifact, "this artifact was not present on this planet");
    let last_index: u32 = artifacts_on_this_planet - 1;
    artifact_location.planet_id = 0 as Field;
    artifact_location.voyage_id = 0;
    planet_artifacts.count -= 1;
    planet_artifacts.ids[found_index] = planet_artifacts.ids[last_index];
    planet_artifacts.ids[last_index] = 0;
    (artifact_id, artifact_location, location_id, planet_artifacts)
}

/// Noir port of Solidity `LibGameUtils._takeArtifactOffPlanet`.
///
/// an artifact is only considered 'activated' if this method returns true.
/// we do not have an `isActive` field on artifact; the times that the
/// artifact was last activated and deactivated are sufficent to determine
/// whether or not the artifact is activated.
pub fn is_activated(artifact: Artifact) -> bool {
    artifact.last_deactivated < artifact.last_activated
}

/// Noir port of Solidity `LibGameUtils.isArtifactOnPlanet`.
pub fn is_artifact_on_planet(
    location_id: Field,
    planet_artifacts: PlanetArtifacts,
    artifact_id: Field,
) -> bool {
    let mut found: bool = false;
    // Use fixed array size 20 as compile-time constant for loop bound
    for i in 0..20 {
        if i < planet_artifacts.count {
            if !found {
                if planet_artifacts.ids[i] == artifact_id {
                    found = true;
                }
            }
        }
    }
    found
}

/// Noir port of Solidity `LibGameUtils.getPlanetArtifact`.
///
/// if the given artifact is on the given planet, then return the artifact
/// otherwise, return a 'null' artifact
pub fn get_planet_artifact(
    location_id: Field,
    planet_artifacts: PlanetArtifacts,
    artifact_id: Field,
    artifact: Artifact,
) -> Artifact {
    let mut found: bool = false;
    // Use fixed array size 20 as compile-time constant for loop bound
    for i in 0..20 {
        if i < planet_artifacts.count {
            if !found {
                if planet_artifacts.ids[i] == artifact_id {
                    found = true;
                }
            }
        }
    }
    if found {
        artifact
    } else {
        Artifact::zero()
    }
}

/// Noir port of Solidity `LibGameUtils.getActiveArtifact`.
/// todo: implement this
pub fn get_active_artifact(location_id: Field, planet_artifacts: PlanetArtifacts) -> Artifact {
    Artifact::zero()
}

/// Noir port of Solidity `LibGameUtils.getPlanetDefaultSpaceJunk`.
pub fn get_planet_default_space_junk(planet: Planet, space_junk_config: SpaceJunkConfig) -> u128 {
    if planet.is_home_planet {
        0
    } else {
        space_junk_config.planet_level_junk[planet.planet_level as u32]
    }
}

/// Noir port of Solidity `LibGameUtils._buffPlanet`.
pub fn _buff_planet(location_id: Field, mut planet: Planet, upgrade: Upgrade) -> (Field, Planet) {
    planet.population_cap = (planet.population_cap * upgrade.pop_cap_multiplier) / 100;
    planet.population_growth = (planet.population_growth * upgrade.pop_gro_multiplier) / 100;
    planet.range = (planet.range * upgrade.range_multiplier) / 100;
    planet.speed = (planet.speed * upgrade.speed_multiplier) / 100;
    planet.defense = (planet.defense * upgrade.def_multiplier) / 100;

    (location_id, planet)
}

/// Noir port of Solidity `LibGameUtils._debuffPlanet`.
pub fn _debuff_planet(location_id: Field, mut planet: Planet, upgrade: Upgrade) -> (Field, Planet) {
    planet.population_cap = (planet.population_cap * 100) / upgrade.pop_cap_multiplier;
    planet.population_growth = (planet.population_growth * 100) / upgrade.pop_gro_multiplier;
    planet.range = (planet.range * 100) / upgrade.range_multiplier;
    planet.speed = (planet.speed * 100) / upgrade.speed_multiplier;
    planet.defense = (planet.defense * 100) / upgrade.def_multiplier;
    (location_id, planet)
}

/// Noir port of Solidity `LibGameUtils.checkPlanetDOS`.
///
/// planets support a limited amount of incoming arrivals
/// the owner can send a maximum of 10 arrivals to this planet
/// separately, everyone other than the owner can also send a maximum
/// of 10 arrivals in aggregate

/// todo: implement this

/// Noir port of Solidity `LibGameUtils.updateWorldRadius`.
pub fn update_world_radius(mut world: World, world_config: WorldConfig) -> World {
    if !world_config.world_radius_locked {
        let new_radius = _get_radius(world_config);
        world.radius = new_radius;
    }
    world
}

/// Noir port of Solidity `LiGameUtils.isPopCapBoost`.
pub fn is_pop_cap_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 9, 9);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isPopGroBoost`.
pub fn is_pop_gro_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 10, 10);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isRangeBoost`.
pub fn is_range_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 11, 11);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isSpeedBoost`.
pub fn is_speed_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 12, 12);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isDefBoost`.
pub fn is_def_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 13, 13);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isHalfSpaceJunk`.
pub fn is_half_space_junk(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 14, 14);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils._defaultPlanet`.
pub fn _default_planet(
    location: Field,
    level: u8,
    planet_type: u8,
    space_type: u8,
    time_factor_hundredths: u16,
    planet_default_stats: PlanetDefaultStats,
) -> Planet {
    let time_factor_hundredths = time_factor_hundredths;

    let dead_space: bool = space_type == SpaceType::DeadSpace();
    let deep_space: bool = space_type == SpaceType::DeepSpace();
    let medium_space: bool = space_type == SpaceType::Space();

    let mut planet = Planet::zero();

    planet.owner = AztecAddress::zero();
    planet.planet_level = level;
    planet.planet_type = planet_type;
    planet.space_type = space_type;
    planet.population_cap = planet_default_stats.population_cap;
    planet.population_growth = planet_default_stats.population_growth;
    planet.range = planet_default_stats.range;
    planet.speed = planet_default_stats.speed;
    planet.defense = planet_default_stats.defense;
    planet.silver_cap = planet_default_stats.silver_cap;

    if planet_type == PlanetType::SilverMine() {
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
    if planet_type == PlanetType::SilverMine() {
        // PlanetType::SilverMine
        planet.silver_cap *= 2;
        planet.defense /= 2;
    } else if planet_type == PlanetType::SilverBank() {
        // PlanetType::SilverBank
        planet.speed /= 2;
        planet.silver_cap *= 10;
        planet.population_growth = 0;
        planet.population_cap *= 5;
    } else if planet_type == PlanetType::TradingPost() {
        // PlanetType::TradingPost
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
    if planet_type == PlanetType::SilverBank() {
        // PlanetType::SilverBank
        planet.population /= 2;
    }

    // Adjust silver cap for mine
    if planet_type == PlanetType::SilverMine() {
        // PlanetType::SilverMine
        planet.silver = planet.silver_cap / 2;
    }

    // Apply time factor
    planet.speed = planet.speed * time_factor_hundredths as u128 / 100;
    planet.population_growth = planet.population_growth * time_factor_hundredths as u128 / 100;
    planet.silver_growth = planet.silver_growth * time_factor_hundredths as u128 / 100;

    planet
}
