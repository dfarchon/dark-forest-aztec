// Reveal Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves that public coordinates (x, y) match a known planet hash and perlin value

use crate::circuits::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;

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

/// Detect if a coordinate is negative based on offset representation
/// A negative coordinate becomes < 2^31 when offset is added
fn is_coord_negative(coord: Field) -> bool {
    let offset = coord_offset();
    let coord_with_offset = (coord + (offset as Field)) as u128;
    coord_with_offset < offset
}

/// Get absolute value of coordinate for perlin calculation
fn get_abs_coord(coord: Field, is_negative: bool) -> Field {
    if is_negative {
        // For negative coordinates, the Field value is the modular negative
        // We need to negate it to get the absolute value
        coord * (0 - 1) // Multiply by -1 in field arithmetic
    } else {
        coord
    }
}

/// Reveal circuit proof function
/// Returns (planet_hash, perlin_value)
pub fn reveal_proof(
    x: Field, // public
    y: Field, // public
    planet_hash_key: Field,
    space_type_key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool,
) -> (Field, u8) {
    // 1. Coordinate range check: abs(x), abs(y) <= 2^31
    check_coordinate_range(x);
    check_coordinate_range(y);

    // 2. Planet hash: Poseidon2(x, y, planet_hash_key)
    let planet_hash = poseidon2_hash([x, y, planet_hash_key]);

    // 3. Determine coordinate signs and get absolute values
    let x_negative = is_coord_negative(x);
    let y_negative = is_coord_negative(y);
    let abs_x = get_abs_coord(x, x_negative);
    let abs_y = get_abs_coord(y, y_negative);

    // 4. Perlin value: multi_scale_perlin(abs_x, abs_y, x_neg, y_neg, space_type_key, scale, x_mirror, y_mirror)
    let perl_u8 = multi_scale_perlin(
        abs_x,
        abs_y,
        x_negative,
        y_negative,
        space_type_key,
        scale,
        x_mirror,
        y_mirror,
    );

    (planet_hash, perl_u8)
}
