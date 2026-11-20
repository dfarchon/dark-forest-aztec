// Move Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves a valid move from planet (x1, y1) to planet (x2, y2):
// - Destination is within spawn radius
// - Claimed distance equals the integer ceiling of the distance between planets
// - Both planet hashes are valid
// - Destination perlin is valid

use crate::coords::{check_coordinate_range, get_abs_coord, is_coord_negative};
use crate::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;

/// Unique integer ceiling of the Euclidean distance between signed map coordinates.
pub fn assert_move_distance(x1: Field, y1: Field, x2: Field, y2: Field, distance: Field) {
    check_coordinate_range(x1);
    check_coordinate_range(y1);
    check_coordinate_range(x2);
    check_coordinate_range(y2);
    distance.assert_max_bit_size::<64>();
    let d = distance as u128;
    assert(d > 0, "Move distance must be positive");
    let dx = x1 - x2;
    let dy = y1 - y2;
    let squared = (dx * dx + dy * dy) as u128;
    assert((d - 1) * (d - 1) < squared, "Move distance exceeds ceiling");
    assert(squared <= d * d, "Move distance below ceiling");
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
    assert_move_distance(x1, y1, x2, y2, dist_max);
    r.assert_max_bit_size::<32>();

    // 2. Destination radius check: x2^2 + y2^2 < r^2
    let x2_sq = x2 * x2;
    let y2_sq = y2 * y2;
    let r_sq = r * r;
    let dist2_sq = x2_sq + y2_sq;
    // Cast to u128 for comparison
    let dist2_sq_u128 = dist2_sq as u128;
    let r_sq_u128 = r_sq as u128;
    assert(dist2_sq_u128 < r_sq_u128);

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

#[test]
fn exact_and_rounded_move_distances() {
    assert_move_distance(0, 0, 3, 4, 5);
    assert_move_distance(-1, -1, 0, 0, 2);
}

#[test(should_fail)]
fn rejects_noncanonical_upper_bound() {
    assert_move_distance(0, 0, 3, 4, 6);
}

#[test(should_fail)]
fn rejects_underestimated_distance() {
    assert_move_distance(0, 0, 1, 1, 1);
}

#[test(should_fail)]
fn test_move_proof_same_coords() {
    let _ = move_proof(1000, 100, 1, 2, 4096, false, false, 3, 4, 3, 4);
}

#[test(should_fail)]
fn test_move_proof_r_over_bound() {
    let _ = move_proof(4294967296, 5, 1, 2, 4096, false, false, 0, 0, 3, 4);
}
