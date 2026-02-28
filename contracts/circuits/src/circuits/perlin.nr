// Perlin Noise implementation matching the TypeScript client exactly
// Uses Signed struct for proper signed integer arithmetic

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
// Proper hash that works for grid-aligned coordinates
// Takes grid indices (not full coordinates) for better distribution
fn random(grid_x: u128, grid_y: u128, seed: u128, x_neg: bool, y_neg: bool) -> u8 {
    // Primes for mixing
    let P1: u128 = 73856093;
    let P2: u128 = 19349663;
    let P3: u128 = 48611;

    // Convert signs to numeric values
    let sign_x: u128 = if x_neg { 1 } else { 0 };
    let sign_y: u128 = if y_neg { 1 } else { 0 };

    // Hash the grid indices
    let mut hash = grid_x * P1 + grid_y * P2 + seed * P3 + sign_x * 7 + sign_y * 13;

    // Additional mixing to break patterns
    hash = hash ^ (hash >> 8);
    hash = hash * 31;
    hash = hash ^ (hash >> 4);

    (hash % 16) as u8
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
    // Convert corner coordinates to grid indices by dividing by scale
    // This gives us small integers that hash well
    let grid_x = point.x.absi() / scale;
    let grid_y = point.y.absi() / scale;

    let rand_idx = random(grid_x, grid_y, seed, point.x.is_neg, point.y.is_neg);
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

// ========== Single Scale Perlin ==========
fn single_scale_perlin(point: Coords, scale: u128, seed: u128) -> Signed {
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

    numerator.div(Signed::from(1000 * scale * scale))
}

// ========== Multi-Scale Perlin ==========
fn compute_perlin(point: Coords, scale: u128, seed: u128) -> u128 {
    let mut perlin_val = Signed::zero();

    // Combine 4 scales (matches client exactly)
    perlin_val = perlin_val.add(single_scale_perlin(point, scale, seed).muli(2));
    perlin_val = perlin_val.add(single_scale_perlin(point, scale * 2, seed));
    perlin_val = perlin_val.add(single_scale_perlin(point, scale * 4, seed));
    perlin_val = perlin_val.add(single_scale_perlin(point, scale * 8, seed));

    // Average and normalize to [0, 32]
    perlin_val = perlin_val.div(Signed::from(4));
    perlin_val = perlin_val.muli(PERLIN_MAX / 2);

    let result = perlin_val.div(Signed::from(scale)).add(Signed::from(PERLIN_MAX / 2)).absi();

    // Clamp to valid range
    if result > PERLIN_MAX {
        PERLIN_MAX
    } else {
        result
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
