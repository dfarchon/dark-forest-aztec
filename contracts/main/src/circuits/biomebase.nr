// Biomebase Circuit for Dark Forest v0.6
// Converted from Circom to Noir
// Proves that a planet at (x, y) has a specific biomebase value

use dep::aztec::protocol_types::hash::poseidon2_hash;
use crate::circuits::perlin::multi_scale_perlin;

/// Biomebase circuit proof function
/// Returns (planet_hash, biomebase_value)
pub fn biomebase_proof(
    planet_hash_key: Field,
    biomebase_key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool,
    x: Field,  // private
    y: Field   // private
) -> (Field, u8) {
    // 1. Planet hash: Poseidon2(x, y, planet_hash_key)
    let hash = poseidon2_hash([x, y, planet_hash_key]);
    
    // 2. Biomebase perlin: multi_scale_perlin(x, y, biomebase_key, scale, x_mirror, y_mirror)
    let biome_base = multi_scale_perlin(x, y, biomebase_key, scale, x_mirror, y_mirror);
    
    (hash, biome_base)
}
