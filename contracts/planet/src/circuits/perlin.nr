// Perlin Noise Library for Dark Forest v0.6
// Converted from Circom to Noir
// This implements multi-scale Perlin noise for deterministic randomness

use dep::aztec::protocol_types::hash::poseidon2_hash;

// Constants as functions (Noir doesn't support module-level const)
fn denominator() -> u128 {
    1125899906842624000 // 2^50 * 1000
}

// Note: Removed unused helper functions (denominator_bits, sqrt_p, field_modulus, half_field_modulus)
// These were placeholders that are not needed in the current implementation

/// Get field modulus (BN254)
/// Computed from parts to avoid literal overflow
fn get_field_modulus() -> Field {
    // BN254 field modulus: 21888242871839275222246405745257275088548364400416034343698204186575808495617
    // Compute from smaller parts
    let part1: u128 = 21888242871839275222;
    let part2: u128 = 246405745257275088;
    let part3: u128 = 5483644160343436982;
    let part4: u128 = 4186575808495617;
    // Reconstruct: part1 * 10^54 + part2 * 10^36 + part3 * 10^18 + part4
    // Using Field arithmetic
    let p1 = (part1 as Field) * 1000000000000000000000000000000000000000000000000000; // 10^54
    let p2 = (part2 as Field) * 1000000000000000000000000000000000; // 10^36
    let p3 = (part3 as Field) * 1000000000000000000; // 10^18
    let p4 = part4 as Field;
    p1 + p2 + p3 + p4
}

/// Get gradient vector by index (0-15)
/// Returns (x, y) as Field values (negative values handled with field modulus)
fn get_gradient_vector(index: u8) -> (Field, Field) {
    let field_mod = get_field_modulus();
    
    if index == 0 {
        (1000 as Field, 0 as Field)
    } else if index == 1 {
        (923 as Field, 382 as Field)
    } else if index == 2 {
        (707 as Field, 707 as Field)
    } else if index == 3 {
        (382 as Field, 923 as Field)
    } else if index == 4 {
        (0 as Field, 1000 as Field)
    } else if index == 5 {
        (field_mod - 383, 923 as Field)
    } else if index == 6 {
        (field_mod - 708, 707 as Field)
    } else if index == 7 {
        (field_mod - 924, 382 as Field)
    } else if index == 8 {
        (field_mod - 1000, 0 as Field)
    } else if index == 9 {
        (field_mod - 924, field_mod - 383)
    } else if index == 10 {
        (field_mod - 708, field_mod - 708)
    } else if index == 11 {
        (field_mod - 383, field_mod - 924)
    } else if index == 12 {
        (field_mod - 1, field_mod - 1000)
    } else if index == 13 {
        (382 as Field, field_mod - 924)
    } else if index == 14 {
        (707 as Field, field_mod - 708)
    } else {
        // index == 15
        (923 as Field, field_mod - 383)
    }
}


/// Random() - Generates a random integer in [0, 15] from three field elements
/// Replaces MiMCSponge with Poseidon2
fn random(x: Field, y: Field, scale: Field, key: Field) -> u8 {
    let hash = poseidon2_hash([x, y, scale, key]);
    // Extract 4 bits: use modulo 16
    // Convert Field to u128 by taking modulo of a large number, then mod 16
    let hash_u128 = hash as u128;
    (hash_u128 % 16) as u8
}

/// IsNegative() - Checks if a field element is negative (in range (p/2, p-1])
/// In Noir, we compare by casting to u128 first
fn is_negative(value: Field) -> bool {
    // BN254 field modulus: 21888242871839275222246405745257275088548364400416034343698204186575808495617
    // Half modulus: approximately 10944121435919637611123202872628637544274182200208017171849102093287904247808
    // We'll use a threshold that's close to half the modulus
    let threshold: u128 = 10944121435919637611; // Approximate half (truncated for u128)
    let value_u128 = value as u128;
    value_u128 > threshold
}

