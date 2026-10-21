/// Piecewise linear voyage decay.
/// Anchors: (0%, 0), (25%, 0.5L), (50%, 0.75L), (100%, L), where L = range * 432 / 100.
///
/// The energy share is kept as `pop_moved / population_cap` instead of an integer percent.
/// Truncating to `pop * 100 / cap` makes any send below 1% of cap look like 0% and revert.
///
/// `effective_dist_times_hundred` is distance * 100, already shortened for wormholes.
pub fn decayed_pop_arriving(
    pop_moved: u128,
    population_cap: u128,
    range: u128,
    effective_dist_times_hundred: u128,
) -> u128 {
    if (pop_moved == 0) | (population_cap == 0) | (range == 0) {
        0
    } else {
        // dist_scaled and d_factor share a factor of population_cap, so the ratio matches
        // range * 432 * d_max_percent without rounding the percent to an integer.
        let dist_scaled = effective_dist_times_hundred * 100 * population_cap;
        let d_factor = if pop_moved * 4 <= population_cap {
            // <= 25%: fraction = 2 * pop / cap, d_factor = range * 86400 * pop
            range * 86400 * pop_moved
        } else if pop_moved * 2 <= population_cap {
            // <= 50%: fraction = (cap + 4 * pop) / (4 * cap)
            range * 10800 * (population_cap + pop_moved * 4)
        } else {
            // > 50%: fraction = (cap + pop) / (2 * cap)
            range * 21600 * (population_cap + pop_moved)
        };

        if (d_factor == 0) | (dist_scaled >= d_factor) {
            0
        } else {
            pop_moved * (d_factor - dist_scaled) / d_factor
        }
    }
}

#[test]
fn full_send_zero_distance_arrives_intact() {
    let cap = 10000;
    let arriving = decayed_pop_arriving(cap, cap, 100, 0);
    assert_eq(arriving, cap);
}

#[test]
fn quarter_send_stops_at_half_l() {
    // range 100 => L = 432, 0.5L = 216. 25% of cap is 2500.
    let cap = 10000;
    let pop = 2500;
    let range = 100;
    assert_eq(decayed_pop_arriving(pop, cap, range, 216 * 100), 0);
    // One distance unit inside the boundary still arrives.
    assert_eq(decayed_pop_arriving(pop, cap, range, 215 * 100), 11);
}

#[test]
fn half_send_stops_at_three_quarter_l() {
    // 0.75L = 324 for range 100. 50% of cap is 5000.
    let cap = 10000;
    let pop = 5000;
    assert_eq(decayed_pop_arriving(pop, cap, 100, 324 * 100), 0);
    assert_eq(decayed_pop_arriving(pop, cap, 100, 0), pop);
}

#[test]
fn full_send_stops_at_l_and_halves_at_midpoint() {
    // L = 432. Midpoint 216 arrives with half the sent energy.
    let cap = 10000;
    assert_eq(decayed_pop_arriving(cap, cap, 100, 432 * 100), 0);
    assert_eq(decayed_pop_arriving(cap, cap, 100, 216 * 100), cap / 2);
}

#[test]
fn level8_rank3_tenth_percent_reaches_nearby() {
    // Level 8 cap 700_000_000 after three ×120/100 upgrades.
    // 0.1% is below the old 1% integer cutoff, which used to return 0.
    let cap: u128 = 1209600000;
    let pop: u128 = 1209600;
    let range: u128 = 6306;
    assert_eq(decayed_pop_arriving(pop, cap, range, 0), pop);
    let nearby = decayed_pop_arriving(pop, cap, range, 100);
    assert(nearby > 0);
    assert(nearby < pop);
}
