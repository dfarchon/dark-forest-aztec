// Reveal Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves that public coordinates (x, y) match a known planet hash and perlin value

use dep::aztec::protocol_types::hash::poseidon2_hash;
use crate::circuits::perlin::multi_scale_perlin;

// Constants as functions
fn coord_offset() -> u128 {
    2147483648 // 2^31
}

fn max_coord() -> u128 {
    4294967296 // 2^32
}

/// Range check: ensures abs(x), abs(y) <= 2^31
/// Uses offset approach: x + (1 << 31) must be in [0, 2^32)
fn check_coordinate_range(coord: Field) {
    let offset = coord_offset() as Field;
    let coord_offset_val = coord + offset;
    // Ensure coord_offset is in valid range [0, 2^32)
    // Cast to u128 for comparison
    let coord_offset_u128 = coord_offset_val as u128;
    let max_coord_val = max_coord();
    assert(coord_offset_u128 < max_coord_val);
}

/// Reveal circuit proof function
/// Returns (planet_hash, perlin_value)
pub fn reveal_proof(
    x: Field,  // public
    y: Field,  // public
    planet_hash_key: Field,
    space_type_key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool
) -> (Field, u8) {
    // 1. Coordinate range check: abs(x), abs(y) <= 2^31
    check_coordinate_range(x);
    check_coordinate_range(y);
    
    // 2. Planet hash: Poseidon2(x, y, planet_hash_key)
    let planet_hash = poseidon2_hash([x, y, planet_hash_key]);
    
    // 3. Perlin value: multi_scale_perlin(x, y, space_type_key, scale, x_mirror, y_mirror)
    let perl_u8 = multi_scale_perlin(x, y, space_type_key, scale, x_mirror, y_mirror);
    
    (planet_hash, perl_u8)
}
