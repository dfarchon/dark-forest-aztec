use dep::config::{SnarkConstants, GameConfigCore};

// Game utility functions that don't require storage access
// Pure computation functions extracted from LibGameUtils

/// Noir port of Solidity `LibPlanet._calculateByteUInt`.
/// Extract a big-endian integer from the byte slice of `location_id`.
///
/// Matches Solidity `bytes memory b = abi.encodePacked(uint256(location_id));`:
/// - 32-byte big-endian, left-padded with zeros.
///
/// Note: Returns `u128`, so `end_byte - start_byte` must be < 16.
pub fn calculate_byte_uint_from_location_id(location_id: Field, start_byte: u32, end_byte: u32) -> u128 {
    assert(start_byte <= end_byte, "start_byte must be <= end_byte");
    assert(end_byte < 32, "end_byte out of bounds (expected < 32)");
    assert(end_byte - start_byte < 16, "byte range must fit in u128");

    // Optimized: Only process the required byte range instead of all 32 bytes
    // We need to extract bytes in big-endian order (MSB first)
    // In 32-byte big-endian: byte[0] is MSB, byte[31] is LSB
    // Field is 254 bits for BN254 curve
    let bits: [u1; 254] = location_id.to_le_bits();
    let bits_len: u32 = bits.len() as u32;

    // Parse the requested byte slice as big-endian:
    // acc = (((b[start] * 256) + b[start+1]) * 256 + ...) + b[end]
    let mut acc: u128 = 0;
    
    // Only iterate over the required byte range (start_byte to end_byte)
    for i in start_byte..=end_byte {
        // Compute the i-th byte in the 32-byte big-endian encoding.
        // Byte index from the right (least-significant) side:
        //   - i = 31 -> byte_from_right = 0 (LSB byte)
        //   - i = 0  -> byte_from_right = 31 (MSB byte)
        let byte_from_right: u32 = 31 - i;
        let base_bit: u32 = byte_from_right * 8;

        // Extract byte using bit operations (more efficient than checking each bit individually)
        let mut byte: u8 = 0;
        for bit in 0..8 {
            let bit_idx: u32 = base_bit + bit;
            if bit_idx < bits_len {
                if bits[bit_idx] == 1 {
                    byte += 1 << (bit as u8);
                }
            }
        }

        acc = acc * 256 + (byte as u128);
    }
    acc
}

/// Noir port of Solidity `LibGameUtils._locationIdValid`.
pub fn location_id_valid(loc: Field, max_location_id: Field) -> bool {
    loc.lt(max_location_id)
}

/// Noir port of Solidity `LibGameUtils.revertIfBadSnarkPerlinFlags`.
/// Validates that the SNARK perlin flags match the configured constants.
/// 
/// This function ensures that SNARK proofs use the correct keys and parameters
/// for this universe. Without this check, a player could create a valid SNARK
/// proof with wrong keys, creating an invalid planet.
/// 
/// # Arguments
/// - `perlin_flags`: Array of 5 flags [planethash_key, spacetype/biomebase_key, perlin_length_scale, mirror_x, mirror_y]
/// - `checking_biome`: If true, checks biomebase_key instead of spacetype_key
/// 
/// # Returns
/// `true` if all flags match the configured constants
pub fn revert_if_bad_snark_perlin_flags(
    planethash_key: u128, 
    spacetype_key: u128,
    biomebase_key: u128,
    perlin_mirror_x: bool,
    perlin_mirror_y: bool,
    perlin_length_scale: u128,
    checking_biome: bool,
    snark_constants: SnarkConstants,
) -> bool {
    assert(planethash_key == snark_constants.planethash_key, "bad planethash mimc key");
    if( checking_biome ) {
        assert(spacetype_key == snark_constants.spacetype_key, "bad spacetype mimc key");
    } else {
        assert(biomebase_key == snark_constants.biomebase_key, "bad biomebase mimc key");
    }
    assert(perlin_length_scale == snark_constants.perlin_length_scale, "bad perlin length scale");
    assert(perlin_mirror_x == snark_constants.perlin_mirror_x, "bad perlin mirror x");
    assert(perlin_mirror_y == snark_constants.perlin_mirror_y, "bad perlin mirror y");   
    true   
}


/// Noir port of Solidity `LibGameUtils.spaceTypeFromPerlin`.
/// Returns SpaceType as u8 (0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace).
/// `perlin` here is a u8 value in [0, 255].
pub fn space_type_from_perlin(perlin: u8, game_config_core: GameConfigCore) -> u8 {
    let perlin_u128: u128 = perlin as u128;
    if perlin_u128 >= game_config_core.perlin_threshold_3 {
        3 // SpaceType::DeadSpace
    } else if perlin_u128 >= game_config_core.perlin_threshold_2 {
        2 // SpaceType::DeepSpace
    } else if perlin_u128 >= game_config_core.perlin_threshold_1 {
        1 // SpaceType::Space
    } else {
        0 // SpaceType::Nebula
    }
}

/// Noir port of Solidity `LiGameUtils.isPopCapBoost`.
pub fn is_pop_cap_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 9, 9);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isPopGroBoost`.
pub fn is_pop_gro_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 10, 10);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isRangeBoost`.
pub fn is_range_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 11, 11);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isSpeedBoost`.
pub fn is_speed_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 12, 12);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isDefBoost`.
pub fn is_def_boost(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 13, 13);
    byte < 16
}

/// Noir port of Solidity `LibGameUtils.isHalfSpaceJunk`.
pub fn is_half_space_junk(location: Field) -> bool {
    let byte: u128 = calculate_byte_uint_from_location_id(location, 14, 14);
    byte < 16
}
