// U256: 256-bit unsigned integer for Noir
// Implemented using two u128 values (hi, lo)
// 
// This module provides a 256-bit unsigned integer type for use in Noir,
// which natively only supports up to u128.

use std::ops::{WrappingAdd, WrappingSub};

/// 256-bit unsigned integer, stored as two 128-bit halves
/// Value = hi * 2^128 + lo
pub struct U256 {
    pub hi: u128,  // High 128 bits
    pub lo: u128,  // Low 128 bits
}

// ========== Constants ==========

/// Zero
pub fn zero() -> U256 {
    U256 { hi: 0, lo: 0 }
}

/// One
pub fn one() -> U256 {
    U256 { hi: 0, lo: 1 }
}

/// Maximum value (all bits set)
pub fn max() -> U256 {
    U256 { 
        hi: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF, 
        lo: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF 
    }
}

// ========== Constructors ==========

impl U256 {
    /// Create from a single u128 value
    pub fn from_u128(x: u128) -> Self {
        U256 { hi: 0, lo: x }
    }

    /// Create from two u128 values (hi, lo)
    pub fn from_u128_pair(hi: u128, lo: u128) -> Self {
        U256 { hi, lo }
    }

    /// Create from u64
    pub fn from_u64(x: u64) -> Self {
        U256 { hi: 0, lo: x as u128 }
    }

    // ========== Comparison Operations ==========

    /// Check if equal to zero
    pub fn is_zero(self) -> bool {
        (self.hi == 0) & (self.lo == 0)
    }

    /// Equality comparison
    pub fn eq(self, other: Self) -> bool {
        (self.hi == other.hi) & (self.lo == other.lo)
    }

    /// Not equal
    pub fn ne(self, other: Self) -> bool {
        !self.eq(other)
    }

    /// Less than
    pub fn lt(self, other: Self) -> bool {
        if self.hi < other.hi {
            true
        } else if self.hi > other.hi {
            false
        } else {
            self.lo < other.lo
        }
    }

    /// Less than or equal
    pub fn lte(self, other: Self) -> bool {
        self.lt(other) | self.eq(other)
    }

    /// Greater than
    pub fn gt(self, other: Self) -> bool {
        other.lt(self)
    }

    /// Greater than or equal
    pub fn gte(self, other: Self) -> bool {
        other.lte(self)
    }

    // ========== Bitwise Operations ==========

    /// Bitwise AND
    pub fn and(self, other: Self) -> Self {
        U256 {
            hi: self.hi & other.hi,
            lo: self.lo & other.lo,
        }
    }

    /// Bitwise OR
    pub fn or(self, other: Self) -> Self {
        U256 {
            hi: self.hi | other.hi,
            lo: self.lo | other.lo,
        }
    }

    /// Bitwise XOR
    pub fn xor(self, other: Self) -> Self {
        U256 {
            hi: self.hi ^ other.hi,
            lo: self.lo ^ other.lo,
        }
    }

    /// Bitwise NOT
    pub fn not(self) -> Self {
        U256 {
            hi: !self.hi,
            lo: !self.lo,
        }
    }

    /// Left shift by n bits (n must be < 256)
    pub fn shl(self, n: u32) -> Self {
        if n == 0 {
            self
        } else if n >= 256 {
            zero()
        } else if n >= 128 {
            // Shift crosses the boundary completely
            let n_u128 = (n - 128) as u128;
            U256 {
                hi: self.lo << n_u128,
                lo: 0,
            }
        } else {
            // n < 128: shift within both halves
            let n_u128 = n as u128;
            let n_inv = (128 - n) as u128;
            U256 {
                hi: (self.hi << n_u128) | (self.lo >> n_inv),
                lo: self.lo << n_u128,
            }
        }
    }

