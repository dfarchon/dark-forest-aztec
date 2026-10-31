// Reveal Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves that public coordinates (x, y) match a known planet hash and perlin value

use crate::coords::{check_coordinate_range, get_abs_coord, is_coord_negative};
use crate::perlin::multi_scale_perlin;
use ::aztec::protocol::hash::poseidon2_hash;

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

    // 2. Planet hash: Poseidon2(planet_hash_key, x, y) - matches client & move circuit
    let planet_hash = poseidon2_hash([planet_hash_key, x, y]);

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