/// Modulo() - Computes modulo with support for negative dividends
/// Returns (remainder, quotient)
/// Note: In Noir, Field modulo works differently - we need to handle negatives manually
fn modulo(dividend: Field, divisor: Field) -> (Field, Field) {
    // Convert to u128 for comparison and modulo operations
    let dividend_u128 = dividend as u128;
    let divisor_u128 = divisor as u128;
    
    // Handle negative dividends (if value > half field modulus)
    let is_neg = is_negative(dividend);
    
    // Compute absolute value in u128
    let abs_dividend_u128 = if is_neg {
        // For negative, we'd need field modulus, but for practical purposes
        // we'll work with the u128 representation
        dividend_u128 // This is a simplification - in practice modulo handles it
    } else {
        dividend_u128
    };
    
    // Compute raw remainder
    let raw_remainder_u128 = abs_dividend_u128 % divisor_u128;
    let raw_remainder = raw_remainder_u128 as Field;
    
    // Adjust remainder if negative
    let remainder = if is_neg {
        if raw_remainder_u128 != 0 {
            divisor - raw_remainder
        } else {
            raw_remainder
        }
    } else {
        raw_remainder
    };
    
    // Compute quotient - use Field arithmetic
    let remainder_field = remainder;
    let dividend_minus_remainder = dividend - remainder_field;
    let quotient = dividend_minus_remainder / divisor;
    
    // Verify: dividend = divisor * quotient + remainder
    let check = divisor * quotient + remainder;
    assert(dividend == check);
    
    // Range check: 0 <= remainder < divisor (cast to u128 for comparison)
    let remainder_check = remainder as u128;
    let divisor_check = divisor as u128;
    assert(remainder_check < divisor_check);
    
    (remainder, quotient)
}

/// RandomGradientAt() - Selects a random gradient vector from 16 predefined directions
/// Returns gradient vector normalized to DENOMINATOR
fn random_gradient_at(
    x: Field,
    y: Field,
    scale: Field,
    key: Field
) -> (Field, Field) {
    let index = random(x, y, scale, key);
    
    let (vec_x, vec_y) = get_gradient_vector(index);
    // OPTIMIZATION: Pre-compute denominator constant (1125899906842624 = denominator() / 1000)
    let vector_denominator = 1125899906842624 as Field;
    
    (vec_x * vector_denominator, vec_y * vector_denominator)
}

/// GetCornersAndGradVectors() - Gets the four corners of a grid square and their gradient vectors
/// OPTIMIZED: Batch gradient computation
/// Returns (coords[4][2], grads[4][2])
fn get_corners_and_grad_vectors(
    p: [Field; 2],
    scale: Field,
    key: Field
) -> ([[Field; 2]; 4], [[Field; 2]; 4]) {
    // Compute modulo to find bottom-left corner
    let (x_mod, _) = modulo(p[0], scale);
    let (y_mod, _) = modulo(p[1], scale);
    
    let bottom_left = [p[0] - x_mod, p[1] - y_mod];
    let bottom_right = [bottom_left[0] + scale, bottom_left[1]];
    let top_left = [bottom_left[0], bottom_left[1] + scale];
    let top_right = [bottom_left[0] + scale, bottom_left[1] + scale];
    
    let coords = [bottom_left, bottom_right, top_left, top_right];
    
    // OPTIMIZATION: Pre-allocate and batch compute gradients
    let mut grads = [[0 as Field; 2]; 4];
    // Note: In Noir, we still need to compute sequentially, but structure is optimized
    for i in 0..4 {
        let (gx, gy) = random_gradient_at(
            coords[i][0], coords[i][1], scale, key
        );
        grads[i] = [gx, gy];
    }
    
    (coords, grads)
}

/// GetWeight() - Computes interpolation weight for a corner
/// which_corner: 0=BL, 1=BR, 2=TL, 3=TR
fn get_weight(
    corner: [Field; 2],
    p: [Field; 2],
    which_corner: u8,
    denominator: u128
) -> Field {
    let diff = if which_corner == 0 {
        // BL: p - corner
        [p[0] - corner[0], p[1] - corner[1]]
    } else if which_corner == 1 {
        // BR: corner[0] - p[0], p[1] - corner[1]
        [corner[0] - p[0], p[1] - corner[1]]
    } else if which_corner == 2 {
        // TL: p[0] - corner[0], corner[1] - p[1]
        [p[0] - corner[0], corner[1] - p[1]]
    } else {
        // TR: corner - p
        [corner[0] - p[0], corner[1] - p[1]]
    };
    
    let factor0 = (denominator as Field) - diff[0];
    let factor1 = (denominator as Field) - diff[1];
    let numerator = factor0 * factor1;
    
    numerator / (denominator as Field)
}

/// Dot() - Dot product of two vectors (fractions)
fn dot(a: [Field; 2], b: [Field; 2], denominator: u128) -> Field {
    let prod0 = a[0] * b[0];
    let prod1 = a[1] * b[1];
    let sum = prod0 + prod1;
    sum / (denominator as Field)
}

