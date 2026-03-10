// Init Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves knowledge of valid spawn coordinates (x, y) that:
// - Are within the spawn radius r
// - Are near the edge of the spawn area (between 98% and 100% of radius)
// - Generate a specific planet hash
// - Generate a specific perlin value

use crate::perlin::multi_scale_perlin;
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
fn is_coord_negative(coord: Field) -> bool {
    let offset = coord_offset();
    let coord_with_offset = (coord + (offset as Field)) as u128;
    coord_with_offset < offset
}

/// Get absolute value of coordinate for perlin calculation
fn get_abs_coord(coord: Field, is_negative: bool) -> Field {
    if is_negative {
        coord * (0 - 1)
    } else {
        coord
    }
}

/// Init circuit proof function
/// Returns (planet_hash, perlin_value)
pub fn init_proof(
    r: Field,
    planet_hash_key: Field,
    space_type_key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool,
    x: Field, // private
    y: Field, // private
) -> (Field, u8) {
    // 1. Coordinate range check: abs(x), abs(y) <= 2^31
    check_coordinate_range(x);
    check_coordinate_range(y);

    // 2. Radius upper bound check: x^2 + y^2 < r^2
    let x_sq = x * x;
    let y_sq = y * y;
    let r_sq = r * r;
    let dist_sq = x_sq + y_sq;
    // Cast to u128 for comparison
    let dist_sq_u128 = dist_sq as u128;
    let r_sq_u128 = r_sq as u128;
    assert(dist_sq_u128 < r_sq_u128);

    // 3. Radius lower bound check: x^2 + y^2 > 0.98 * r^2
    // Equivalently: 100 * (x^2 + y^2) > 98 * r^2
    let lower_bound = r_sq * 98;
    let dist_sq_100 = dist_sq * 100;
    // Cast to u128 for comparison
    let dist_sq_100_u128 = dist_sq_100 as u128;
    let lower_bound_u128 = lower_bound as u128;
    assert(dist_sq_100_u128 > lower_bound_u128);

    // 4. Planet hash: Poseidon2(planet_hash_key, x, y) - matches client & move circuit
    let planet_hash = poseidon2_hash([planet_hash_key, x, y]);

    // 5. Determine coordinate signs and get absolute values
    let x_negative = is_coord_negative(x);
    let y_negative = is_coord_negative(y);
    let abs_x = get_abs_coord(x, x_negative);
    let abs_y = get_abs_coord(y, y_negative);

    // 6. Perlin value
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