    /// Right shift by n bits (n must be < 256)
    pub fn shr(self, n: u32) -> Self {
        if n == 0 {
            self
        } else if n >= 256 {
            zero()
        } else if n >= 128 {
            // Shift crosses the boundary completely
            let n_u128 = (n - 128) as u128;
            U256 {
                hi: 0,
                lo: self.hi >> n_u128,
            }
        } else {
            // n < 128: shift within both halves
            let n_u128 = n as u128;
            let n_inv = (128 - n) as u128;
            U256 {
                hi: self.hi >> n_u128,
                lo: (self.lo >> n_u128) | (self.hi << n_inv),
            }
        }
    }

    // ========== Arithmetic Operations ==========

    /// Addition with overflow (wrapping)
    pub fn add(self, other: Self) -> Self {
        let lo = self.lo.wrapping_add(other.lo);
        let carry: u128 = if lo < self.lo { 1 } else { 0 };
        let hi = self.hi.wrapping_add(other.hi).wrapping_add(carry);
        U256 { hi, lo }
    }

    /// Addition (wrapping, no overflow check)
    pub fn wrapping_add(self, other: Self) -> Self {
        self.add(other)
    }

    /// Subtraction
    pub fn sub(self, other: Self) -> Self {
        let borrow: u128 = if self.lo < other.lo { 1 } else { 0 };
        let lo = self.lo.wrapping_sub(other.lo);
        let hi = self.hi.wrapping_sub(other.hi).wrapping_sub(borrow);
        U256 { hi, lo }
    }

    /// Subtraction (wrapping, no overflow check)
    pub fn wrapping_sub(self, other: Self) -> Self {
        self.sub(other)
    }

    /// Multiplication: U256 * U256 -> U256 (lower 256 bits only)
    /// For full 512-bit result, use mul_full
    pub fn mul(self, other: Self) -> Self {
        // Split into 64-bit parts for multiplication
        // self = a3*2^192 + a2*2^128 + a1*2^64 + a0
        // other = b3*2^192 + b2*2^128 + b1*2^64 + b0
        
        let a0 = self.lo & 0xFFFFFFFFFFFFFFFF;
        let a1 = self.lo >> 64;
        let a2 = self.hi & 0xFFFFFFFFFFFFFFFF;
        let a3 = self.hi >> 64;
        
        let b0 = other.lo & 0xFFFFFFFFFFFFFFFF;
        let b1 = other.lo >> 64;
        let b2 = other.hi & 0xFFFFFFFFFFFFFFFF;
        let b3 = other.hi >> 64;
        
        // Compute partial products (only those that affect lower 256 bits)
        // Result position 0 (bits 0-63): a0*b0
        // Result position 1 (bits 64-127): a0*b1 + a1*b0
        // Result position 2 (bits 128-191): a0*b2 + a1*b1 + a2*b0
        // Result position 3 (bits 192-255): a0*b3 + a1*b2 + a2*b1 + a3*b0
        
        let p00 = a0 * b0;
        let p01 = a0 * b1;
        let p10 = a1 * b0;
        let p02 = a0 * b2;
        let p11 = a1 * b1;
        let p20 = a2 * b0;
        let p03 = a0 * b3;
        let p12 = a1 * b2;
        let p21 = a2 * b1;
        let p30 = a3 * b0;
        
        // Accumulate with carries
        let r0 = p00 & 0xFFFFFFFFFFFFFFFF;
        let c0 = p00 >> 64;
        
        let sum1 = c0 + (p01 & 0xFFFFFFFFFFFFFFFF) + (p10 & 0xFFFFFFFFFFFFFFFF);
        let r1 = sum1 & 0xFFFFFFFFFFFFFFFF;
        let c1 = (sum1 >> 64) + (p01 >> 64) + (p10 >> 64);
        
        let sum2 = c1 + (p02 & 0xFFFFFFFFFFFFFFFF) + (p11 & 0xFFFFFFFFFFFFFFFF) + (p20 & 0xFFFFFFFFFFFFFFFF);
        let r2 = sum2 & 0xFFFFFFFFFFFFFFFF;
        let c2 = (sum2 >> 64) + (p02 >> 64) + (p11 >> 64) + (p20 >> 64);
        
        let sum3 = c2 + (p03 & 0xFFFFFFFFFFFFFFFF) + (p12 & 0xFFFFFFFFFFFFFFFF) + (p21 & 0xFFFFFFFFFFFFFFFF) + (p30 & 0xFFFFFFFFFFFFFFFF);
        let r3 = sum3 & 0xFFFFFFFFFFFFFFFF;
        
        U256 {
            hi: (r3 << 64) | r2,
            lo: (r1 << 64) | r0,
        }
    }

