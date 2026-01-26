// ABDK Math 64.64 Smart Contract Library - Aztec Noir Port
// Original: https://github.com/abdk-consulting/abdk-libraries-solidity/blob/d8817cb/ABDKMath64x64.sol
// Copyright © 2019 by ABDK Consulting. Author: Mikhail Vladimirov
//
// Smart contract library of mathematical functions operating with signed
// 64.64-bit fixed point numbers. Signed 64.64-bit fixed point number is
// basically a simple fraction whose numerator is signed 128-bit integer and
// denominator is 2^64. As long as denominator is always the same, there is no
// need to store it, thus in Noir signed 64.64-bit fixed point numbers are
// represented by i128 type holding only the numerator.

// Constants
const MIN_64X64: i128 = -0x80000000000000000000000000000000;
const MAX_64X64: i128 = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

// ========== Conversion Functions ==========

/// Convert signed integer number into signed 64.64-bit fixed point number.
/// Revert on overflow.
/// Note: In Noir, we use i128 instead of int256, so the range is limited to 64-bit signed integer.
pub fn from_int(x: i128) -> i128 {
    assert(x >= -0x8000000000000000 && x <= 0x7FFFFFFFFFFFFFFF, "fromInt: overflow");
    x << 64
}

/// Convert signed 64.64 fixed point number into signed 64-bit integer number rounding down.
pub fn to_int(x: i128) -> i64 {
    (x >> 64) as i64
}

/// Convert unsigned 128-bit integer number into signed 64.64-bit fixed point number.
/// Revert on overflow.
pub fn from_uint(x: u128) -> i128 {
    assert(x <= 0x7FFFFFFFFFFFFFFF, "fromUInt: overflow");
    (x as i128) << 64
}

/// Convert signed 64.64 fixed point number into unsigned 64-bit integer number rounding down.
/// Revert on underflow.
pub fn to_uint(x: i128) -> u64 {
    assert(x >= 0, "toUInt: underflow");
    ((x >> 64) as u128) as u64
}

/// Convert signed 128.128 fixed point number into signed 64.64-bit fixed point number rounding down.
/// Revert on overflow.
/// Note: In Noir, we represent 128.128 as i128 (since we don't have int256).
/// This function assumes the input is already in the correct range.
pub fn from_128x128(x: i128) -> i128 {
    let result = x >> 64;
    assert(result >= MIN_64X64 && result <= MAX_64X64, "from128x128: overflow");
    result
}

/// Convert signed 64.64 fixed point number into signed 128.128 fixed point number.
/// Note: In Noir, we return i128 (since we don't have int256).
pub fn to_128x128(x: i128) -> i128 {
    x << 64
}

// ========== Arithmetic Functions ==========

/// Calculate x + y. Revert on overflow.
pub fn add(x: i128, y: i128) -> i128 {
    let result = x + y;
    assert(result >= MIN_64X64 && result <= MAX_64X64, "add: overflow");
    result
}

/// Calculate x - y. Revert on overflow.
pub fn sub(x: i128, y: i128) -> i128 {
    let result = x - y;
    assert(result >= MIN_64X64 && result <= MAX_64X64, "sub: overflow");
    result
}

/// Calculate x * y rounding down. Revert on overflow.
pub fn mul(x: i128, y: i128) -> i128 {
    let result = (x * y) >> 64;
    assert(result >= MIN_64X64 && result <= MAX_64X64, "mul: overflow");
    result
}