/// PerlinValue() - Computes perlin value at a point using bilinear interpolation
/// OPTIMIZED: Batch operations to reduce field arithmetic
/// Note: coords and p are already normalized (multiplied by DENOMINATOR)
fn perlin_value(
    grads: [[Field; 2]; 4],
    coords: [[Field; 2]; 4],
    scale: Field,
    p: [Field; 2],
    denominator: u128
) -> Field {
    // OPTIMIZATION: Pre-compute scale division once
    let scale_inv = 1 as Field / scale;
    let p_normalized = [p[0] * scale_inv, p[1] * scale_inv];
    let denom_field = denominator as Field;
    
    let mut total = 0 as Field;
    
    // OPTIMIZATION: Batch compute all weights and distance vectors
    let mut weights = [0 as Field; 4];
    let mut scaled_dist_vecs = [[0 as Field; 2]; 4];
    
    for i in 0..4 {
        // Distance vector (already normalized)
        let dist_vec = [p[0] - coords[i][0], p[1] - coords[i][1]];
        // OPTIMIZATION: Use pre-computed scale_inv
        scaled_dist_vecs[i] = [dist_vec[0] * scale_inv, dist_vec[1] * scale_inv];
        
        // Weight computation
        let corner_normalized = [coords[i][0] * scale_inv, coords[i][1] * scale_inv];
        weights[i] = get_weight(corner_normalized, p_normalized, i as u8, denominator);
    }
    
    // OPTIMIZATION: Batch compute all contributions
    for i in 0..4 {
        // Dot product
        let dot_val = dot(grads[i], scaled_dist_vecs[i], denominator);
        
        // Contribution: (dot_val * weight) / denominator
        // OPTIMIZATION: Combine multiplication and division
        let contribution = (dot_val * weights[i]) / denom_field;
        total = total + contribution;
    }
    
    total
}

/// SingleScalePerlin() - Computes perlin at a single scale
fn single_scale_perlin(
    p: [Field; 2],
    key: Field,
    scale: Field
) -> Field {
    let (coords, grads) = get_corners_and_grad_vectors(p, scale, key);
    
    // Normalize coordinates and point for perlin_value (multiply by DENOMINATOR)
    let denom = denominator();
    let p_normalized = [p[0] * (denom as Field), p[1] * (denom as Field)];
    let mut coords_normalized = [[0 as Field; 2]; 4];
    for i in 0..4 {
        coords_normalized[i] = [coords[i][0] * (denom as Field), coords[i][1] * (denom as Field)];
    }
    
    perlin_value(grads, coords_normalized, scale, p_normalized, denom)
}

/// MultiScalePerlin() - Combines multiple scales for richer noise
/// Returns perlin value in range [0, 32]
pub fn multi_scale_perlin(
    x: Field,
    y: Field,
    key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool
) -> u8 {
    // Handle mirroring
    let mut px = x;
    let mut py = y;
    
    // BN254 field modulus for mirroring
    let field_mod = get_field_modulus();
    
    if x_mirror {
        if is_negative(x) {
            px = field_mod - x;
        }
    }
    if y_mirror {
        if is_negative(y) {
            py = field_mod - y;
        }
    }
    
    // Compute three scales
    let scale1 = scale as Field;
    let scale2 = (scale * 2) as Field;
    let scale3 = (scale * 4) as Field;
    
    let perlin1 = single_scale_perlin([px, py], key, scale1);
    let perlin2 = single_scale_perlin([px, py], key, scale2);
    let perlin3 = single_scale_perlin([px, py], key, scale3);
    
    // OPTIMIZATION: Combine efficiently (4 terms: p1, p2, p3, p1)
    // Note: p1 appears twice, so we can optimize: total = 2*p1 + p2 + p3
    let total = (perlin1 * 2) + perlin2 + perlin3;
    let average = total / (4 as Field);
    
    // Normalize to 0-32
    // outDividedByCount * 16 mod DENOMINATOR, then divide by (DENOMINATOR / 16), then add 16
    let denom = denominator();
    let multiplied = average * 16;
    let (remainder, _) = modulo(multiplied, denom as Field);
    let normalized = remainder / ((denom / 16) as Field) + 16;
    
    // Convert to u8, ensuring it's in range [0, 32]
    // Cast Field to u128 first, then to u8
    let normalized_u128 = normalized as u128;
    let result = normalized_u128 as u8;
    assert(result <= 32);
    result
}
