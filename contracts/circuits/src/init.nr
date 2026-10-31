// Init Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves knowledge of valid spawn coordinates (x, y) that:
// - Are within the spawn radius r
// - Are near the edge of the spawn area (between 98% and 100% of radius)
// - Generate a specific planet hash
// - Generate a specific perlin value

use crate::coords::{check_coordinate_range, get_abs_coord, is_coord_negative};
use crate::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;

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

    r.assert_max_bit_size::<32>();

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
