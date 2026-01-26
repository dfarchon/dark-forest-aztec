// Game utility functions that don't require storage access
// Pure computation functions extracted from LibGameUtils

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

/// Noir port of Solidity `LibGameUtils.isPopCapBoost`.
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
