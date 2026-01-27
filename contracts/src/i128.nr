// I128: 128-bit signed integer for Noir
// Implemented using u128 with two's complement representation
//
// This is the primary type needed for ABDK Math 64.64 fixed point arithmetic,
// since Noir doesn't support i128 natively.

use std::ops::{WrappingAdd, WrappingSub, WrappingMul};
use crate::u256::U256;

/// 128-bit signed integer using two's complement
pub struct I128 {
    pub bits: u128,  // Two's complement representation
}

// ========== Constants ==========

/// Zero
pub fn zero() -> I128 {
    I128 { bits: 0 }
}

/// One
pub fn one() -> I128 {
    I128 { bits: 1 }
}

/// Negative one (-1 = all bits set in two's complement)
pub fn neg_one() -> I128 {
    I128 { bits: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF }
}

/// Minimum value: -2^127 = 0x80000000000000000000000000000000
pub fn min_value() -> I128 {
    I128 { bits: 0x80000000000000000000000000000000 }
}

/// Maximum value: 2^127 - 1 = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
pub fn max_value() -> I128 {
    I128 { bits: 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF }
}

// Sign bit mask (bit 127)
global SIGN_BIT: u128 = 0x80000000000000000000000000000000;

impl I128 {
    // ========== Constructors ==========

    /// Create from u128 (interpret as two's complement)
    pub fn from_bits(bits: u128) -> Self {
        I128 { bits }
    }

    /// Create from u128 value (must fit in positive i128 range)
    pub fn from_u128(x: u128) -> Self {
        assert(x <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, "I128: u128 value too large for positive I128");
        I128 { bits: x }
    }

    /// Create from u64 (always positive)
    pub fn from_u64(x: u64) -> Self {
        I128 { bits: x as u128 }
    }

    /// Create from i64
    pub fn from_i64(x: i64) -> Self {
        if x >= 0 {
            I128 { bits: x as u128 }
        } else {
            // Negative: use two's complement
            // For negative i64, we need to sign-extend to 128 bits
            // -x gives the absolute value (for most negative values)
            let abs_val: u128 = if x == -9223372036854775808 {
                // Special case: i64::MIN
                9223372036854775808
            } else {
                (-x) as u128
            };
            // Negate in 128-bit: two's complement = ~abs + 1
            let negated = (!abs_val).wrapping_add(1);
            I128 { bits: negated }
        }
    }

    // ========== Sign Operations ==========

    /// Check if negative (sign bit is set)
    pub fn is_negative(self) -> bool {
        (self.bits & SIGN_BIT) != 0
    }

    /// Check if positive (not negative and not zero)
    pub fn is_positive(self) -> bool {
        !self.is_negative() & !self.is_zero()
    }

    /// Check if zero
    pub fn is_zero(self) -> bool {
        self.bits == 0
    }

    /// Negate: -x (two's complement: ~x + 1)
    pub fn negate(self) -> Self {
        I128 { bits: (!self.bits).wrapping_add(1) }
    }

    /// Absolute value as u128
    pub fn abs(self) -> u128 {
        if self.is_negative() {
            self.negate().bits
        } else {
            self.bits
        }
    }

    /// Absolute value as I128 (panics for MIN_VALUE)
    pub fn abs_i128(self) -> Self {
        if self.is_negative() {
            let neg = self.negate();
            assert(!neg.is_negative(), "I128: abs of MIN_VALUE overflows");
            neg
        } else {
            self
        }
    }

    // ========== Comparison Operations ==========

    /// Equality
    pub fn eq(self, other: Self) -> bool {
        self.bits == other.bits
    }

    /// Not equal
    pub fn ne(self, other: Self) -> bool {
        self.bits != other.bits
    }

    /// Less than (signed comparison)
    pub fn lt(self, other: Self) -> bool {
        let self_neg = self.is_negative();
        let other_neg = other.is_negative();
        
        if self_neg & !other_neg {
            true  // negative < non-negative
        } else if !self_neg & other_neg {
            false  // non-negative > negative
        } else {
            // Same sign: compare as unsigned
            self.bits < other.bits
        }
    }

    /// Less than or equal (signed)
    pub fn lte(self, other: Self) -> bool {
        self.lt(other) | self.eq(other)
    }

    /// Greater than (signed)
    pub fn gt(self, other: Self) -> bool {
        other.lt(self)
    }

    /// Greater than or equal (signed)
    pub fn gte(self, other: Self) -> bool {
        other.lte(self)
    }

    // ========== Arithmetic Operations ==========

    /// Addition (wrapping)
    pub fn add(self, other: Self) -> Self {
        I128 { bits: self.bits.wrapping_add(other.bits) }
    }