    /// Multiply u128 * u128 -> U256 (full result)
    pub fn mul_u128(a: u128, b: u128) -> Self {
        let a_lo = a & 0xFFFFFFFFFFFFFFFF;
        let a_hi = a >> 64;
        let b_lo = b & 0xFFFFFFFFFFFFFFFF;
        let b_hi = b >> 64;
        
        let p_lo_lo = a_lo * b_lo;
        let p_lo_hi = a_lo * b_hi;
        let p_hi_lo = a_hi * b_lo;
        let p_hi_hi = a_hi * b_hi;
        
        // Combine: result = p_hi_hi * 2^128 + (p_lo_hi + p_hi_lo) * 2^64 + p_lo_lo
        let mid = p_lo_hi + p_hi_lo;
        let mid_lo = mid & 0xFFFFFFFFFFFFFFFF;
        let mid_hi = mid >> 64;
        
        let lo = p_lo_lo + (mid_lo << 64);
        let carry: u128 = if lo < p_lo_lo { 1 } else { 0 };
        let hi = p_hi_hi + mid_hi + carry;
        
        U256 { hi, lo }
    }

    /// Division: self / other, returns quotient
    /// Panics if other is zero
    pub fn div(self, other: Self) -> Self {
        assert(!other.is_zero(), "U256: division by zero");
        
        let mut result = zero();
        
        if self.gte(other) {
            if other.hi == 0 {
                // Divisor fits in u128, use simpler algorithm
                result = self.div_u128_internal(other.lo);
            } else {
                // Binary long division for general case
                let mut quotient = zero();
                let mut remainder = zero();
                
                // Process bit by bit, from MSB to LSB
                for i in 0..256 {
                    let bit_idx: u32 = 255 - i;
                    
                    // Shift remainder left by 1
                    remainder = remainder.shl(1);
                    
                    // Bring down the next bit from dividend
                    let bit = self.get_bit(bit_idx);
                    if bit {
                        remainder = remainder.or(one());
                    }
                    
                    // If remainder >= divisor, subtract and set quotient bit
                    if remainder.gte(other) {
                        remainder = remainder.sub(other);
                        quotient = quotient.or(one().shl(bit_idx));
                    }
                }
                
                result = quotient;
            }
        }
        // else: self < other, result stays zero
        
        result
    }

    /// Division by u128, internal version (no zero check since caller already verified)
    fn div_u128_internal(self, divisor: u128) -> Self {
        let mut result = zero();
        
        if self.hi == 0 {
            result = U256::from_u128(self.lo / divisor);
        } else {
            // Use binary long division
            let mut quotient = zero();
            let mut remainder: u128 = 0;
            
            // Process high part
            for i in 0..128 {
                let bit_idx: u128 = 127 - (i as u128);
                remainder = remainder << 1;
                if (self.hi >> bit_idx) & 1 == 1 {
                    remainder = remainder | 1;
                }
                if remainder >= divisor {
                    remainder = remainder - divisor;
                    quotient.hi = quotient.hi | (1 << bit_idx);
                }
            }
            
            // Process low part
            for i in 0..128 {
                let bit_idx: u128 = 127 - (i as u128);
                remainder = remainder << 1;
                if (self.lo >> bit_idx) & 1 == 1 {
                    remainder = remainder | 1;
                }
                if remainder >= divisor {
                    remainder = remainder - divisor;
                    quotient.lo = quotient.lo | (1 << bit_idx);
                }
            }
            
            result = quotient;
        }
        
        result
    }