/// Calculate x * y rounding towards zero, where x is signed 64.64 fixed point number
/// and y is signed integer number. Revert on overflow.
/// Note: In Noir, we use i128 instead of int256 for y.
pub fn muli(x: i128, y: i128) -> i128 {
    if x == MIN_64X64 {
        // Special case: MIN_64X64 * y
        assert(y >= -0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF && y <= 0x100000000000000000000000000000000, "muli: y out of range");
        -(y << 63)
    } else {
        let mut negative_result = false;
        let mut abs_x = x;
        let mut abs_y = y;
        
        if x < 0 {
            abs_x = -x;
            negative_result = true;
        }
        if y < 0 {
            abs_y = -y;
            negative_result = !negative_result;
        }
        
        let absolute_result = mulu(abs_x, abs_y as u128);
        let result = if negative_result {
            -(absolute_result as i128)
        } else {
            absolute_result as i128
        };
        
        assert(result >= MIN_64X64 && result <= MAX_64X64, "muli: overflow");
        result
    }
}

/// Calculate x * y rounding down, where x is signed 64.64 fixed point number
/// and y is unsigned 128-bit integer number. Revert on overflow.
pub fn mulu(x: i128, y: u128) -> u128 {
    if y == 0 {
        return 0;
    }
    
    assert(x >= 0, "mulu: x must be non-negative");
    
    let lo = (((x as u128) * (y & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)) >> 64);
    let hi = (x as u128) * (y >> 128);
    
    assert(hi <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, "mulu: hi overflow");
    let hi_shifted = hi << 64;
    assert(hi_shifted <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF - lo, "mulu: addition overflow");
    hi_shifted + lo
}

/// Calculate x / y rounding towards zero. Revert on overflow or when y is zero.
pub fn div(x: i128, y: i128) -> i128 {
    assert(y != 0, "div: division by zero");
    let result = (x << 64) / y;
    assert(result >= MIN_64X64 && result <= MAX_64X64, "div: overflow");
    result
}

/// Calculate x / y rounding towards zero, where x and y are signed integers.
/// Revert on overflow or when y is zero.
/// Note: In Noir, we use i128 instead of int256.
pub fn divi(x: i128, y: i128) -> i128 {
    assert(y != 0, "divi: division by zero");
    
    let mut negative_result = false;
    let mut abs_x = x;
    let mut abs_y = y;
    
    if x < 0 {
        abs_x = -x;
        negative_result = true;
    }
    if y < 0 {
        abs_y = -y;
        negative_result = !negative_result;
    }
    
    let absolute_result = divuu(abs_x as u128, abs_y as u128);
    let result = if negative_result {
        assert(absolute_result <= 0x80000000000000000000000000000000, "divi: overflow");
        -(absolute_result as i128)
    } else {
        assert(absolute_result <= (MAX_64X64 as u128), "divi: overflow");
        absolute_result as i128
    };
    
    result
}

/// Calculate x / y rounding towards zero, where x and y are unsigned 128-bit integer numbers.
/// Revert on overflow or when y is zero.
pub fn divu(x: u128, y: u128) -> i128 {
    assert(y != 0, "divu: division by zero");
    let result = divuu(x, y);
    assert(result <= (MAX_64X64 as u128), "divu: overflow");
    result as i128
}

