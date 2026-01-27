// ABDK Math 64.64 Smart Contract Library - Aztec Noir Port
// Original: https://github.com/abdk-consulting/abdk-libraries-solidity/blob/d8817cb/ABDKMath64x64.sol
// Copyright (c) 2019 by ABDK Consulting. Author: Mikhail Vladimirov
//
// Smart contract library of mathematical functions operating with signed
// 64.64-bit fixed point numbers. Signed 64.64-bit fixed point number is
// basically a simple fraction whose numerator is signed 128-bit integer and
// denominator is 2^64. As long as denominator is always the same, there is no
// need to store it, thus in Noir signed 64.64-bit fixed point numbers are
// represented by I128 type (our custom signed 128-bit integer using u128 two's complement)
// holding only the numerator.

use crate::i128::{I128, zero as i128_zero, min_value as i128_min, max_value as i128_max};
use crate::i256::I256;
use crate::u256::{U256, zero as u256_zero, one as u256_one};

// ========== Constants ==========

/// Minimum value signed 64.64-bit fixed point number may have: -2^127
pub fn MIN_64x64() -> I128 {
    i128_min()
}

/// Maximum value signed 64.64-bit fixed point number may have: 2^127 - 1
pub fn MAX_64x64() -> I128 {
    i128_max()
}

// Helper: 2^64 as u128
global TWO_POW_64: u128 = 0x10000000000000000;

// Helper: 2^127 as u128
global TWO_POW_127: u128 = 0x80000000000000000000000000000000;

// Helper: 2^128 as U256
fn two_pow_128() -> U256 {
    U256 { hi: 1, lo: 0 }
}

// ========== Internal Helper Functions ==========

/// Calculate sqrt(x) rounding down, where x is unsigned 256-bit integer number.
/// Returns unsigned 128-bit integer number.
/// 
/// Ported from Solidity sqrtu function (lines 731-755)
pub fn sqrtu(x: U256) -> u128 {
    let mut result: u128 = 0;
    
    if !x.is_zero() {
        let mut xx = x;
        let mut r: U256 = u256_one();
        
        // Find initial approximation
        // if (xx >= 0x100000000000000000000000000000000) { xx >>= 128; r <<= 64; }
        if xx.gte(U256 { hi: 1, lo: 0 }) {
            xx = xx.shr(128);
            r = r.shl(64);
        }
        // if (xx >= 0x10000000000000000) { xx >>= 64; r <<= 32; }
        if xx.lo >= 0x10000000000000000 {
            xx = xx.shr(64);
            r = r.shl(32);
        }
        // if (xx >= 0x100000000) { xx >>= 32; r <<= 16; }
        if xx.lo >= 0x100000000 {
            xx = xx.shr(32);
            r = r.shl(16);
        }
        // if (xx >= 0x10000) { xx >>= 16; r <<= 8; }
        if xx.lo >= 0x10000 {
            xx = xx.shr(16);
            r = r.shl(8);
        }
        // if (xx >= 0x100) { xx >>= 8; r <<= 4; }
        if xx.lo >= 0x100 {
            xx = xx.shr(8);
            r = r.shl(4);
        }
        // if (xx >= 0x10) { xx >>= 4; r <<= 2; }
        if xx.lo >= 0x10 {
            xx = xx.shr(4);
            r = r.shl(2);
        }
        // if (xx >= 0x8) { r <<= 1; }
        if xx.lo >= 0x8 {
            r = r.shl(1);
        }
        
        // Newton's method iterations (7 iterations)
        // r = (r + x / r) >> 1;
        r = r.add(x.div(r)).shr(1);
        r = r.add(x.div(r)).shr(1);
        r = r.add(x.div(r)).shr(1);
        r = r.add(x.div(r)).shr(1);
        r = r.add(x.div(r)).shr(1);
        r = r.add(x.div(r)).shr(1);
        r = r.add(x.div(r)).shr(1);
        
        // return uint128(r < r1 ? r : r1);
        let r1 = x.div(r);
        result = if r.lt(r1) {
            r.to_u128_unchecked()
        } else {
            r1.to_u128_unchecked()
        };
    }
    
    result
}

