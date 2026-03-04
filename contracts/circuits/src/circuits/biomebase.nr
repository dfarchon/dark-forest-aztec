// Biomebase Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves that a planet at (x, y) has a specific biomebase value

use crate::circuits::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;
use ::types::config::game::{GameConfig, GameConfigCore};
use ::types::config::snark::SnarkConfig;

// ============================================================================
// Biome Types (matching Dark Forest v0.6)
// ============================================================================

/// Biome enum values (matching Dark Forest v0.6 Biome enum)
pub mod Biome {
    pub global UNKNOWN: u8 = 0;
    pub global OCEAN: u8 = 1;
    pub global FOREST: u8 = 2;
    pub global GRASSLAND: u8 = 3;
    pub global TUNDRA: u8 = 4;
    pub global SWAMP: u8 = 5;
    pub global DESERT: u8 = 6;
    pub global ICE: u8 = 7;
    pub global WASTELAND: u8 = 8;
    pub global LAVA: u8 = 9;
    pub global CORRUPTED: u8 = 10;
}

/// SpaceType enum values (matching Dark Forest v0.6)
pub mod SpaceType {
    pub global NEBULA: u8 = 0;
    pub global SPACE: u8 = 1;
    pub global DEEP_SPACE: u8 = 2;
    pub global DEAD_SPACE: u8 = 3;
}

fn coord_offset() -> u128 {
    2147483648 // 2^31
}

fn is_coord_negative(coord: Field) -> bool {
    let offset = coord_offset();
    let coord_with_offset = (coord + (offset as Field)) as u128;
    coord_with_offset < offset
}

fn get_abs_coord(coord: Field, is_negative: bool) -> Field {
    if is_negative {
        coord * (0 - 1)
    } else {
        coord
    }
}

pub fn get_biome(
    space_type: u8,
    biomebase: u8,
    biome_threshold_1: u128,
    biome_threshold_2: u128,
) -> u8 {
    let biomebase_u128 = biomebase as u128;
    if space_type == SpaceType::DEAD_SPACE {
        Biome::CORRUPTED
    } else if space_type == SpaceType::DEEP_SPACE {
        if biomebase_u128 < biome_threshold_1 {
            Biome::ICE
        } else if biomebase_u128 < biome_threshold_2 {
            Biome::WASTELAND
        } else {
            Biome::LAVA
        }
    } else if space_type == SpaceType::SPACE {
        if biomebase_u128 < biome_threshold_1 {
            Biome::TUNDRA
        } else if biomebase_u128 < biome_threshold_2 {
            Biome::SWAMP
        } else {
            Biome::DESERT
        }
    } else {
        if biomebase_u128 < biome_threshold_1 {
            Biome::OCEAN
        } else if biomebase_u128 < biome_threshold_2 {
            Biome::FOREST
        } else {
            Biome::GRASSLAND
        }
    }
}

pub fn get_biome_default(space_type: u8, biomebase: u8) -> u8 {
    get_biome(space_type, biomebase, 15, 17)
}

pub fn get_biome_with_config(space_type: u8, biomebase: u8, config: GameConfigCore) -> u8 {
    get_biome(
        space_type,
        biomebase,
        config.biome_threshold_1 as u128,
        config.biome_threshold_2 as u128,
    )
}

/// Planet hash: Poseidon2(planet_hash_key, x, y) - matches client
pub fn biomebase_proof(
    planet_hash_key: Field,
    biomebase_key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool,
    x: Field,
    y: Field,
) -> (Field, u8) {
    let hash = poseidon2_hash([planet_hash_key, x, y]);
    let x_negative = is_coord_negative(x);
    let y_negative = is_coord_negative(y);
    let abs_x = get_abs_coord(x, x_negative);
    let abs_y = get_abs_coord(y, y_negative);
    let biome_base = multi_scale_perlin(
        abs_x,
        abs_y,
        x_negative,
        y_negative,
        biomebase_key,
        scale,
        x_mirror,
        y_mirror,
    );
    (hash, biome_base)
}

pub fn biomebase_proof_with_config(snark: SnarkConfig, x: Field, y: Field) -> (Field, u8) {
    biomebase_proof(
        snark.planethash_key as Field,
        snark.biomebase_key as Field,
        snark.perlin_length_scale,
        snark.perlin_mirror_x,
        snark.perlin_mirror_y,
        x,
        y,
    )
}

pub fn biomebase_proof_default(x: Field, y: Field) -> (Field, u8) {
    let snark = SnarkConfig::zero();
    biomebase_proof_with_config(snark, x, y)
}

pub fn biome_proof(
    snark: SnarkConfig,
    game_config: GameConfigCore,
    space_type: u8,
    x: Field,
    y: Field,
) -> (Field, u8, u8) {
    let (planet_hash, biomebase) = biomebase_proof_with_config(snark, x, y);
    let biome = get_biome_with_config(space_type, biomebase, game_config);
    (planet_hash, biomebase, biome)
}

pub fn biome_proof_default(space_type: u8, x: Field, y: Field) -> (Field, u8, u8) {
    let snark = SnarkConfig::zero();
    let game_config = GameConfigCore::zero();
    biome_proof(snark, game_config, space_type, x, y)
}
