// Perlin Noise implementation matching the TypeScript client exactly
// Uses Signed struct for proper signed integer arithmetic
// Gradient index from Poseidon2([key, corner_x, corner_y, scale]) % 16 to match client

use ::aztec::protocol::hash::poseidon2_hash;

// ========== Signed Integer Struct ==========
pub struct Signed {
    pub x: u128,
    pub is_neg: bool,
}

impl Signed {
    pub fn zero() -> Self {
        Self { x: 0, is_neg: false }
    }

    pub fn from(val: u128) -> Self {
        Self { x: val, is_neg: false }
    }

    pub fn from_signed(val: u128, is_negative: bool) -> Self {
        Self { x: val, is_neg: is_negative }
    }

    pub fn add(self, other: Self) -> Self {
        let mut val: u128 = 0;
        let mut is_neg = false;

        if self.is_neg == other.is_neg {
            // Same sign
            val = self.x + other.x;
            is_neg = self.is_neg;
        } else {
            // Different signs
            if self.x > other.x {
                val = self.x - other.x;
                is_neg = self.is_neg;
            } else if self.x < other.x {
                val = other.x - self.x;
                is_neg = other.is_neg;
            } else {
                val = 0;
                is_neg = false;
            }
        }

        Self { x: val, is_neg }
    }

    pub fn sub(self, other: Self) -> Self {
        self.add(other.flip())
    }

    pub fn mul(self, other: Self) -> Self {
        let val = self.x * other.x;
        let mut is_neg = false;
        if val != 0 {
            is_neg = self.is_neg != other.is_neg;
        }
        Self { x: val, is_neg }
    }

    pub fn div(self, other: Self) -> Self {
        let val = self.x / other.x;
        let mut is_neg = false;
        if val != 0 {
            is_neg = self.is_neg != other.is_neg;
        }
        Self { x: val, is_neg }
    }

    // Floor division - rounds toward negative infinity (needed for grid alignment)
    pub fn floor_div(self, other: Self) -> Self {
        let quotient = self.x / other.x;
        let remainder = self.x % other.x;
        let result_neg = self.is_neg != other.is_neg;

        // If signs differ and there's a remainder, subtract 1 from quotient
        if result_neg & (remainder != 0) {
            Self { x: quotient + 1, is_neg: true }
        } else {
            let mut is_neg = false;
            if quotient != 0 {
                is_neg = result_neg;
            }
            Self { x: quotient, is_neg }
        }
    }

    pub fn muli(self, other: u128) -> Self {
        Self { x: self.x * other, is_neg: self.is_neg }
    }

    pub fn flip(self) -> Self {
        Self { x: self.x, is_neg: !self.is_neg & (self.x != 0) }
    }

    pub fn absi(self) -> u128 {
        self.x
    }
}

// ========== Coordinates Struct ==========
pub struct Coords {
    pub x: Signed,
    pub y: Signed,
}

impl Coords {
    pub fn diff(self, other: Self) -> Self {
        Self { x: self.x.sub(other.x), y: self.y.sub(other.y) }
    }
}

// ========== Constants ==========
global PERLIN_MAX: u128 = 32;

// ========== Hash Function ==========
// Match client: Poseidon2([key, corner_x, corner_y, scale]) % 16 for gradient index 0-15.
// Corner coordinates are signed (client passes actual coords; we use signed Field).
fn random(corner_x: u128, corner_y: u128, scale: u128, seed: u128, x_neg: bool, y_neg: bool) -> u8 {
    let seed_f = seed as Field;
    let cx_f = corner_x as Field;
    let cy_f = corner_y as Field;
    let scale_f = scale as Field;
    let cx_signed = if x_neg { -cx_f } else { cx_f };
    let cy_signed = if y_neg { -cy_f } else { cy_f };
    let h = poseidon2_hash([seed_f, cx_signed, cy_signed, scale_f]);
    ((h as u128) % 16) as u8
}

// ========== Gradient Vectors ==========
// 16 pre-computed unit circle vectors scaled by 1000
fn get_gradient(index: u8) -> (Signed, Signed) {
    // Match client's DIRECTIONS array exactly
    if index == 0 {
        (Signed::from(1000), Signed::from(0))
    } else if index == 1 {
        (Signed::from(923), Signed::from(382))
    } else if index == 2 {
        (Signed::from(707), Signed::from(707))
    } else if index == 3 {
        (Signed::from(382), Signed::from(923))
    } else if index == 4 {
        (Signed::from(0), Signed::from(1000))
    } else if index == 5 {
        (Signed::from_signed(383, true), Signed::from(923))
    } else if index == 6 {
        (Signed::from_signed(708, true), Signed::from(707))
    } else if index == 7 {
        (Signed::from_signed(924, true), Signed::from(382))
    } else if index == 8 {
        (Signed::from_signed(1000, true), Signed::from(0))
    } else if index == 9 {
        (Signed::from_signed(924, true), Signed::from_signed(383, true))
    } else if index == 10 {
        (Signed::from_signed(708, true), Signed::from_signed(708, true))
    } else if index == 11 {
        (Signed::from_signed(383, true), Signed::from_signed(924, true))
    } else if index == 12 {
        (Signed::from_signed(1, true), Signed::from_signed(1000, true))
    } else if index == 13 {
        (Signed::from(382), Signed::from_signed(924, true))
    } else if index == 14 {
        (Signed::from(707), Signed::from_signed(708, true))
    } else {
        (Signed::from(923), Signed::from_signed(383, true))
    } // index == 15
}