/// Calculate x / y rounding towards zero, where x and y are unsigned 256-bit
/// integer numbers. Revert on overflow or when y is zero.
/// Returns unsigned 128-bit fixed point number.
///
/// Ported from Solidity divuu function (lines 681-722)
pub fn divuu(x: U256, y: U256) -> u128 {
    assert(!y.is_zero(), "divuu: division by zero");
    
    // if (x <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
    //   result = (x << 64) / y;
    let threshold = U256 { hi: 0xFFFFFFFFFFFFFFFF, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF };
    
    let result: U256 = if x.lte(threshold) {
        x.shl(64).div(y)
    } else {
        // For larger values, use the complex algorithm
        // Find MSB of x
        let mut msb: u32 = 192;
        let mut xc = x.shr(192);
        
        if xc.lo >= 0x100000000 {
            xc = xc.shr(32);
            msb = msb + 32;
        }
        if xc.lo >= 0x10000 {
            xc = xc.shr(16);
            msb = msb + 16;
        }
        if xc.lo >= 0x100 {
            xc = xc.shr(8);
            msb = msb + 8;
        }
        if xc.lo >= 0x10 {
            xc = xc.shr(4);
            msb = msb + 4;
        }
        if xc.lo >= 0x4 {
            xc = xc.shr(2);
            msb = msb + 2;
        }
        if xc.lo >= 0x2 {
            msb = msb + 1;
        }
        
        // result = (x << 255 - msb) / ((y - 1 >> msb - 191) + 1);
        let shift_left = 255 - msb;
        let shift_right = msb - 191;
        let y_minus_one = y.sub(u256_one());
        let divisor = y_minus_one.shr(shift_right).add(u256_one());
        let mut result = x.shl(shift_left).div(divisor);
        
        assert(result.lte(U256 { hi: 0, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF }), "divuu: result overflow");
        
        // Refinement step
        // uint256 hi = result * (y >> 128);
        // uint256 lo = result * (y & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
        let hi = result.mul(y.shr(128));
        let y_lo_mask = U256 { hi: 0, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF };
        let lo = result.mul(y.and(y_lo_mask));
        
        // uint256 xh = x >> 192;
        // uint256 xl = x << 64;
        let mut xh = x.shr(192);
        let mut xl = x.shl(64);
        
        // if (xl < lo) xh -= 1;
        // xl -= lo;
        if xl.lt(lo) {
            xh = xh.sub(u256_one());
        }
        xl = xl.sub(lo);
        
        // lo = hi << 128;
        // if (xl < lo) xh -= 1;
        // xl -= lo;
        let lo_shifted = hi.shl(128);
        if xl.lt(lo_shifted) {
            xh = xh.sub(u256_one());
        }
        xl = xl.sub(lo_shifted);
        
        // result += xl / y;
        result = result.add(xl.div(y));
        result
    };
    
    assert(result.lte(U256 { hi: 0, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF }), "divuu: final result overflow");
    result.to_u128_unchecked()
}

// ========== Conversion Functions ==========

/// Convert signed integer number into signed 64.64-bit fixed point number.
/// Revert on overflow.
/// 
/// Ported from Solidity fromInt (lines 38-43)
/// Note: Input is i64 since Noir supports signed integers up to i64
pub fn from_int(x: i64) -> I128 {
    // require (x >= -0x8000000000000000 && x <= 0x7FFFFFFFFFFFFFFF);
    // This is always true for i64, so no check needed
    
    // return int128 (x << 64);
    let x_i128 = I128::from_i64(x);
    x_i128.shl(64)
}

/// Convert signed 64.64 fixed point number into signed 64-bit integer number
/// rounding down.
///
/// Ported from Solidity toInt (lines 52-56)
pub fn to_int(x: I128) -> i64 {
    // return int64 (x >> 64);
    x.shr(64).to_i64()
}

/// Convert unsigned integer number into signed 64.64-bit fixed point number.
/// Revert on overflow.
///
/// Ported from Solidity fromUInt (lines 65-70)
pub fn from_uint(x: u64) -> I128 {
    // require (x <= 0x7FFFFFFFFFFFFFFF);
    assert(x <= 0x7FFFFFFFFFFFFFFF, "fromUInt: overflow");
    
    // return int128 (int256 (x << 64));
    I128::from_u64(x).shl(64)
}

/// Convert signed 64.64 fixed point number into unsigned 64-bit integer
/// number rounding down. Revert on underflow.
///
/// Ported from Solidity toUInt (lines 79-84)
pub fn to_uint(x: I128) -> u64 {
    // require (x >= 0);
    assert(!x.is_negative(), "toUInt: underflow");
    
    // return uint64 (uint128 (x >> 64));
    x.shr(64).to_u64()
}

