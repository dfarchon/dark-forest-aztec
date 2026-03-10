// Biomebase Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves that a planet at (x, y) has a specific biomebase value

use crate::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;
use ::types::config::game::{GameConfig, GameConfigCore};
use ::types::config::snark::SnarkConfig;
use ::types::storage::planet::{Biome, SpaceType};

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
    if space_type == SpaceType::DeadSpace {
        Biome::Corrupted
    } else if space_type == SpaceType::DeepSpace {
        if biomebase_u128 < biome_threshold_1 {
            Biome::Ice
        } else if biomebase_u128 < biome_threshold_2 {
            Biome::Wasteland
        } else {
            Biome::Lava
        }
    } else if space_type == SpaceType::Space {
        if biomebase_u128 < biome_threshold_1 {
            Biome::Tundra
        } else if biomebase_u128 < biome_threshold_2 {
            Biome::Swamp
        } else {
            Biome::Desert
        }
    } else {
        if biomebase_u128 < biome_threshold_1 {
            Biome::Ocean
        } else if biomebase_u128 < biome_threshold_2 {
            Biome::Forest
        } else {
            Biome::Grassland
        }
    }
}

pub fn get_biome_default(space_type: u8, biomebase: u8) -> u8 {
    get_biome(space_type, biomebase, 15, 17)
}

pub fn get_biome_with_config(
    space_type: u8,
    biomebase: u8,
    game_config_core: GameConfigCore,
) -> u8 {
    get_biome(
        space_type,
        biomebase,
        game_config_core.biome_threshold_1 as u128,
        game_config_core.biome_threshold_2 as u128,
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
    game_config_core: GameConfigCore,
    space_type: u8,
    x: Field,
    y: Field,
) -> (Field, u8, u8) {
    let (planet_hash, biomebase) = biomebase_proof_with_config(snark, x, y);
    let biome = get_biome_with_config(space_type, biomebase, game_config_core);
    (planet_hash, biomebase, biome)
}

pub fn biome_proof_default(space_type: u8, x: Field, y: Field) -> (Field, u8, u8) {
    let snark = SnarkConfig::zero();
    let game_config = GameConfigCore::zero();
    biome_proof(snark, game_config, space_type, x, y)
}
