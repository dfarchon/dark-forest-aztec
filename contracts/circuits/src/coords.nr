// Shared coordinate helpers for the init / move / reveal / biomebase circuits.
// Coordinates are signed integers in [-2^31, 2^31) encoded as Field elements
// (negative values are p - |coord|).

global COORD_OFFSET: u128 = 2147483648; // 2^31

/// Range check: coord must be in [-2^31, 2^31).
// Must be a strict bit decomposition. `Field as u128` only keeps the low
// 128 bits, so `(coord + 2^31) as u128 < 2^32` also accepts huge field elements whose low
// bits are small (e.g. 2^128 + 5), breaking every later square/compare that assumes
// small coordinates.
pub fn check_coordinate_range(coord: Field) {
    (coord + COORD_OFFSET as Field).assert_max_bit_size::<32>();
}

/// Detect if a coordinate is negative based on offset representation.
/// Only exact after `check_coordinate_range(coord)` has been enforced.
pub fn is_coord_negative(coord: Field) -> bool {
    let coord_with_offset = (coord + COORD_OFFSET as Field) as u128;
    coord_with_offset < COORD_OFFSET
}

/// Get absolute value of coordinate for perlin calculation.
pub fn get_abs_coord(coord: Field, is_negative: bool) -> Field {
    if is_negative {
        coord * (0 - 1)
    } else {
        coord
    }
}

#[test]
fn test_coord_range_min() {
    check_coordinate_range(0 - 2147483648);
}

#[test]
fn test_coord_range_zero() {
    check_coordinate_range(0);
}

#[test]
fn test_coord_range_max() {
    check_coordinate_range(2147483647);
}

#[test(should_fail)]
fn test_coord_range_too_large() {
    check_coordinate_range(2147483648);
}

#[test(should_fail)]
fn test_coord_range_too_small() {
    check_coordinate_range(0 - 2147483649);
}

// Passed the old `as u128` check because its low 128 bits are 5.
#[test(should_fail)]
fn test_coord_range_rejects_truncation_bypass() {
    check_coordinate_range(0x100000000000000000000000000000005);
}

#[test]
fn test_coord_sign_and_abs() {
    let neg = 0 - 123;
    assert(is_coord_negative(neg));
    assert(get_abs_coord(neg, true) == 123);
    assert(!is_coord_negative(123));
    assert(get_abs_coord(123, false) == 123);
}