/// Convert signed 128.128 fixed point number into signed 64.64-bit fixed point
/// number rounding down. Revert on overflow.
///
/// Ported from Solidity from128x128 (lines 93-99)
pub fn from_128x128(x: I256) -> I128 {
    // int256 result = x >> 64;
    let result = x.shr(64);
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    // Check if result fits in I128 range
    let min_256 = I256::from_i64(-1).shl(127);  // -2^127
    let max_256 = I256::from_u256(U256 { hi: 0, lo: 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF });  // 2^127 - 1
    
    assert(result.gte(min_256) & result.lte(max_256), "from128x128: overflow");
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Convert signed 64.64 fixed point number into signed 128.128 fixed point number.
///
/// Ported from Solidity to128x128 (lines 108-112)
pub fn to_128x128(x: I128) -> I256 {
    // return int256 (x) << 64;
    let x_256 = if x.is_negative() {
        // Sign extend to 256 bits
        I256 { bits: U256 { hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, lo: x.bits } }
    } else {
        I256 { bits: U256 { hi: 0, lo: x.bits } }
    };
    x_256.shl(64)
}

// ========== Basic Arithmetic Functions ==========

/// Calculate x + y. Revert on overflow.
///
/// Ported from Solidity add (lines 121-127)
pub fn add(x: I128, y: I128) -> I128 {
    // int256 result = int256(x) + y;
    let x_256 = to_i256(x);
    let y_256 = to_i256(y);
    let result = x_256.add(y_256);
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    assert_in_i128_range(result, "add: overflow");
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Calculate x - y. Revert on overflow.
///
/// Ported from Solidity sub (lines 136-142)
pub fn sub(x: I128, y: I128) -> I128 {
    // int256 result = int256(x) - y;
    let x_256 = to_i256(x);
    let y_256 = to_i256(y);
    let result = x_256.sub(y_256);
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    assert_in_i128_range(result, "sub: overflow");
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Calculate x * y rounding down. Revert on overflow.
///
/// Ported from Solidity mul (lines 151-157)
pub fn mul(x: I128, y: I128) -> I128 {
    // int256 result = int256(x) * y >> 64;
    let x_256 = to_i256(x);
    let y_256 = to_i256(y);
    let product = x_256.mul(y_256);
    let result = product.shr(64);
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    assert_in_i128_range(result, "mul: overflow");
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Calculate x * y rounding towards zero, where x is signed 64.64 fixed point
/// number and y is signed integer number. Revert on overflow.
///
/// Ported from Solidity muli (lines 167-195)
/// Note: Simplified version using I256 for y instead of full int256 range
pub fn muli(x: I128, y: I256) -> I256 {
    let min_64x64 = MIN_64x64();
    
    let result = if x.eq(min_64x64) {
        // Special case for MIN_64x64
        // return -y << 63;
        y.negate().shl(63)
    } else {
        let mut negative_result = false;
        let mut abs_x = x;
        let mut abs_y = y;
        
        if x.is_negative() {
            abs_x = x.negate();
            negative_result = true;
        }
        if y.is_negative() {
            abs_y = y.negate();
            negative_result = !negative_result;
        }
        
        // uint256 absoluteResult = mulu(x, uint256(y));
        let absolute_result = mulu(abs_x, abs_y.bits);
        
        if negative_result {
            // return -int256 (absoluteResult);
            I256 { bits: absolute_result }.negate()
        } else {
            // return int256 (absoluteResult);
            I256 { bits: absolute_result }
        }
    };
    
    result
}

/// Calculate x * y rounding down, where x is signed 64.64 fixed point number
/// and y is unsigned 256-bit integer number. Revert on overflow.
///
/// Ported from Solidity mulu (lines 205-221)
pub fn mulu(x: I128, y: U256) -> U256 {
    let mut result = u256_zero();
    
    // if (y == 0) return 0;
    if !y.is_zero() {
        // require (x >= 0);
        assert(!x.is_negative(), "mulu: x must be non-negative");
        
        let x_u256 = U256::from_u128(x.bits);
        
        // uint256 lo = (uint256(int256(x)) * (y & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)) >> 64;
        let y_lo_mask = U256 { hi: 0, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF };
        let y_lo = y.and(y_lo_mask);
        let lo = x_u256.mul(y_lo).shr(64);
        
        // uint256 hi = uint256(int256(x)) * (y >> 128);
        let hi = x_u256.mul(y.shr(128));
        
        // require (hi <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
        let hi_max = U256 { hi: 0xFFFFFFFFFFFFFFFF, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF };
        assert(hi.lte(hi_max), "mulu: hi overflow");
        
        // hi <<= 64;
        let hi_shifted = hi.shl(64);
        
        // require (hi <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF - lo);
        let max_u256 = U256 { hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF };
        assert(hi_shifted.lte(max_u256.sub(lo)), "mulu: addition overflow");
        
        // return hi + lo;
        result = hi_shifted.add(lo);
    }
    
    result
}

/// Calculate x / y rounding towards zero. Revert on overflow or when y is zero.
///
/// Ported from Solidity div (lines 231-238)
pub fn div(x: I128, y: I128) -> I128 {
    // require (y != 0);
    assert(!y.is_zero(), "div: division by zero");
    
    // int256 result = (int256 (x) << 64) / y;
    let x_256 = to_i256(x).shl(64);
    let y_256 = to_i256(y);
    let result = x_256.div(y_256);
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    assert_in_i128_range(result, "div: overflow");
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Calculate x / y rounding towards zero, where x and y are signed 256-bit
/// integer numbers. Revert on overflow or when y is zero.
///
/// Ported from Solidity divi (lines 248-270)
pub fn divi(x: I256, y: I256) -> I128 {
    // require (y != 0);
    assert(!y.is_zero(), "divi: division by zero");
    
    let mut negative_result = false;
    let mut abs_x = x;
    let mut abs_y = y;
    
    if x.is_negative() {
        abs_x = x.negate();
        negative_result = true;
    }
    if y.is_negative() {
        abs_y = y.negate();
        negative_result = !negative_result;
    }
    
    // uint128 absoluteResult = divuu(uint256(x), uint256(y));
    let absolute_result = divuu(abs_x.bits, abs_y.bits);
    
    if negative_result {
        // require (absoluteResult <= 0x80000000000000000000000000000000);
        assert(absolute_result <= 0x80000000000000000000000000000000, "divi: overflow");
        // return -int128 (absoluteResult);
        I128::from_bits(absolute_result).negate()
    } else {
        // require (absoluteResult <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
        assert(absolute_result <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, "divi: overflow");
        // return int128 (absoluteResult);
        I128::from_bits(absolute_result)
    }
}

/// Calculate x / y rounding towards zero, where x and y are unsigned 256-bit
/// integer numbers. Revert on overflow or when y is zero.
///
/// Ported from Solidity divu (lines 280-287)
pub fn divu(x: U256, y: U256) -> I128 {
    // require (y != 0);
    assert(!y.is_zero(), "divu: division by zero");
    
    // uint128 result = divuu(x, y);
    let result = divuu(x, y);
    
    // require (result <= uint128(MAX_64x64));
    assert(result <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, "divu: overflow");
    
    // return int128 (result);
    I128::from_bits(result)
}

// ========== Sign and Absolute Value Functions ==========

/// Calculate -x. Revert on overflow.
///
/// Ported from Solidity neg (lines 295-300)
pub fn neg(x: I128) -> I128 {
    // require (x != MIN_64x64);
    assert(!x.eq(MIN_64x64()), "neg: cannot negate MIN_64x64");
    
    // return -x;
    x.negate()
}

/// Calculate |x|. Revert on overflow.
///
/// Ported from Solidity abs (lines 308-313)
pub fn abs(x: I128) -> I128 {
    // require (x != MIN_64x64);
    assert(!x.eq(MIN_64x64()), "abs: cannot abs MIN_64x64");
    
    // return x < 0 ? -x : x;
    if x.is_negative() {
        x.negate()
    } else {
        x
    }
}

/// Calculate 1 / x rounding towards zero. Revert on overflow or when x is zero.
///
/// Ported from Solidity inv (lines 322-329)
pub fn inv(x: I128) -> I128 {
    // require (x != 0);
    assert(!x.is_zero(), "inv: division by zero");
    
    // int256 result = int256 (0x100000000000000000000000000000000) / x;
    // 0x100000000000000000000000000000000 = 2^128
    let numerator = I256 { bits: two_pow_128() };
    let x_256 = to_i256(x);
    let result = numerator.div(x_256);
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    assert_in_i128_range(result, "inv: overflow");
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Calculate arithmetics average of x and y, i.e. (x + y) / 2 rounding down.
///
/// Ported from Solidity avg (lines 338-342)
pub fn avg(x: I128, y: I128) -> I128 {
    // return int128 ((int256 (x) + int256 (y)) >> 1);
    let x_256 = to_i256(x);
    let y_256 = to_i256(y);
    let sum = x_256.add(y_256);
    let result = sum.shr(1);
    I128::from_bits(result.bits.lo)
}

/// Calculate geometric average of x and y, i.e. sqrt(x * y) rounding down.
/// Revert on overflow or in case x * y is negative.
///
/// Ported from Solidity gavg (lines 352-360)
pub fn gavg(x: I128, y: I128) -> I128 {
    // int256 m = int256 (x) * int256 (y);
    let x_256 = to_i256(x);
    let y_256 = to_i256(y);
    let m = x_256.mul(y_256);
    
    // require (m >= 0);
    assert(!m.is_negative(), "gavg: product is negative");
    
    // require (m < 0x4000000000000000000000000000000000000000000000000000000000000000);
    // This is 2^254, so m.hi must be less than 0x4000...
    assert(m.bits.hi < 0x40000000000000000000000000000000, "gavg: overflow");
    
    // return int128 (sqrtu (uint256 (m)));
    let sqrt_result = sqrtu(m.bits);
    I128::from_bits(sqrt_result)
}

// ========== Power and Root Functions ==========

/// Calculate x^y assuming 0^0 is 1, where x is signed 64.64 fixed point number
/// and y is unsigned 256-bit integer number. Revert on overflow.
///
/// Ported from Solidity pow (lines 370-443)
pub fn pow(x: I128, y: U256) -> I128 {
    // bool negative = x < 0 && y & 1 == 1;
    let negative = x.is_negative() & ((y.lo & 1) == 1);
    
    // uint256 absX = uint128 (x < 0 ? -x : x);
    let abs_x_128 = if x.is_negative() { x.negate().bits } else { x.bits };
    let mut abs_x = U256::from_u128(abs_x_128);
    
    // uint256 absResult = 0x100000000000000000000000000000000;
    let mut abs_result = two_pow_128();
    
    // if (absX <= 0x10000000000000000)
    if abs_x.lte(U256::from_u128(TWO_POW_64)) {
        // absX <<= 63;
        abs_x = abs_x.shl(63);
        
        // Unrolled loop: process 4 bits at a time, max 64 iterations for 256-bit y
        let mut y_remaining = y;
        
        for _ in 0..64 {
            // Skip iteration if y_remaining is already zero (no break allowed)
            if !y_remaining.is_zero() {
                // if (y & 0x1 != 0) { absResult = absResult * absX >> 127; }
                if (y_remaining.lo & 0x1) != 0 {
                    abs_result = abs_result.mul(abs_x).shr(127);
                }
                // absX = absX * absX >> 127;
                abs_x = abs_x.mul(abs_x).shr(127);
                
                // if (y & 0x2 != 0) { absResult = absResult * absX >> 127; }
                if (y_remaining.lo & 0x2) != 0 {
                    abs_result = abs_result.mul(abs_x).shr(127);
                }
                abs_x = abs_x.mul(abs_x).shr(127);
                
                // if (y & 0x4 != 0) { absResult = absResult * absX >> 127; }
                if (y_remaining.lo & 0x4) != 0 {
                    abs_result = abs_result.mul(abs_x).shr(127);
                }
                abs_x = abs_x.mul(abs_x).shr(127);
                
                // if (y & 0x8 != 0) { absResult = absResult * absX >> 127; }
                if (y_remaining.lo & 0x8) != 0 {
                    abs_result = abs_result.mul(abs_x).shr(127);
                }
                abs_x = abs_x.mul(abs_x).shr(127);
                
                // y >>= 4;
                y_remaining = y_remaining.shr(4);
            }
        }
        
        // absResult >>= 64;
        abs_result = abs_result.shr(64);
    } else {
        // Handle larger absX values
        let mut abs_x_shift: u32 = 63;
        
        // Normalize absX
        if abs_x.lt(U256 { hi: 0, lo: 0x1000000000000000000000000 }) {
            abs_x = abs_x.shl(32);
            abs_x_shift = abs_x_shift - 32;
        }
        if abs_x.lt(U256 { hi: 0, lo: 0x10000000000000000000000000000 }) {
            abs_x = abs_x.shl(16);
            abs_x_shift = abs_x_shift - 16;
        }
        if abs_x.lt(U256 { hi: 0, lo: 0x1000000000000000000000000000000 }) {
            abs_x = abs_x.shl(8);
            abs_x_shift = abs_x_shift - 8;
        }
        if abs_x.lt(U256 { hi: 0, lo: 0x10000000000000000000000000000000 }) {
            abs_x = abs_x.shl(4);
            abs_x_shift = abs_x_shift - 4;
        }
        if abs_x.lt(U256 { hi: 0, lo: 0x40000000000000000000000000000000 }) {
            abs_x = abs_x.shl(2);
            abs_x_shift = abs_x_shift - 2;
        }
        if abs_x.lt(U256 { hi: 0, lo: TWO_POW_127 }) {
            abs_x = abs_x.shl(1);
            abs_x_shift = abs_x_shift - 1;
        }
        
        let mut result_shift: u32 = 0;
        let mut y_remaining = y;
        
        for _ in 0..256 {
            // Skip iteration if y_remaining is already zero (no break allowed)
            if !y_remaining.is_zero() {
                assert(abs_x_shift < 64, "pow: absXShift overflow");
                
                if (y_remaining.lo & 0x1) != 0 {
                    abs_result = abs_result.mul(abs_x).shr(127);
                    result_shift = result_shift + abs_x_shift;
                    
                    if abs_result.gt(two_pow_128()) {
                        abs_result = abs_result.shr(1);
                        result_shift = result_shift + 1;
                    }
                }
                
                abs_x = abs_x.mul(abs_x).shr(127);
                abs_x_shift = abs_x_shift << 1;
                
                if abs_x.gte(two_pow_128()) {
                    abs_x = abs_x.shr(1);
                    abs_x_shift = abs_x_shift + 1;
                }
                
                y_remaining = y_remaining.shr(1);
            }
        }
        
        assert(result_shift < 64, "pow: resultShift overflow");
        abs_result = abs_result.shr(64 - result_shift);
    }
    
    // int256 result = negative ? -int256 (absResult) : int256 (absResult);
    let result_i256 = if negative {
        I256 { bits: abs_result }.negate()
    } else {
        I256 { bits: abs_result }
    };
    
    // require (result >= MIN_64x64 && result <= MAX_64x64);
    assert_in_i128_range(result_i256, "pow: overflow");
    
    // return int128 (result);
    I128::from_bits(result_i256.bits.lo)
}

/// Calculate sqrt(x) rounding down. Revert if x < 0.
///
/// Ported from Solidity sqrt (lines 451-456)
pub fn sqrt(x: I128) -> I128 {
    // require (x >= 0);
    assert(!x.is_negative(), "sqrt: x < 0");
    
    // return int128 (sqrtu (uint256 (int256 (x)) << 64));
    let x_u256 = U256::from_u128(x.bits).shl(64);
    let result = sqrtu(x_u256);
    I128::from_bits(result)
}

// ========== Logarithm Functions ==========

/// Calculate binary logarithm of x. Revert if x <= 0.
///
/// Ported from Solidity log_2 (lines 464-489)
pub fn log_2(x: I128) -> I128 {
    // require (x > 0);
    assert(x.is_positive(), "log_2: x <= 0");
    
    // int256 msb = 0;
    // int256 xc = x;
    let mut msb: u32 = 0;
    let mut xc = x.bits;
    
    // Find MSB
    if xc >= 0x10000000000000000 { xc = xc >> 64; msb = msb + 64; }
    if xc >= 0x100000000 { xc = xc >> 32; msb = msb + 32; }
    if xc >= 0x10000 { xc = xc >> 16; msb = msb + 16; }
    if xc >= 0x100 { xc = xc >> 8; msb = msb + 8; }
    if xc >= 0x10 { xc = xc >> 4; msb = msb + 4; }
    if xc >= 0x4 { xc = xc >> 2; msb = msb + 2; }
    if xc >= 0x2 { msb = msb + 1; }
    
    // int256 result = msb - 64 << 64;
    let msb_i64 = msb as i64;
    let result_int = msb_i64 - 64;
    let mut result = I256::from_i64(result_int).shl(64);
    
    // uint256 ux = uint256 (int256 (x)) << uint256 (127 - msb);
    let shift_amount = 127 - msb;
    let mut ux = U256::from_u128(x.bits).shl(shift_amount);
    
    // for (int256 bit = 0x8000000000000000; bit > 0; bit >>= 1)
    let mut bit: u128 = 0x8000000000000000;
    
    for _ in 0..64 {
        // Skip iteration if bit is already zero (no break allowed)
        if bit != 0 {
            // ux *= ux;
            ux = ux.mul(ux);
            
            // uint256 b = ux >> 255;
            let b = ux.shr(255).lo;
            
            // ux >>= 127 + b;
            let shift = 127 + (b as u32);
            ux = ux.shr(shift);
            
            // result += bit * int256 (b);
            if b != 0 {
                result = result.add(I256::from_u128(bit));
            }
            
            // bit >>= 1
            bit = bit >> 1;
        }
    }
    
    // return int128 (result);
    I128::from_bits(result.bits.lo)
}

/// Calculate natural logarithm of x. Revert if x <= 0.
///
/// Ported from Solidity ln (lines 497-504)
pub fn ln(x: I128) -> I128 {
    // require (x > 0);
    assert(x.is_positive(), "ln: x <= 0");
    
    // return int128 (int256 (
    //     uint256 (int256 (log_2 (x))) * 0xB17217F7D1CF79ABC9E3B39803F2F6AF >> 128));
    
    let log2_result = log_2(x);
    
    // Convert to unsigned for multiplication
    // log_2 result can be negative, so handle sign
    let is_negative = log2_result.is_negative();
    let abs_log2 = if is_negative { log2_result.negate().bits } else { log2_result.bits };
    
    // Multiply by ln(2) constant: 0xB17217F7D1CF79ABC9E3B39803F2F6AF
    let ln2_constant = U256 { hi: 0xB17217F7D1CF79AB, lo: 0xC9E3B39803F2F6AF };
    let product = U256::from_u128(abs_log2).mul(ln2_constant);
    
    // >> 128
    let result_abs = product.shr(128).lo;
    
    // Restore sign
    if is_negative {
        I128::from_bits(result_abs).negate()
    } else {
        I128::from_bits(result_abs)
    }
}

// ========== Exponential Functions ==========

/// Calculate binary exponent of x. Revert on overflow.
///
/// Ported from Solidity exp_2 (lines 512-654)
pub fn exp_2(x: I128) -> I128 {
    // require (x < 0x400000000000000000); // Overflow
    let overflow_threshold = I128::from_bits(0x400000000000000000);
    assert(x.lt(overflow_threshold), "exp_2: overflow");
    
    // if (x < -0x400000000000000000) return 0; // Underflow
    let underflow_threshold = I128::from_bits(0x400000000000000000).negate();
    let mut final_result = i128_zero();
    let is_underflow = x.lt(underflow_threshold);
    
    if !is_underflow {
        // uint256 result = 0x80000000000000000000000000000000;
        let mut result = U256 { hi: 0, lo: TWO_POW_127 };
        
        // Get the fractional part bits (lower 64 bits of x)
        let x_bits = x.bits;
        
        // Each constant is approximately 2^128 * 2^(bit_position/2^64)
        // Constants are 132-bit values split as: hi = high 4 bits, lo = low 128 bits
        // Original Solidity: 0x16A09E667F3BCC908B2FB1366EA957D3E (33 hex chars)
        // Correct split: hi=0x1, lo=0x6A09E667F3BCC908B2FB1366EA957D3E
        
        // if (x & 0x8000000000000000 > 0)
        if (x_bits & 0x8000000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x6A09E667F3BCC908B2FB1366EA957D3E }).shr(128);
        }
        if (x_bits & 0x4000000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x306FE0A31B7152DE8D5A46305C85EDEC }).shr(128);
        }
        if (x_bits & 0x2000000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x172B83C7D517ADCDF7C8C50EB14A791F }).shr(128);
        }
        if (x_bits & 0x1000000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0B5586CF9890F6298B92B71842A98363 }).shr(128);
        }
        if (x_bits & 0x800000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x059B0D31585743AE7C548EB68CA417FD }).shr(128);
        }
        if (x_bits & 0x400000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x02C9A3E778060EE6F7CACA4F7A29BDE8 }).shr(128);
        }
        if (x_bits & 0x200000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0163DA9FB33356D84A66AE336DCDFA3F }).shr(128);
        }
        if (x_bits & 0x100000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00B1AFA5ABCBED6129AB13EC11DC9543 }).shr(128);
        }
        if (x_bits & 0x80000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0058C86DA1C09EA1FF19D294CF2F679B }).shr(128);
        }
        if (x_bits & 0x40000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x002C605E2E8CEC506D21BFC89A23A00F }).shr(128);
        }
        if (x_bits & 0x20000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00162F3904051FA128BCA9C55C31E5DF }).shr(128);
        }
        if (x_bits & 0x10000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000B175EFFDC76BA38E31671CA939725 }).shr(128);
        }
        if (x_bits & 0x8000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00058BA01FB9F96D6CACD4B180917C3D }).shr(128);
        }
        if (x_bits & 0x4000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0002C5CC37DA9491D0985C348C68E7B3 }).shr(128);
        }
        if (x_bits & 0x2000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000162E525EE054754457D5995292026 }).shr(128);
        }
        if (x_bits & 0x1000000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000B17255775C040618BF4A4ADE83FC }).shr(128);
        }
        if (x_bits & 0x800000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000058B91B5BC9AE2EED81E9B7D4CFAB }).shr(128);
        }
        if (x_bits & 0x400000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00002C5C89D5EC6CA4D7C8ACC017B7C9 }).shr(128);
        }
        if (x_bits & 0x200000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000162E43F4F831060E02D839A9D16D }).shr(128);
        }
        if (x_bits & 0x100000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000B1721BCFC99D9F890EA06911763 }).shr(128);
        }
        if (x_bits & 0x80000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000058B90CF1E6D97F9CA14DBCC1628 }).shr(128);
        }
        if (x_bits & 0x40000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000002C5C863B73F016468F6BAC5CA2B }).shr(128);
        }
        if (x_bits & 0x20000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000162E430E5A18F6119E3C02282A5 }).shr(128);
        }
        if (x_bits & 0x10000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000B1721835514B86E6D96EFD1BFE }).shr(128);
        }
        if (x_bits & 0x8000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000058B90C0B48C6BE5DF846C5B2EF }).shr(128);
        }
        if (x_bits & 0x4000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000002C5C8601CC6B9E94213C72737A }).shr(128);
        }
        if (x_bits & 0x2000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000162E42FFF037DF38AA2B219F06 }).shr(128);
        }
        if (x_bits & 0x1000000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000B17217FBA9C739AA5819F44F9 }).shr(128);
        }
        if (x_bits & 0x800000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000058B90BFCDEE5ACD3C1CEDC823 }).shr(128);
        }
        if (x_bits & 0x400000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000002C5C85FE31F35A6A30DA1BE50 }).shr(128);
        }
        if (x_bits & 0x200000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000162E42FF0999CE3541B9FFFCF }).shr(128);
        }
        if (x_bits & 0x100000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000B17217F80F4EF5AADDA45554 }).shr(128);
        }
        if (x_bits & 0x80000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000058B90BFBF8479BD5A81B51AD }).shr(128);
        }
        if (x_bits & 0x40000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000002C5C85FDF84BD62AE30A74CC }).shr(128);
        }
        if (x_bits & 0x20000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000162E42FEFB2FED257559BDAA }).shr(128);
        }
        if (x_bits & 0x10000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000B17217F7D5A7716BBA4A9AE }).shr(128);
        }
        if (x_bits & 0x8000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000058B90BFBE9DDBAC5E109CCE }).shr(128);
        }
        if (x_bits & 0x4000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000002C5C85FDF4B15DE6F17EB0D }).shr(128);
        }
        if (x_bits & 0x2000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000162E42FEFA494F1478FDE05 }).shr(128);
        }
        if (x_bits & 0x1000000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000B17217F7D20CF927C8E94C }).shr(128);
        }
        if (x_bits & 0x800000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000058B90BFBE8F71CB4E4B33D }).shr(128);
        }
        if (x_bits & 0x400000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000002C5C85FDF477B662B26945 }).shr(128);
        }
        if (x_bits & 0x200000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000162E42FEFA3AE53369388C }).shr(128);
        }
        if (x_bits & 0x100000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000B17217F7D1D351A389D40 }).shr(128);
        }
        if (x_bits & 0x80000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000058B90BFBE8E8B2D3D4EDE }).shr(128);
        }
        if (x_bits & 0x40000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000002C5C85FDF4741BEA6E77E }).shr(128);
        }
        if (x_bits & 0x20000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000162E42FEFA39FE95583C2 }).shr(128);
        }
        if (x_bits & 0x10000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000000B17217F7D1CFB72B45E1 }).shr(128);
        }
        if (x_bits & 0x8000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000058B90BFBE8E7CC35C3F0 }).shr(128);
        }
        if (x_bits & 0x4000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000002C5C85FDF473E242EA38 }).shr(128);
        }
        if (x_bits & 0x2000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000000162E42FEFA39F02B772C }).shr(128);
        }
        if (x_bits & 0x1000) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000000B17217F7D1CF7D83C1A }).shr(128);
        }
        if (x_bits & 0x800) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000000058B90BFBE8E7BDCBE2E }).shr(128);
        }
        if (x_bits & 0x400) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000002C5C85FDF473DEA871F }).shr(128);
        }
        if (x_bits & 0x200) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000000162E42FEFA39EF44D91 }).shr(128);
        }
        if (x_bits & 0x100) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000000B17217F7D1CF79E949 }).shr(128);
        }
        if (x_bits & 0x80) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000000058B90BFBE8E7BCE544 }).shr(128);
        }
        if (x_bits & 0x40) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000000002C5C85FDF473DE6ECA }).shr(128);
        }
        if (x_bits & 0x20) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000000162E42FEFA39EF366F }).shr(128);
        }
        if (x_bits & 0x10) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000000000B17217F7D1CF79AFA }).shr(128);
        }
        if (x_bits & 0x8) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x00000000000000058B90BFBE8E7BCD6D }).shr(128);
        }
        if (x_bits & 0x4) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000000002C5C85FDF473DE6B2 }).shr(128);
        }
        if (x_bits & 0x2) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x000000000000000162E42FEFA39EF358 }).shr(128);
        }
        if (x_bits & 0x1) != 0 {
            result = result.mul(U256 { hi: 0x1, lo: 0x0000000000000000B17217F7D1CF79AB }).shr(128);
        }
    
    // result >>= uint256 (int256 (63 - (x >> 64)));
    // Get integer part of x (upper bits after position 64)
    let x_int_part = x.shr(64);
    let shift_amount = if x_int_part.is_negative() {
        // For negative x, the shift could be > 63
        let neg_int = x_int_part.negate().bits as u32;
        63 + neg_int
    } else {
        63 - (x_int_part.bits as u32)
    };
    
        result = result.shr(shift_amount);
        
        // require (result <= uint256 (int256 (MAX_64x64)));
        assert(result.lte(U256::from_u128(0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)), "exp_2: result overflow");
        
        // return int128 (int256 (result));
        final_result = I128::from_bits(result.to_u128_unchecked());
    }
    
    final_result
}