/// Internal helper: Calculate x / y rounding towards zero, where x and y are unsigned 128-bit integers.
/// Returns unsigned 128-bit result.
fn divuu(x: u128, y: u128) -> u128 {
    assert(y != 0, "divuu: division by zero");
    
    // For values that fit in 128 bits, simple division
    if x <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF {
        (x << 64) / y
    } else {
        // For larger values, use bit manipulation approach
        // Find most significant bit of x
        let mut msb: u32 = 192;
        let mut xc = x >> 192;
        
        if xc >= 0x100000000 {
            xc >>= 32;
            msb += 32;
        }
        if xc >= 0x10000 {
            xc >>= 16;
            msb += 16;
        }
        if xc >= 0x100 {
            xc >>= 8;
            msb += 8;
        }
        if xc >= 0x10 {
            xc >>= 4;
            msb += 4;
        }
        if xc >= 0x4 {
            xc >>= 2;
            msb += 2;
        }
        if xc >= 0x2 {
            msb += 1;
        }
        
        let shift: u32 = 255 - msb;
        let y_adj = ((y - 1) >> (msb - 191)) + 1;
        let mut result = (x << shift) / y_adj;
        assert(result <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, "divuu: result overflow");
        
        let hi = result * (y >> 128);
        let lo = result * (y & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
        
        let mut xh = x >> 192;
        let mut xl = x << 64;
        
        if xl < lo {
            xh -= 1;
        }
        xl -= lo;
        let lo_shifted = hi << 128;
        if xl < lo_shifted {
            xh -= 1;
        }
        xl -= lo_shifted;
        
        assert(xh == (hi >> 128), "divuu: assertion failed");
        
        result += xl / y;
        assert(result <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, "divuu: final result overflow");
        result
    }
}

/// Calculate binary exponent of x. Revert on overflow.
/// This is the most complex function, implementing 2^x using bit manipulation.
pub fn exp_2(x: i128) -> i128 {
    // Overflow check: x < 0x400000000000000000
    assert(x < 0x400000000000000000, "exp_2: overflow");
    
    // Underflow: if x < -0x400000000000000000, return 0
    if x < -0x400000000000000000 {
        return 0;
    }
    
    let mut result: u128 = 0x80000000000000000000000000000000;
    
    // Bit-by-bit multiplication using precomputed constants
    // Each constant represents 2^(bit_position/2^64)
    if (x & 0x8000000000000000) != 0 {
        result = (result * 0x16A09E667F3BCC908B2FB1366EA957D3E) >> 128;
    }
    if (x & 0x4000000000000000) != 0 {
        result = (result * 0x1306FE0A31B7152DE8D5A46305C85EDEC) >> 128;
    }
    if (x & 0x2000000000000000) != 0 {
        result = (result * 0x1172B83C7D517ADCDF7C8C50EB14A791F) >> 128;
    }
    if (x & 0x1000000000000000) != 0 {
        result = (result * 0x10B5586CF9890F6298B92B71842A98363) >> 128;
    }
    if (x & 0x800000000000000) != 0 {
        result = (result * 0x1059B0D31585743AE7C548EB68CA417FD) >> 128;
    }
    if (x & 0x400000000000000) != 0 {
        result = (result * 0x102C9A3E778060EE6F7CACA4F7A29BDE8) >> 128;
    }
    if (x & 0x200000000000000) != 0 {
        result = (result * 0x10163DA9FB33356D84A66AE336DCDFA3F) >> 128;
    }
    if (x & 0x100000000000000) != 0 {
        result = (result * 0x100B1AFA5ABCBED6129AB13EC11DC9543) >> 128;
    }
    if (x & 0x80000000000000) != 0 {
        result = (result * 0x10058C86DA1C09EA1FF19D294CF2F679B) >> 128;
    }
    if (x & 0x40000000000000) != 0 {
        result = (result * 0x1002C605E2E8CEC506D21BFC89A23A00F) >> 128;
    }
    if (x & 0x20000000000000) != 0 {
        result = (result * 0x100162F3904051FA128BCA9C55C31E5DF) >> 128;
    }
    if (x & 0x10000000000000) != 0 {
        result = (result * 0x1000B175EFFDC76BA38E31671CA939725) >> 128;
    }
    if (x & 0x8000000000000) != 0 {
        result = (result * 0x100058BA01FB9F96D6CACD4B180917C3D) >> 128;
    }
    if (x & 0x4000000000000) != 0 {
        result = (result * 0x10002C5CC37DA9491D0985C348C68E7B3) >> 128;
    }
    if (x & 0x2000000000000) != 0 {
        result = (result * 0x1000162E525EE054754457D5995292026) >> 128;
    }
    if (x & 0x1000000000000) != 0 {
        result = (result * 0x10000B17255775C040618BF4A4ADE83FC) >> 128;
    }
    if (x & 0x800000000000) != 0 {
        result = (result * 0x1000058B91B5BC9AE2EED81E9B7D4CFAB) >> 128;
    }
    if (x & 0x400000000000) != 0 {
        result = (result * 0x100002C5C89D5EC6CA4D7C8ACC017B7C9) >> 128;
    }
    if (x & 0x200000000000) != 0 {
        result = (result * 0x10000162E43F4F831060E02D839A9D16D) >> 128;
    }
    if (x & 0x100000000000) != 0 {
        result = (result * 0x100000B1721BCFC99D9F890EA06911763) >> 128;
    }
    if (x & 0x80000000000) != 0 {
        result = (result * 0x10000058B90CF1E6D97F9CA14DBCC1628) >> 128;
    }
    if (x & 0x40000000000) != 0 {
        result = (result * 0x1000002C5C863B73F016468F6BAC5CA2B) >> 128;
    }
    if (x & 0x20000000000) != 0 {
        result = (result * 0x100000162E430E5A18F6119E3C02282A5) >> 128;
    }
    if (x & 0x10000000000) != 0 {
        result = (result * 0x1000000B1721835514B86E6D96EFD1BFE) >> 128;
    }
    if (x & 0x8000000000) != 0 {
        result = (result * 0x100000058B90C0B48C6BE5DF846C5B2EF) >> 128;
    }
    if (x & 0x4000000000) != 0 {
        result = (result * 0x10000002C5C8601CC6B9E94213C72737A) >> 128;
    }
    if (x & 0x2000000000) != 0 {
        result = (result * 0x1000000162E42FFF037DF38AA2B219F06) >> 128;
    }
    if (x & 0x1000000000) != 0 {
        result = (result * 0x10000000B17217FBA9C739AA5819F44F9) >> 128;
    }
    if (x & 0x800000000) != 0 {
        result = (result * 0x1000000058B90BFCDEE5ACD3C1CEDC823) >> 128;
    }
    if (x & 0x400000000) != 0 {
        result = (result * 0x100000002C5C85FE31F35A6A30DA1BE50) >> 128;
    }
    if (x & 0x200000000) != 0 {
        result = (result * 0x10000000162E42FF0999CE3541B9FFFCF) >> 128;
    }
    if (x & 0x100000000) != 0 {
        result = (result * 0x100000000B17217F80F4EF5AADDA45554) >> 128;
    }
    if (x & 0x80000000) != 0 {
        result = (result * 0x10000000058B90BFBF8479BD5A81B51AD) >> 128;
    }
    if (x & 0x40000000) != 0 {
        result = (result * 0x1000000002C5C85FDF84BD62AE30A74CC) >> 128;
    }
    if (x & 0x20000000) != 0 {
        result = (result * 0x100000000162E42FEFB2FED257559BDAA) >> 128;
    }
    if (x & 0x10000000) != 0 {
        result = (result * 0x1000000000B17217F7D5A7716BBA4A9AE) >> 128;
    }
    if (x & 0x8000000) != 0 {
        result = (result * 0x100000000058B90BFBE9DDBAC5E109CCE) >> 128;
    }
    if (x & 0x4000000) != 0 {
        result = (result * 0x10000000002C5C85FDF4B15DE6F17EB0D) >> 128;
    }
    if (x & 0x2000000) != 0 {
        result = (result * 0x1000000000162E42FEFA494F1478FDE05) >> 128;
    }
    if (x & 0x1000000) != 0 {
        result = (result * 0x10000000000B17217F7D20CF927C8E94C) >> 128;
    }
    if (x & 0x800000) != 0 {
        result = (result * 0x1000000000058B90BFBE8F71CB4E4B33D) >> 128;
    }
    if (x & 0x400000) != 0 {
        result = (result * 0x100000000002C5C85FDF477B662B26945) >> 128;
    }
    if (x & 0x200000) != 0 {
        result = (result * 0x10000000000162E42FEFA3AE53369388C) >> 128;
    }
    if (x & 0x100000) != 0 {
        result = (result * 0x100000000000B17217F7D1D351A389D40) >> 128;
    }
    if (x & 0x80000) != 0 {
        result = (result * 0x10000000000058B90BFBE8E8B2D3D4EDE) >> 128;
    }
    if (x & 0x40000) != 0 {
        result = (result * 0x1000000000002C5C85FDF4741BEA6E77E) >> 128;
    }
    if (x & 0x20000) != 0 {
        result = (result * 0x100000000000162E42FEFA39FE95583C2) >> 128;
    }
    if (x & 0x10000) != 0 {
        result = (result * 0x1000000000000B17217F7D1CFB72B45E1) >> 128;
    }
    if (x & 0x8000) != 0 {
        result = (result * 0x100000000000058B90BFBE8E7CC35C3F0) >> 128;
    }
    if (x & 0x4000) != 0 {
        result = (result * 0x10000000000002C5C85FDF473E242EA38) >> 128;
    }
    if (x & 0x2000) != 0 {
        result = (result * 0x1000000000000162E42FEFA39F02B772C) >> 128;
    }
    if (x & 0x1000) != 0 {
        result = (result * 0x10000000000000B17217F7D1CF7D83C1A) >> 128;
    }
    if (x & 0x800) != 0 {
        result = (result * 0x1000000000000058B90BFBE8E7BDCBE2E) >> 128;
    }
    if (x & 0x400) != 0 {
        result = (result * 0x100000000000002C5C85FDF473DEA871F) >> 128;
    }
    if (x & 0x200) != 0 {
        result = (result * 0x10000000000000162E42FEFA39EF44D91) >> 128;
    }
    if (x & 0x100) != 0 {
        result = (result * 0x100000000000000B17217F7D1CF79E949) >> 128;
    }
    if (x & 0x80) != 0 {
        result = (result * 0x10000000000000058B90BFBE8E7BCE544) >> 128;
    }
    if (x & 0x40) != 0 {
        result = (result * 0x1000000000000002C5C85FDF473DE6ECA) >> 128;
    }
    if (x & 0x20) != 0 {
        result = (result * 0x100000000000000162E42FEFA39EF366F) >> 128;
    }
    if (x & 0x10) != 0 {
        result = (result * 0x1000000000000000B17217F7D1CF79AFA) >> 128;
    }
    if (x & 0x8) != 0 {
        result = (result * 0x100000000000000058B90BFBE8E7BCD6D) >> 128;
    }
    if (x & 0x4) != 0 {
        result = (result * 0x10000000000000002C5C85FDF473DE6B2) >> 128;
    }
    if (x & 0x2) != 0 {
        result = (result * 0x1000000000000000162E42FEFA39EF358) >> 128;
    }
    if (x & 0x1) != 0 {
        result = (result * 0x10000000000000000B17217F7D1CF79AB) >> 128;
    }
    
    // Final shift based on integer part of x
    let shift_bits: u32 = 63 - ((x >> 64) as u32);
    result = result >> shift_bits;
    assert(result <= (MAX_64X64 as u128), "exp_2: result overflow");
    
    result as i128
}

/// Calculate sqrt (x) rounding down, where x is unsigned 128-bit integer number.
/// Returns unsigned 128-bit integer number.
pub fn sqrtu(x: u128) -> u128 {
    if x == 0 {
        return 0;
    }
    
    let mut xx = x;
    let mut r: u128 = 1;
    
    // Find initial approximation
    if xx >= 0x100000000000000000000000000000000 {
        xx >>= 128;
        r <<= 64;
    }
    if xx >= 0x10000000000000000 {
        xx >>= 64;
        r <<= 32;
    }
    if xx >= 0x100000000 {
        xx >>= 32;
        r <<= 16;
    }
    if xx >= 0x10000 {
        xx >>= 16;
        r <<= 8;
    }
    if xx >= 0x100 {
        xx >>= 8;
        r <<= 4;
    }
    if xx >= 0x10 {
        xx >>= 4;
        r <<= 2;
    }
    if xx >= 0x8 {
        r <<= 1;
    }
    
    // Newton's method iterations
    r = (r + x / r) >> 1;
    r = (r + x / r) >> 1;
    r = (r + x / r) >> 1;
    r = (r + x / r) >> 1;
    r = (r + x / r) >> 1;
    r = (r + x / r) >> 1;
    r = (r + x / r) >> 1; // Seven iterations should be enough
    
    let r1 = x / r;
    if r < r1 {
        r
    } else {
        r1
    }
}

/// Calculate -x. Revert on overflow.
pub fn neg(x: i128) -> i128 {
    assert(x != MIN_64X64, "neg: cannot negate MIN_64X64");
    -x
}

/// Calculate |x|. Revert on overflow.
pub fn abs(x: i128) -> i128 {
    assert(x != MIN_64X64, "abs: cannot abs MIN_64X64");
    if x < 0 {
        -x
    } else {
        x
    }
}

/// Calculate 1 / x rounding towards zero. Revert on overflow or when x is zero.
pub fn inv(x: i128) -> i128 {
    assert(x != 0, "inv: division by zero");
    let result = (0x100000000000000000000000000000000 as i128) / x;
    assert(result >= MIN_64X64 && result <= MAX_64X64, "inv: overflow");
    result
}

/// Calculate arithmetics average of x and y, i.e. (x + y) / 2 rounding down.
pub fn avg(x: i128, y: i128) -> i128 {
    (x + y) >> 1
}

/// Calculate geometric average of x and y, i.e. sqrt (x * y) rounding down.
/// Revert on overflow or in case x * y is negative.
pub fn gavg(x: i128, y: i128) -> i128 {
    let m = x * y;
    assert(m >= 0, "gavg: x * y is negative");
    assert(m < 0x4000000000000000000000000000000000000000000000000000000000000000, "gavg: overflow");
    sqrtu(m as u128) as i128
}

/// Calculate x^y assuming 0^0 is 1, where x is signed 64.64 fixed point number
/// and y is unsigned 128-bit integer number. Revert on overflow.
pub fn pow(x: i128, y: u128) -> i128 {
    let negative = x < 0 && (y & 1) == 1;
    
    let abs_x = if x < 0 { (-x) as u128 } else { x as u128 };
    let mut abs_result: u128 = 0x100000000000000000000000000000000;
    
    if abs_x <= 0x10000000000000000 {
        let mut abs_x_shifted = abs_x << 63;
        let mut y_remaining = y;
        
        while y_remaining != 0 {
            if (y_remaining & 0x1) != 0 {
                abs_result = (abs_result * abs_x_shifted) >> 127;
            }
            abs_x_shifted = (abs_x_shifted * abs_x_shifted) >> 127;
            
            if (y_remaining & 0x2) != 0 {
                abs_result = (abs_result * abs_x_shifted) >> 127;
            }
            abs_x_shifted = (abs_x_shifted * abs_x_shifted) >> 127;
            
            if (y_remaining & 0x4) != 0 {
                abs_result = (abs_result * abs_x_shifted) >> 127;
            }
            abs_x_shifted = (abs_x_shifted * abs_x_shifted) >> 127;
            
            if (y_remaining & 0x8) != 0 {
                abs_result = (abs_result * abs_x_shifted) >> 127;
            }
            abs_x_shifted = (abs_x_shifted * abs_x_shifted) >> 127;
            
            y_remaining >>= 4;
        }
        
        abs_result >>= 64;
    } else {
        // For larger abs_x, use shift-based approach
        let mut abs_x_shift: u32 = 63;
        let mut abs_x_working = abs_x;
        
        if abs_x_working < 0x1000000000000000000000000 {
            abs_x_working <<= 32;
            abs_x_shift -= 32;
        }
        if abs_x_working < 0x10000000000000000000000000000 {
            abs_x_working <<= 16;
            abs_x_shift -= 16;
        }
        if abs_x_working < 0x1000000000000000000000000000000 {
            abs_x_working <<= 8;
            abs_x_shift -= 8;
        }
        if abs_x_working < 0x10000000000000000000000000000000 {
            abs_x_working <<= 4;
            abs_x_shift -= 4;
        }
        if abs_x_working < 0x40000000000000000000000000000000 {
            abs_x_working <<= 2;
            abs_x_shift -= 2;
        }
        if abs_x_working < 0x80000000000000000000000000000000 {
            abs_x_working <<= 1;
            abs_x_shift -= 1;
        }
        
        let mut result_shift: u32 = 0;
        let mut y_remaining = y;
        
        while y_remaining != 0 {
            assert(abs_x_shift < 64, "pow: abs_x_shift overflow");
            
            if (y_remaining & 0x1) != 0 {
                abs_result = (abs_result * abs_x_working) >> 127;
                result_shift += abs_x_shift;
                if abs_result > 0x100000000000000000000000000000000 {
                    abs_result >>= 1;
                    result_shift += 1;
                }
            }
            abs_x_working = (abs_x_working * abs_x_working) >> 127;
            abs_x_shift <<= 1;
            if abs_x_working >= 0x100000000000000000000000000000000 {
                abs_x_working >>= 1;
                abs_x_shift += 1;
            }
            
            y_remaining >>= 1;
        }
        
        assert(result_shift < 64, "pow: result_shift overflow");
        abs_result >>= (64 - result_shift);
    }
    
    let result = if negative {
        -(abs_result as i128)
    } else {
        abs_result as i128
    };
    
    assert(result >= MIN_64X64 && result <= MAX_64X64, "pow: overflow");
    result
}

/// Calculate binary logarithm of x. Revert if x <= 0.
pub fn log_2(x: i128) -> i128 {
    assert(x > 0, "log_2: x <= 0");
    
    let mut msb: i128 = 0;
    let mut xc = x;
    
    if xc >= 0x10000000000000000 {
        xc >>= 64;
        msb += 64;
    }
    if xc >= 0x100000000 {
        xc >>= 32;
        msb += 32;
    }
    if xc >= 0x10000 {
        xc >>= 16;
        msb += 16;
    }
    if xc >= 0x100 {
        xc >>= 8;
        msb += 8;
    }
    if xc >= 0x10 {
        xc >>= 4;
        msb += 4;
    }
    if xc >= 0x4 {
        xc >>= 2;
        msb += 2;
    }
    if xc >= 0x2 {
        msb += 1;
    }
    
    let mut result = (msb - 64) << 64;
    let mut ux = (x as u128) << (127 - (msb as u32));
    
    let mut bit: u128 = 0x8000000000000000;
    while bit > 0 {
        ux = (ux * ux) >> 127;
        let b = ux >> 255;
        ux >>= (127 + b);
        result += ((bit as i128) * (b as i128));
        bit >>= 1;
    }
    
    result
}

/// Calculate natural logarithm of x. Revert if x <= 0.
pub fn ln(x: i128) -> i128 {
    assert(x > 0, "ln: x <= 0");
    let log2_result = log_2(x);
    ((log2_result as u128) * 0xB17217F7D1CF79ABC9E3B39803F2F6AF >> 128) as i128
}

/// Calculate natural exponent of x. Revert on overflow.
pub fn exp(x: i128) -> i128 {
    assert(x < 0x400000000000000000, "exp: overflow");
    
    if x < -0x400000000000000000 {
        return 0;
    }
    
    exp_2((x * 0x171547652B82FE1777D0FFDA0D23A7D12) >> 128)
}

/// Calculate sqrt (x) rounding down. Revert if x < 0.
pub fn sqrt(x: i128) -> i128 {
    assert(x >= 0, "sqrt: x < 0");
    (sqrtu((x as u128) << 64) as i128)
}