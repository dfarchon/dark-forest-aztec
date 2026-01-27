// I256: 256-bit signed integer for Noir
// Implemented using U256 with two's complement representation
//
// This module provides a 256-bit signed integer type for use in Noir,
// needed for intermediate calculations in ABDK Math that may overflow 128 bits.

use crate::u256::U256;

/// 256-bit signed integer using two's complement
pub struct I256 {
    pub bits: U256,  // Two's complement representation
}


// ========== Constants ==========

/// Zero
pub fn zero() -> I256 {
    I256 { bits: U256 { hi: 0, lo: 0 } }
}

/// One
pub fn one() -> I256 {
    I256 { bits: U256 { hi: 0, lo: 1 } }
}

/// Negative one (-1 = all bits set)
pub fn neg_one() -> I256 {
    I256 { bits: U256 { 
        hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, 
        lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF 
    }}
}

/// Minimum value: -2^255
pub fn min_value() -> I256 {
    I256 { bits: U256 { hi: 0x80000000000000000000000000000000, lo: 0 } }
}

/// Maximum value: 2^255 - 1
pub fn max_value() -> I256 {
    I256 { bits: U256 { 
        hi: 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, 
        lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF 
    }}
}

impl I256 {
    // ========== Constructors ==========

    /// Create from U256 bits (two's complement)
    pub fn from_bits(bits: U256) -> Self {
        I256 { bits }
    }

    /// Create from u128 (always positive)
    pub fn from_u128(x: u128) -> Self {
        I256 { bits: U256::from_u128(x) }
    }

    /// Create from U256 (must fit in positive I256 range)
    pub fn from_u256(x: U256) -> Self {
        assert((x.hi & 0x80000000000000000000000000000000) == 0, "I256: U256 value too large for positive I256");
        I256 { bits: x }
    }

    /// Create from i64
    pub fn from_i64(x: i64) -> Self {
        if x >= 0 {
            I256 { bits: U256::from_u128(x as u128) }
        } else {
            // Negative: get absolute value and negate
            let abs_val: u128 = if x == -9223372036854775808 {
                9223372036854775808
            } else {
                (-x) as u128
            };
            let pos = I256 { bits: U256::from_u128(abs_val) };
            pos.negate()
        }
    }

    // ========== Sign Operations ==========

    /// Check if negative (sign bit is set)
    pub fn is_negative(self) -> bool {
        (self.bits.hi & 0x80000000000000000000000000000000) != 0
    }

    /// Check if positive (not negative and not zero)
    pub fn is_positive(self) -> bool {
        !self.is_negative() & !self.is_zero()
    }

    /// Check if zero
    pub fn is_zero(self) -> bool {
        self.bits.is_zero()
    }

    /// Negate: -x (two's complement: ~x + 1)
    pub fn negate(self) -> Self {
        I256 { bits: self.bits.not().add(U256::from_u128(1)) }
    }

    /// Absolute value as U256
    pub fn abs(self) -> U256 {
        if self.is_negative() {
            self.negate().bits
        } else {
            self.bits
        }
    }

    /// Absolute value as I256 (panics for MIN_VALUE)
    pub fn abs_i256(self) -> Self {
        if self.is_negative() {
            let neg = self.negate();
            assert(!neg.is_negative(), "I256: abs of MIN_VALUE overflows");
            neg
        } else {
            self
        }
    }

    // ========== Comparison Operations ==========

    /// Equality
    pub fn eq(self, other: Self) -> bool {
        self.bits.eq(other.bits)
    }