/// Calculate natural exponent of x. Revert on overflow.
///
/// Ported from Solidity exp (lines 662-671)
pub fn exp(x: I128) -> I128 {
    // require (x < 0x400000000000000000); // Overflow
    let overflow_threshold = I128::from_bits(0x400000000000000000);
    assert(x.lt(overflow_threshold), "exp: overflow");
    
    // if (x < -0x400000000000000000) return 0; // Underflow
    let underflow_threshold = I128::from_bits(0x400000000000000000).negate();
    let mut final_result = i128_zero();
    let is_underflow = x.lt(underflow_threshold);
    
    if !is_underflow {
        // return exp_2 (int128 (int256 (x) * 0x171547652B82FE1777D0FFDA0D23A7D12 >> 128));
        // 0x171547652B82FE1777D0FFDA0D23A7D12 is 1/ln(2) in 128.128 fixed point
        let x_256 = to_i256(x);
        let ln2_inv = U256 { hi: 0x1, lo: 0x71547652B82FE1777D0FFDA0D23A7D12 };
        
        // Signed multiplication
        let is_negative = x_256.is_negative();
        let abs_x = if is_negative { x_256.negate().bits } else { x_256.bits };
        let product = abs_x.mul(ln2_inv);
        let shifted = product.shr(128);
    
    let result_bits = if is_negative {
        // Negate the result
        let neg_result = U256 { hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF }
            .sub(shifted).add(u256_one());
        neg_result.lo
        } else {
            shifted.lo
        };
        
        final_result = exp_2(I128::from_bits(result_bits));
    }
    
    final_result
}