    /// Addition with overflow check
    pub fn checked_add(self, other: Self) -> Self {
        let result = self.add(other);
        // Overflow if: same signs but result has different sign
        let overflow = (self.is_negative() == other.is_negative()) 
                     & (result.is_negative() != self.is_negative());
        assert(!overflow, "I128: addition overflow");
        result
    }

    /// Subtraction (wrapping)
    pub fn sub(self, other: Self) -> Self {
        I128 { bits: self.bits.wrapping_sub(other.bits) }
    }

    /// Subtraction with overflow check
    pub fn checked_sub(self, other: Self) -> Self {
        let result = self.sub(other);
        // Overflow if: different signs and result sign differs from self
        let overflow = (self.is_negative() != other.is_negative()) 
                     & (result.is_negative() != self.is_negative());
        assert(!overflow, "I128: subtraction overflow");
        result
    }

    /// Multiplication (lower 128 bits only)
    pub fn mul(self, other: Self) -> Self {
        I128 { bits: self.bits.wrapping_mul(other.bits) }
    }

    /// Multiplication returning full U256 result
    pub fn mul_full(self, other: Self) -> U256 {
        let self_neg = self.is_negative();
        let other_neg = other.is_negative();
        let result_neg = self_neg != other_neg;
        
        let abs_self = self.abs();
        let abs_other = other.abs();
        let abs_result = U256::mul_u128(abs_self, abs_other);
        
        if result_neg {
            // Negate the U256 result
            abs_result.not().add(U256::from_u128(1))
        } else {
            abs_result
        }
    }

    /// Division (signed)
    pub fn div(self, other: Self) -> Self {
        assert(!other.is_zero(), "I128: division by zero");
        
        let self_neg = self.is_negative();
        let other_neg = other.is_negative();
        let result_neg = self_neg != other_neg;
        
        let abs_self = self.abs();
        let abs_other = other.abs();
        let abs_result = abs_self / abs_other;
        
        let result = I128 { bits: abs_result };
        
        if result_neg & !result.is_zero() {
            result.negate()
        } else {
            result
        }
    }

    /// Modulo (signed: result has same sign as dividend)
    pub fn modulo(self, other: Self) -> Self {
        assert(!other.is_zero(), "I128: modulo by zero");
        let q = self.div(other);
        self.sub(q.mul(other))
    }

    // ========== Bitwise Operations ==========

    /// Bitwise AND
    pub fn and(self, other: Self) -> Self {
        I128 { bits: self.bits & other.bits }
    }

    /// Bitwise OR
    pub fn or(self, other: Self) -> Self {
        I128 { bits: self.bits | other.bits }
    }

    /// Bitwise XOR
    pub fn xor(self, other: Self) -> Self {
        I128 { bits: self.bits ^ other.bits }
    }

    /// Bitwise NOT
    pub fn not(self) -> Self {
        I128 { bits: !self.bits }
    }

    /// Left shift
    pub fn shl(self, n: u32) -> Self {
        if n >= 128 {
            zero()
        } else {
            let n_u128 = n as u128;
            I128 { bits: self.bits << n_u128 }
        }
    }

    /// Arithmetic right shift (preserves sign bit)
    pub fn shr(self, n: u32) -> Self {
        if n == 0 {
            self
        } else if n >= 128 {
            if self.is_negative() {
                neg_one()
            } else {
                zero()
            }
        } else if self.is_negative() {
            // Sign extend: shift right and fill with 1s
            let n_u128 = n as u128;
            let shifted = self.bits >> n_u128;
            // Create mask with n ones in the high bits
            // We do this by: all_ones << (128 - n), but need to handle overflow
            let all_ones: u128 = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
            let shift_amt = (128 - n) as u128;
            let mask = all_ones << shift_amt;
            I128 { bits: shifted | mask }
        } else {
            let n_u128 = n as u128;
            I128 { bits: self.bits >> n_u128 }
        }
    }

    // ========== Conversion ==========

    /// Convert to u128 (asserts non-negative)
    pub fn to_u128(self) -> u128 {
        assert(!self.is_negative(), "I128: cannot convert negative to u128");
        self.bits
    }

    /// Convert to i64 (asserts value fits)
    pub fn to_i64(self) -> i64 {
        if self.is_negative() {
            let abs_val = self.abs();
            assert(abs_val <= 0x8000000000000000, "I128: overflow converting to i64");
            if abs_val == 0x8000000000000000 {
                -9223372036854775808  // i64::MIN
            } else {
                -(abs_val as i64)
            }
        } else {
            assert(self.bits <= 0x7FFFFFFFFFFFFFFF, "I128: overflow converting to i64");
            self.bits as i64
        }
    }