    /// Not equal
    pub fn ne(self, other: Self) -> bool {
        !self.eq(other)
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
            self.bits.lt(other.bits)
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

    /// Addition
    pub fn add(self, other: Self) -> Self {
        I256 { bits: self.bits.add(other.bits) }
    }

    /// Subtraction
    pub fn sub(self, other: Self) -> Self {
        I256 { bits: self.bits.sub(other.bits) }
    }

    /// Multiplication
    pub fn mul(self, other: Self) -> Self {
        let self_neg = self.is_negative();
        let other_neg = other.is_negative();
        let result_neg = self_neg != other_neg;
        
        let abs_self = self.abs();
        let abs_other = other.abs();
        let abs_result = abs_self.mul(abs_other);
        
        let result = I256 { bits: abs_result };
        
        if result_neg & !result.is_zero() {
            result.negate()
        } else {
            result
        }
    }

    /// Division (signed)
    pub fn div(self, other: Self) -> Self {
        assert(!other.is_zero(), "I256: division by zero");
        
        let self_neg = self.is_negative();
        let other_neg = other.is_negative();
        let result_neg = self_neg != other_neg;
        
        let abs_self = self.abs();
        let abs_other = other.abs();
        let abs_result = abs_self.div(abs_other);
        
        let result = I256 { bits: abs_result };
        
        if result_neg & !result.is_zero() {
            result.negate()
        } else {
            result
        }
    }

    // ========== Bitwise Operations ==========

    /// Bitwise AND
    pub fn and(self, other: Self) -> Self {
        I256 { bits: self.bits.and(other.bits) }
    }

    /// Bitwise OR
    pub fn or(self, other: Self) -> Self {
        I256 { bits: self.bits.or(other.bits) }
    }

    /// Bitwise XOR
    pub fn xor(self, other: Self) -> Self {
        I256 { bits: self.bits.xor(other.bits) }
    }

    /// Bitwise NOT
    pub fn not(self) -> Self {
        I256 { bits: self.bits.not() }
    }

    /// Left shift
    pub fn shl(self, n: u32) -> Self {
        I256 { bits: self.bits.shl(n) }
    }

    /// Arithmetic right shift (preserves sign bit)
    pub fn shr(self, n: u32) -> Self {
        if n == 0 {
            self
        } else if n >= 256 {
            if self.is_negative() {
                neg_one()
            } else {
                zero()
            }
        } else if self.is_negative() {
            // Arithmetic right shift: fill with 1s from the left
            let shifted = self.bits.shr(n);
            // Create a mask with n ones in the high bits
            // mask = ~(all_ones >> n) for the high positions
            let all_ones = U256 { 
                hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, 
                lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF 
            };
            let ones_shifted = all_ones.shr(n);
            let mask = ones_shifted.not();
            I256 { bits: shifted.or(mask) }
        } else {
            I256 { bits: self.bits.shr(n) }
        }
    }

    // ========== Conversion ==========

    /// Convert to u128 (asserts fits)
    pub fn to_u128(self) -> u128 {
        assert(!self.is_negative(), "I256: cannot convert negative to u128");
        assert(self.bits.hi == 0, "I256: value too large for u128");
        self.bits.lo
    }

    /// Convert to U256 (asserts non-negative)
    pub fn to_u256(self) -> U256 {
        assert(!self.is_negative(), "I256: cannot convert negative to U256");
        self.bits
    }

    /// Get the raw bits
    pub fn to_bits(self) -> U256 {
        self.bits
    }
}

// ========== Tests ==========

#[test]
fn test_i256_zero() {
    let z = zero();
    assert(z.is_zero());
    assert(!z.is_negative());
}

#[test]
fn test_i256_one() {
    let o = one();
    assert(!o.is_zero());
    assert(!o.is_negative());
}

#[test]
fn test_i256_neg_one() {
    let n = neg_one();
    assert(!n.is_zero());
    assert(n.is_negative());
}

#[test]
fn test_i256_negate() {
    let a = I256::from_u128(100);
    let b = a.negate();
    assert(b.is_negative());
    let c = b.negate();
    assert(c.eq(a));
}

#[test]
fn test_i256_add() {
    let a = I256::from_u128(100);
    let b = I256::from_u128(200);
    let c = a.add(b);
    assert(c.bits.lo == 300);
    assert(c.bits.hi == 0);
    
    // Adding negative
    let d = I256::from_u128(100);
    let e = I256::from_u128(100).negate();
    let f = d.add(e);
    assert(f.is_zero());
}

#[test]
fn test_i256_sub() {
    let a = I256::from_u128(100);
    let b = I256::from_u128(30);
    let c = a.sub(b);
    assert(c.bits.lo == 70);
    
    let d = I256::from_u128(30);
    let e = I256::from_u128(100);
    let f = d.sub(e);
    assert(f.is_negative());
    assert(f.abs().lo == 70);
}

#[test]
fn test_i256_comparison() {
    let pos = I256::from_u128(100);
    let neg = I256::from_u128(100).negate();
    let z = zero();
    
    assert(neg.lt(z));
    assert(neg.lt(pos));
    assert(z.lt(pos));
    assert(pos.gt(neg));
    assert(pos.gt(z));
}

#[test]
fn test_i256_div() {
    let a = I256::from_u128(100);
    let b = I256::from_u128(3);
    let c = a.div(b);
    assert(c.bits.lo == 33);
    
    // Negative / positive
    let d = I256::from_u128(100).negate();
    let e = I256::from_u128(3);
    let f = d.div(e);
    assert(f.is_negative());
    assert(f.abs().lo == 33);
}

#[test]
fn test_i256_shl() {
    let a = I256::from_u128(1);
    let b = a.shl(128);
    assert(b.bits.lo == 0);
    assert(b.bits.hi == 1);
}

#[test]
fn test_i256_shr_positive() {
    let a = I256::from_u128(0x100);
    let b = a.shr(4);
    assert(b.bits.lo == 0x10);
    assert(b.bits.hi == 0);
}

#[test]
fn test_i256_shr_negative() {
    let n = neg_one();
    let shifted = n.shr(8);
    assert(shifted.eq(neg_one()));  // Sign extended
}