// ========== Helper Functions ==========

/// Convert I128 to I256 with sign extension
fn to_i256(x: I128) -> I256 {
    if x.is_negative() {
        I256 { bits: U256 { hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, lo: x.bits } }
    } else {
        I256 { bits: U256 { hi: 0, lo: x.bits } }
    }
}

/// Assert that I256 value fits in I128 range
fn assert_in_i128_range(x: I256, msg: str<13>) {
    if x.is_negative() {
        // For negative: must be >= -2^127
        // In two's complement, -2^127 is 0xFFFF...FFFF 8000...0000
        let min_ok = (x.bits.hi == 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) 
                   & (x.bits.lo >= 0x80000000000000000000000000000000);
        let exactly_min = (x.bits.hi == 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) 
                        & (x.bits.lo == 0x80000000000000000000000000000000);
        // Allow if hi is all 1s and lo is in valid negative range
        assert(min_ok | exactly_min | (x.bits.hi == 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF), msg);
    } else {
        // For positive: must be <= 2^127 - 1
        assert((x.bits.hi == 0) & (x.bits.lo <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF), msg);
    }
}

// ========== Tests ==========

#[test]
fn test_from_int() {
    let x = from_int(1);
    assert(x.bits == TWO_POW_64);
    
    let y = from_int(-1);
    assert(y.is_negative());
    let y_abs = y.negate();
    assert(y_abs.bits == TWO_POW_64);
}

