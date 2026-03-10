// Move Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves a valid move from planet (x1, y1) to planet (x2, y2):
// - Destination is within spawn radius
// - Distance between planets is within maximum
// - Both planet hashes are valid
// - Destination perlin is valid

use crate::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;

// Constants as functions
fn coord_offset() -> u128 {
    2147483648 // 2^31
}

fn max_coord() -> u128 {
    4294967296 // 2^32
}

/// Range check: ensures abs(coord) <= 2^31
/// Uses offset approach: coord + (1 << 31) must be in [0, 2^32)
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

/// Move circuit proof function
/// Returns (source_planet_hash, destination_planet_hash, destination_perlin_value)
pub fn move_proof(
    r: Field,
    dist_max: Field,
    planet_hash_key: Field,
    space_type_key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool,
    x1: Field, // private - source X coordinate
    y1: Field, // private - source Y coordinate
    x2: Field, // private - destination X coordinate
    y2: Field, // private - destination Y coordinate
) -> (Field, Field, u8) {
    // 1. Coordinate range checks: abs(x1), abs(y1), abs(x2), abs(y2) <= 2^31
    check_coordinate_range(x1);
    check_coordinate_range(y1);
    check_coordinate_range(x2);
    check_coordinate_range(y2);

    // 2. Destination radius check: x2^2 + y2^2 < r^2
    let x2_sq = x2 * x2;
    let y2_sq = y2 * y2;
    let r_sq = r * r;
    let dist2_sq = x2_sq + y2_sq;
    // Cast to u128 for comparison
    let dist2_sq_u128 = dist2_sq as u128;
    let r_sq_u128 = r_sq as u128;
    assert(dist2_sq_u128 < r_sq_u128);

    // 3. Distance check: (x1-x2)^2 + (y1-y2)^2 <= distMax^2
    let diff_x = x1 - x2;
    let diff_y = y1 - y2;
    let dist_sq = diff_x * diff_x + diff_y * diff_y;
    let dist_max_sq = dist_max * dist_max;
    // Cast to u128 for comparison
    let dist_sq_u128 = dist_sq as u128;
    let dist_max_sq_u128 = dist_max_sq as u128;
    assert(dist_sq_u128 <= dist_max_sq_u128);

    // 4. Source planet hash: Poseidon2(planet_hash_key, x1, y1) - matches client poseidon2Hash([planetHashKey, x, y])
    let pub1 = poseidon2_hash([planet_hash_key, x1, y1]);

    // 5. Destination planet hash: Poseidon2(planet_hash_key, x2, y2) - matches client poseidon2Hash([planetHashKey, x, y])
    let pub2 = poseidon2_hash([planet_hash_key, x2, y2]);

    // 6. Determine coordinate signs for destination and get absolute values
    let x2_negative = is_coord_negative(x2);
    let y2_negative = is_coord_negative(y2);
    let abs_x2 = get_abs_coord(x2, x2_negative);
    let abs_y2 = get_abs_coord(y2, y2_negative);

    // 7. Destination perlin value
    let perl2 = multi_scale_perlin(
        abs_x2,
        abs_y2,
        x2_negative,
        y2_negative,
        space_type_key,
        scale,
        x_mirror,
        y_mirror,
    );

    (pub1, pub2, perl2)
}