// ========== Random Gradient ==========
fn random_gradient_at(point: Coords, scale: u128, seed: u128) -> (Signed, Signed) {
    // Use corner coordinates (matches client: hash(corner.x, corner.y, scale))
    let rand_idx = random(
        point.x.absi(),
        point.y.absi(),
        scale,
        seed,
        point.x.is_neg,
        point.y.is_neg,
    );
    get_gradient(rand_idx)
}

// ========== Weight Calculation ==========
fn get_weight(corner: Coords, point: Coords, scale: u128) -> u128 {
    let diff = corner.diff(point);
    (scale - diff.x.absi()) * (scale - diff.y.absi())
}

// ========== Corner Calculation ==========
// Uses floor division for correct grid alignment with negative coordinates
fn get_corners(point: Coords, scale: u128) -> [Coords; 4] {
    let scale_s = Signed::from(scale);

    // Use floor division to get the correct grid cell for negative coordinates
    let bottom_left = Coords {
        x: point.x.floor_div(scale_s).mul(scale_s),
        y: point.y.floor_div(scale_s).mul(scale_s),
    };

    [
        Coords { x: bottom_left.x, y: bottom_left.y },
        Coords { x: bottom_left.x.add(scale_s), y: bottom_left.y },
        Coords { x: bottom_left.x, y: bottom_left.y.add(scale_s) },
        Coords { x: bottom_left.x.add(scale_s), y: bottom_left.y.add(scale_s) },
    ]
}

// ========== Dot Product ==========
fn dot(offset: Coords, gradient: (Signed, Signed)) -> Signed {
    let dotx = gradient.0.mul(offset.x);
    let doty = gradient.1.mul(offset.y);
    dotx.add(doty)
}

// ========== Single Scale Perlin (raw numerator, no division) ==========
// Returns the raw weighted-dot-product sum. The caller divides once at the end
// to avoid intermediate integer truncation that desynchronises with the
// client's exact-rational (Fraction) arithmetic.
fn single_scale_perlin_numerator(point: Coords, scale: u128, seed: u128) -> Signed {
    let corners = get_corners(point, scale);

    let mut numerator = Signed::zero();
    for i in 0..4 {
        let corner = corners[i];
        let offset = point.diff(corner);
        let gradient = random_gradient_at(corner, scale, seed);
        let d = dot(offset, gradient);
        let weight = get_weight(corner, point, scale);
        let t = d.muli(weight);
        numerator = numerator.add(t);
    }
    numerator
}

// ========== Multi-Scale Perlin ==========
// Matches client: floor((2*v0 + v1 + v2) / 4 * 16) + 16
// where v_i = N_i / (1000 * s_i^3) is exact rational.
//
// Putting everything over a common denominator (64000 * s^3):
//   2 * N0/(1000*s^3) = 128*N0 / (64000*s^3)
//   N1/(1000*(2s)^3)  =   8*N1 / (64000*s^3)
//   N2/(1000*(4s)^3)  =     N2 / (64000*s^3)
//
// Multiplied by 16/4 = 4:
//   (128*N0 + 8*N1 + N2) / (16000 * s^3)
//
// result = floor_div(above) + 16
fn compute_perlin(point: Coords, scale: u128, seed: u128) -> u128 {
    let n0 = single_scale_perlin_numerator(point, scale, seed);
    let n1 = single_scale_perlin_numerator(point, scale * 2, seed);
    let n2 = single_scale_perlin_numerator(point, scale * 4, seed);

    let combined = n0.muli(128).add(n1.muli(8)).add(n2);
    let divisor = Signed::from(16000 * scale * scale * scale);
    let floored = combined.floor_div(divisor);
    let result = floored.add(Signed::from(PERLIN_MAX / 2));

    if result.is_neg {
        0
    } else if result.x > PERLIN_MAX {
        PERLIN_MAX
    } else {
        result.x
    }
}

// ========== Public Interface ==========
// Entry point for computing perlin from Field coordinates
// x, y are absolute values; x_negative, y_negative indicate the sign
pub fn multi_scale_perlin(
    x: Field,
    y: Field,
    x_negative: bool,
    y_negative: bool,
    key: Field,
    scale: u128,
    x_mirror: bool,
    y_mirror: bool,
) -> u8 {
    // Convert Field to Signed with proper sign handling
    let mut px = Signed::from_signed(x as u128, x_negative);
    let mut py = Signed::from_signed(y as u128, y_negative);

    // Handle mirroring (make coords positive)
    if x_mirror {
        px = Signed::from(px.absi());
    }
    if y_mirror {
        py = Signed::from(py.absi());
    }

    let point = Coords { x: px, y: py };
    let seed = key as u128;

    compute_perlin(point, scale, seed) as u8
}