    /// Convert to u64 (asserts non-negative and fits)
    pub fn to_u64(self) -> u64 {
        assert(!self.is_negative(), "I128: cannot convert negative to u64");
        assert(self.bits <= 0xFFFFFFFFFFFFFFFF, "I128: overflow converting to u64");
        self.bits as u64
    }

    /// Get the raw bits
    pub fn to_bits(self) -> u128 {
        self.bits
    }
}

// ========== Tests ==========

#[test]
fn test_i128_zero() {
    let z = zero();
    assert(z.is_zero());
    assert(!z.is_negative());
}

#[test]
fn test_i128_one() {
    let o = one();
    assert(!o.is_zero());
    assert(!o.is_negative());
    assert(o.bits == 1);
}

#[test]
fn test_i128_neg_one() {
    let n = neg_one();
    assert(!n.is_zero());
    assert(n.is_negative());
}

#[test]
fn test_i128_negate() {
    let a = I128::from_u64(100);
    let b = a.negate();
    assert(b.is_negative());
    let c = b.negate();
    assert(c.eq(a));
}

#[test]
fn test_i128_from_i64() {
    let pos = I128::from_i64(100);
    assert(pos.bits == 100);
    assert(!pos.is_negative());
    
    let neg = I128::from_i64(-100);
    assert(neg.is_negative());
    assert(neg.abs() == 100);
}

#[test]
fn test_i128_add() {
    // Positive + positive
    let a = I128::from_u64(100);
    let b = I128::from_u64(200);
    let c = a.add(b);
    assert(c.bits == 300);
    
    // Positive + negative = 0
    let d = I128::from_u64(100);
    let e = I128::from_u64(100).negate();
    let f = d.add(e);
    assert(f.is_zero());
    
    // Negative + negative
    let g = I128::from_u64(50).negate();
    let h = I128::from_u64(30).negate();
    let i = g.add(h);
    assert(i.is_negative());
    assert(i.abs() == 80);
}

#[test]
fn test_i128_sub() {
    let a = I128::from_u64(100);
    let b = I128::from_u64(30);
    let c = a.sub(b);
    assert(c.bits == 70);
    
    let d = I128::from_u64(30);
    let e = I128::from_u64(100);
    let f = d.sub(e);
    assert(f.is_negative());
    assert(f.abs() == 70);
}

#[test]
fn test_i128_comparison() {
    let pos = I128::from_u64(100);
    let neg = I128::from_u64(100).negate();
    let z = zero();
    
    assert(neg.lt(z));
    assert(neg.lt(pos));
    assert(z.lt(pos));
    assert(pos.gt(neg));
    assert(pos.gt(z));
}

#[test]
fn test_i128_div() {
    // Positive / positive
    let a = I128::from_u64(100);
    let b = I128::from_u64(3);
    let c = a.div(b);
    assert(c.bits == 33);
    
    // Negative / positive
    let d = I128::from_u64(100).negate();
    let e = I128::from_u64(3);
    let f = d.div(e);
    assert(f.is_negative());
    assert(f.abs() == 33);
    
    // Positive / negative
    let g = I128::from_u64(100);
    let h = I128::from_u64(3).negate();
    let i = g.div(h);
    assert(i.is_negative());
    assert(i.abs() == 33);
    
    // Negative / negative
    let j = I128::from_u64(100).negate();
    let k = I128::from_u64(3).negate();
    let l = j.div(k);
    assert(!l.is_negative());
    assert(l.bits == 33);
}

#[test]
fn test_i128_shl() {
    let a = I128::from_u64(1);
    let b = a.shl(64);
    assert(b.bits == 0x10000000000000000);
}

#[test]
fn test_i128_shr_positive() {
    let a = I128::from_bits(0x100);
    let b = a.shr(4);
    assert(b.bits == 0x10);
}

#[test]
fn test_i128_shr_negative() {
    let n = neg_one();
    let shifted = n.shr(8);
    assert(shifted.eq(neg_one()));  // Sign extended
}

#[test]
fn test_i128_mul_full() {
    let a = I128::from_bits(0xFFFFFFFFFFFFFFFF);  // 2^64 - 1
    let b = I128::from_bits(0xFFFFFFFFFFFFFFFF);  // 2^64 - 1
    let result = a.mul_full(b);
    // (2^64 - 1)^2 = 2^128 - 2*2^64 + 1
    assert(result.hi == 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE);
    assert(result.lo == 0x00000000000000000000000000000001);
}