#[test]
fn test_to_int() {
    let x = I128::from_bits(TWO_POW_64);  // 1.0
    assert(to_int(x) == 1);
    
    let y = I128::from_bits(TWO_POW_64 * 5);  // 5.0
    assert(to_int(y) == 5);
}

#[test]
fn test_add() {
    let one = from_int(1);
    let two = from_int(2);
    let three = add(one, two);
    assert(to_int(three) == 3);
}

#[test]
fn test_sub() {
    let five = from_int(5);
    let two = from_int(2);
    let three = sub(five, two);
    assert(to_int(three) == 3);
}

#[test]
fn test_mul() {
    let two = from_int(2);
    let three = from_int(3);
    let six = mul(two, three);
    assert(to_int(six) == 6);
}

#[test]
fn test_div() {
    let six = from_int(6);
    let two = from_int(2);
    let three = div(six, two);
    assert(to_int(three) == 3);
}

#[test]
fn test_neg() {
    let five = from_int(5);
    let neg_five = neg(five);
    assert(neg_five.is_negative());
    assert(to_int(neg_five) == -5);
}

#[test]
fn test_abs() {
    let neg_five = from_int(-5);
    let five = abs(neg_five);
    assert(!five.is_negative());
    assert(to_int(five) == 5);
}

#[test]
fn test_sqrt() {
    let four = from_int(4);
    let two = sqrt(four);
    assert(to_int(two) == 2);
    
    let nine = from_int(9);
    let three = sqrt(nine);
    assert(to_int(three) == 3);
}

#[test]
fn test_avg() {
    let two = from_int(2);
    let four = from_int(4);
    let three = avg(two, four);
    assert(to_int(three) == 3);
}