    /// Modulo: self % other
    pub fn modulo(self, other: Self) -> Self {
        assert(!other.is_zero(), "U256: modulo by zero");
        let q = self.div(other);
        self.sub(q.mul(other))
    }

    /// Get a specific bit (0-indexed from LSB)
    fn get_bit(self, idx: u32) -> bool {
        if idx >= 256 {
            false
        } else if idx >= 128 {
            let shift = (idx - 128) as u128;
            ((self.hi >> shift) & 1) == 1
        } else {
            let shift = idx as u128;
            ((self.lo >> shift) & 1) == 1
        }
    }

    // ========== Conversion ==========

    /// Convert to u128 (returns low 128 bits, asserts high is zero)
    pub fn to_u128(self) -> u128 {
        assert(self.hi == 0, "U256: overflow converting to u128");
        self.lo
    }

    /// Convert to u128 unchecked (returns low 128 bits only)
    pub fn to_u128_unchecked(self) -> u128 {
        self.lo
    }

    /// Convert to u64 (returns low 64 bits, asserts rest is zero)
    pub fn to_u64(self) -> u64 {
        assert(self.hi == 0, "U256: overflow converting to u64");
        assert(self.lo <= 0xFFFFFFFFFFFFFFFF, "U256: overflow converting to u64");
        self.lo as u64
    }
}

// ========== Tests ==========

#[test]
fn test_u256_zero() {
    let z = zero();
    assert(z.hi == 0);
    assert(z.lo == 0);
    assert(z.is_zero());
}

#[test]
fn test_u256_one() {
    let o = one();
    assert(o.hi == 0);
    assert(o.lo == 1);
    assert(!o.is_zero());
}

#[test]
fn test_u256_from_u128() {
    let x = U256::from_u128(12345);
    assert(x.hi == 0);
    assert(x.lo == 12345);
}

#[test]
fn test_u256_comparison() {
    let a = U256::from_u128(100);
    let b = U256::from_u128(200);
    let c = U256::from_u128(100);
    
    assert(a.lt(b));
    assert(b.gt(a));
    assert(a.eq(c));
    assert(a.lte(b));
    assert(a.lte(c));
    assert(b.gte(a));
}

#[test]
fn test_u256_add() {
    let a = U256::from_u128(100);
    let b = U256::from_u128(200);
    let c = a.add(b);
    assert(c.lo == 300);
    assert(c.hi == 0);
    
    // Test with carry
    let d = U256::from_u128(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF);
    let e = U256::from_u128(1);
    let f = d.add(e);
    assert(f.lo == 0);
    assert(f.hi == 1);
}

#[test]
fn test_u256_sub() {
    let a = U256::from_u128(300);
    let b = U256::from_u128(100);
    let c = a.sub(b);
    assert(c.lo == 200);
    assert(c.hi == 0);
}

#[test]
fn test_u256_shl() {
    let a = U256::from_u128(1);
    let b = a.shl(64);
    assert(b.lo == 0x10000000000000000);
    assert(b.hi == 0);
    
    let c = a.shl(128);
    assert(c.lo == 0);
    assert(c.hi == 1);
}

#[test]
fn test_u256_shr() {
    let a = U256 { hi: 1, lo: 0 };
    let b = a.shr(128);
    assert(b.lo == 1);
    assert(b.hi == 0);
}

#[test]
fn test_u256_mul_u128() {
    let result = U256::mul_u128(0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF);
    // (2^64 - 1)^2 = 2^128 - 2^65 + 1
    // hi = 0xFFFFFFFFFFFFFFFE, lo = 0x0000000000000001
    assert(result.hi == 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE);
    assert(result.lo == 0x00000000000000000000000000000001);
}

#[test]
fn test_u256_div() {
    let a = U256::from_u128(100);
    let b = U256::from_u128(3);
    let c = a.div(b);
    assert(c.lo == 33);
    assert(c.hi == 0);
}
