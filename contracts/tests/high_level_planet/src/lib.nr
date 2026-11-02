//! High level planets after upgrades: level 8 at rank 3 (player report: every action
//! reverted), plus level 9 and every space type up to its rank limit.
//!
//! Stats and multipliers mirror `scripts/bootstrap/classify.ts`. Location bytes 9..13
//! below 16 double cap, growth, range, speed, and defense (`is_*_boost`).
mod admin_owner;
mod move_decay;
mod move_decay_vectors;
mod pirate_cap;
mod spaceship_activation;
mod spaceship_timing;

use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::FromField;
use ::libs::game_utils::_buff_planet;
use ::libs::lazy_update::{apply_arrival, update_planet};
use ::libs::move_decay::decayed_pop_arriving;
use ::libs::planet::{_initialize_planet, validate_upgrade_planet};
use ::types::args::DFPInitPlanetArgs;
use ::types::config::{
    default_stats::PlanetDefaultStats,
    space_junk::SpaceJunkConfig,
    upgrade::{Upgrade, UpgradeConfig},
    world::WorldConfig,
};
use ::types::storage::{
    arrival::{Arrival, ArrivalType},
    planet::{Planet, PlanetType, SpaceType, UpgradeBranch},
};

global PLAIN_LOCATION: Field = 0x1111111111111111111111111111111111111111111111111111111111111111;
global BOOSTED_LOCATION: Field = 0x0101010101010101010101010101010101010101010101010101010101010101;
global CREATED_AT: u64 = 1_000_000;
global U64_MAX: u64 = 18446744073709551615;

global D: u8 = UpgradeBranch::Defense;
global R: u8 = UpgradeBranch::Range;
global S: u8 = UpgradeBranch::Speed;

/// Every path is valid for max_branch_level = 4; only the first `max_rank` steps are applied.
global PATHS: [[u8; 5]; 4] = [[D, D, D, D, R], [R, R, R, R, S], [S, S, S, S, D], [D, R, S, D, R]];
global SPACE_TYPES: [u8; 4] =
    [SpaceType::Nebula, SpaceType::Space, SpaceType::DeepSpace, SpaceType::DeadSpace];

/// Send shares in basis points of population_cap: 0.01%, 0.1%, 1%, 25%, 50%, 100%.
global SHARES_BP: [u128; 6] = [1, 10, 100, 2500, 5000, 10000];

fn owner() -> AztecAddress {
    AztecAddress::from_field(0x0a11ce)
}

fn enemy() -> AztecAddress {
    AztecAddress::from_field(0x0e7e111)
}

fn level_stats(level: u8) -> PlanetDefaultStats {
    if level == 8 {
        PlanetDefaultStats {
            population_cap: 700000000,
            population_growth: 3750,
            range: 6306,
            speed: 75,
            defense: 200,
            silver_growth: 2778,
            silver_cap: 300000000,
            barbarian_percentage: 20,
        }
    } else {
        assert(level == 9, "fixture only covers levels 8 and 9");
        PlanetDefaultStats {
            population_cap: 800000000,
            population_growth: 4167,
            range: 8829,
            speed: 75,
            defense: 200,
            silver_growth: 2778,
            silver_cap: 400000000,
            barbarian_percentage: 25,
        }
    }
}

fn upgrade_for(branch: u8) -> Upgrade {
    if branch == UpgradeBranch::Defense {
        Upgrade {
            pop_cap_multiplier: 120,
            pop_gro_multiplier: 120,
            range_multiplier: 100,
            speed_multiplier: 100,
            def_multiplier: 120,
        }
    } else if branch == UpgradeBranch::Range {
        Upgrade {
            pop_cap_multiplier: 120,
            pop_gro_multiplier: 120,
            range_multiplier: 125,
            speed_multiplier: 100,
            def_multiplier: 100,
        }
    } else {
        Upgrade {
            pop_cap_multiplier: 120,
            pop_gro_multiplier: 120,
            range_multiplier: 100,
            speed_multiplier: 175,
            def_multiplier: 100,
        }
    }
}

fn max_rank(space_type: u8) -> u32 {
    let config = UpgradeConfig::zero();
    let max = if space_type == SpaceType::Nebula {
        config.max_total_level_nebula
    } else if space_type == SpaceType::Space {
        config.max_total_level_space
    } else if space_type == SpaceType::DeepSpace {
        config.max_total_level_deep_space
    } else {
        config.max_total_level_dead_space
    };
    max as u32
}

/// Owned, full of energy and silver, no upgrades.
fn new_planet(location: Field, level: u8, planet_type: u8, space_type: u8) -> Planet {
    let args = DFPInitPlanetArgs {
        location,
        perlin: 0,
        level,
        time_factor_hundredths: 100,
        space_type,
        planet_type,
        is_home_planet: false,
    };
    let mut planet = _initialize_planet(
        args,
        CREATED_AT,
        owner(),
        level_stats(level),
        WorldConfig::zero(),
        SpaceJunkConfig::zero(),
    );
    planet.owner = owner();
    planet.population = planet.population_cap;
    planet.silver = planet.silver_cap;
    planet
}

/// Copy of the upgrade steps in `upgrade_planet` (system/core/src/main.nr), after the
/// refresh. Keep in sync when that function changes.
fn upgrade_step(location: Field, mut planet: Planet, branch: u8) -> Planet {
    let (_, silver_cost) = validate_upgrade_planet(planet, branch, owner(), UpgradeConfig::zero());

    planet.silver -= silver_cost;
    if branch == UpgradeBranch::Defense {
        planet.upgrade_state_0 += 1;
    } else if branch == UpgradeBranch::Range {
        planet.upgrade_state_1 += 1;
    } else {
        planet.upgrade_state_2 += 1;
    }

    _buff_planet(location, planet, upgrade_for(branch)).1
}

/// Refills silver before each step so only the rank rules can stop an upgrade.
fn upgrade_along(location: Field, mut planet: Planet, path: [u8; 5], steps: u32) -> Planet {
    for i in 0..5 {
        if i < steps {
            planet.silver = planet.silver_cap;
            planet = upgrade_step(location, planet, path[i]);
        }
    }
    planet.population = planet.population_cap;
    planet
}

fn rank(planet: Planet) -> u32 {
    (planet.upgrade_state_0 + planet.upgrade_state_1 + planet.upgrade_state_2) as u32
}

fn assert_refresh_ok(planet: Planet) {
    let mut empty = planet;
    empty.population = 0;
    let elapsed: [u64; 3] = [0, 86_400, 31_536_000];
    for dt in elapsed {
        let refreshed = update_planet(CREATED_AT + dt, empty);
        assert(refreshed.population <= refreshed.population_cap, "refresh exceeded cap");
        assert_eq(refreshed.last_updated, CREATED_AT + dt);
    }
    let forever = update_planet(U64_MAX, empty);
    if planet.population_growth == 0 {
        // Silver banks never grow energy.
        assert_eq(forever.population, 0);
    } else {
        assert_eq(forever.population, forever.population_cap);
    }

    let full = update_planet(U64_MAX, planet);
    assert_eq(full.population, full.population_cap);
}

/// L * 100 = range * 432, the distance (times hundred) where a full send stops.
fn assert_move_decay_ok(planet: Planet) {
    let cap = planet.population_cap;
    let l_times_hundred = planet.range * 432;
    let distances: [u128; 5] = [0, 100, l_times_hundred / 2, l_times_hundred, l_times_hundred * 2];

    for bp in SHARES_BP {
        let pop = cap * bp / 10000;
        assert(pop > 0, "share rounds to zero energy");
        for dist in distances {
            let arriving = decayed_pop_arriving(pop, cap, planet.range, dist);
            assert(arriving <= pop, "more energy arrived than was sent");
            if dist == 0 {
                assert_eq(arriving, pop);
            }
            if dist == 100 {
                assert(arriving > 0, "nearby send arrives with nothing");
            }
            if dist >= l_times_hundred {
                assert_eq(arriving, 0);
            }
        }
        // Speed only divides distance; it must stay non-zero after upgrades.
        assert(planet.speed > 0, "speed is zero");
        let _travel_time = (l_times_hundred * 2 / planet.speed) as u64;
    }
}

fn assert_arrivals_ok(location: Field, planet: Planet) {
    let mut arrival = Arrival::zero();
    arrival.to_planet = location;
    arrival.arrival_type = ArrivalType::Normal;
    arrival.pop_arriving = planet.population_cap;
    arrival.silver_moved = planet.silver_cap;

    arrival.player = owner();
    let (_, friendly) = apply_arrival(planet, arrival);
    assert_eq(friendly.owner, owner());
    assert_eq(friendly.population, friendly.population_cap);
    assert_eq(friendly.silver, friendly.silver_cap);

    arrival.player = enemy();
    let (_, attacked) = apply_arrival(planet, arrival);
    assert(attacked.population <= attacked.population_cap, "attack exceeded cap");
    assert(attacked.population > 0, "attacked planet left with zero energy");

    let mut weak = planet;
    weak.population = 1;
    let (_, captured) = apply_arrival(weak, arrival);
    assert_eq(captured.owner, enemy());
    assert(captured.population <= captured.population_cap, "capture exceeded cap");
}

/// A ship arrival (0 energy) only delivers the ship. Arrivals stored before the fix
/// carry the controller as `player`, so both zero and real players are checked.
fn assert_ship_arrival_ok(location: Field, planet: Planet) {
    let ship_id: Field = 0x5417;
    let mut arrival = Arrival::zero();
    arrival.to_planet = location;
    arrival.arrival_type = ArrivalType::Normal;
    arrival.carried_artifact_id = ship_id;

    let mut empty = planet;
    empty.owner = AztecAddress::zero();
    empty.population = 0;
    empty.silver = 0;

    let players = [AztecAddress::zero(), enemy(), owner()];
    for player in players {
        arrival.player = player;

        let (carried, unowned) = apply_arrival(empty, arrival);
        assert_eq(carried, ship_id);
        assert_eq(unowned.owner, AztecAddress::zero());
        assert_eq(unowned.population, 0);
        assert_eq(unowned.silver, 0);

        let (carried, owned) = apply_arrival(planet, arrival);
        assert_eq(carried, ship_id);
        assert_eq(owned.owner, planet.owner);
        assert_eq(owned.population, planet.population);
        assert_eq(owned.silver, planet.silver);
    }
}

#[test]
unconstrained fn ship_arrival_never_conquers_or_adds_energy() {
    let planet_types: [u8; 2] = [PlanetType::Planet, PlanetType::SilverBank];
    for planet_type in planet_types {
        for space_type in SPACE_TYPES {
            let planet = new_planet(PLAIN_LOCATION, 8, planet_type, space_type);
            assert_ship_arrival_ok(PLAIN_LOCATION, planet);
        }
    }
}

fn assert_next_upgrade_ok(planet: Planet, branch: u8) {
    let mut ready = planet;
    ready.silver = ready.silver_cap;
    let total = rank(planet) as u128;
    let (_, cost) = validate_upgrade_planet(ready, branch, owner(), UpgradeConfig::zero());
    assert_eq(cost, planet.silver_cap * 20 * (total + 1) / 100);
}

fn assert_all_actions_ok(location: Field, planet: Planet) {
    assert_refresh_ok(planet);
    assert_move_decay_ok(planet);
    assert_arrivals_ok(location, planet);
}

#[test]
unconstrained fn level8_rank3_nebula_defense_path_stats() {
    let base = new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::Nebula);
    let planet = upgrade_along(PLAIN_LOCATION, base, [D, D, D, D, R], 3);

    assert_eq(rank(planet), 3);
    // 700_000_000 * 1.2^3, exact in integer math.
    assert_eq(planet.population_cap, 1_209_600_000);
    assert_eq(planet.population_growth, 6480);
    // 200 -> 240 -> 288 -> 345 (345.6 truncated).
    assert_eq(planet.defense, 345);
    assert_eq(planet.range, 6306);
    assert_eq(planet.speed, 75);
}

/// Same stats as scripts/check/high-level-planet-sample.ts (state hash fixed sample).
#[test]
unconstrained fn level8_rank3_dead_space_defense_path_stats() {
    let base = new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::DeadSpace);
    let planet = upgrade_along(PLAIN_LOCATION, base, [D, D, D, D, R], 3);

    assert_eq(planet.upgrade_state_0, 3);
    assert_eq(planet.population_cap, 2_419_200_000);
    assert_eq(planet.population_growth, 12_960);
    assert_eq(planet.range, 12_612);
    assert_eq(planet.speed, 150);
    assert_eq(planet.defense, 51);
    assert_eq(planet.silver_cap, 600_000_000);
    assert_eq(planet.silver_growth, 0);
    assert_eq(planet.space_junk, 60);
}

#[test]
unconstrained fn level8_and_level9_every_space_type_and_path_survive_all_actions() {
    let levels: [u8; 2] = [8, 9];
    let locations: [Field; 2] = [PLAIN_LOCATION, BOOSTED_LOCATION];
    for level in levels {
        for location in locations {
            for space_type in SPACE_TYPES {
                let base = new_planet(location, level, PlanetType::Planet, space_type);
                let top = max_rank(space_type);
                for path in PATHS {
                    for steps in 0..6 {
                        if steps <= top {
                            let planet = upgrade_along(location, base, path, steps);
                            assert_eq(rank(planet), steps);
                            assert_all_actions_ok(location, planet);
                            if steps < top {
                                assert_next_upgrade_ok(planet, path[steps]);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
unconstrained fn silver_banks_survive_all_actions() {
    let levels: [u8; 2] = [8, 9];
    let locations: [Field; 2] = [PLAIN_LOCATION, BOOSTED_LOCATION];
    for level in levels {
        for location in locations {
            for space_type in SPACE_TYPES {
                let planet = new_planet(location, level, PlanetType::SilverBank, space_type);
                assert_all_actions_ok(location, planet);
            }
        }
    }
}

#[test(should_fail_with = "Planet is maxed")]
unconstrained fn level8_rank3_nebula_cannot_upgrade_again() {
    let base = new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::Nebula);
    let planet = upgrade_along(PLAIN_LOCATION, base, [D, R, S, D, R], 3);
    let _ = validate_upgrade_planet(planet, UpgradeBranch::Speed, owner(), UpgradeConfig::zero());
}

#[test]
unconstrained fn level8_rank3_space_can_still_upgrade() {
    let base = new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::Space);
    let planet = upgrade_along(PLAIN_LOCATION, base, [D, R, S, D, R], 4);
    assert_eq(rank(planet), 4);
}

#[test(should_fail_with = "Branch level maxed")]
unconstrained fn fifth_upgrade_on_one_branch_is_rejected() {
    let base = new_planet(PLAIN_LOCATION, 8, PlanetType::Planet, SpaceType::DeadSpace);
    let _ = upgrade_along(PLAIN_LOCATION, base, [D, D, D, D, D], 5);
}

#[test(should_fail_with = "Can only upgrade regular planets")]
unconstrained fn silver_bank_cannot_upgrade() {
    let planet = new_planet(PLAIN_LOCATION, 8, PlanetType::SilverBank, SpaceType::Nebula);
    let _ = validate_upgrade_planet(
        planet,
        UpgradeBranch::Defense,
        owner(),
        UpgradeConfig::zero(),
    );
}

/// Largest values the game can produce: level 9, every location boost, dead space,
/// rank 5 along the range-heavy path, sending 100% across 2^33 distance units
/// (coordinates are capped at 2^31). Every intermediate must stay far below u128.
#[test]
unconstrained fn worst_case_intermediates_stay_below_2_pow_100() {
    let bound: u128 = 0x10000000000000000000000000; // 2^100
    let base = new_planet(
        BOOSTED_LOCATION,
        9,
        PlanetType::Planet,
        SpaceType::DeadSpace,
    );
    let regular = upgrade_along(BOOSTED_LOCATION, base, [R, R, R, R, S], 5);
    let bank = new_planet(
        BOOSTED_LOCATION,
        9,
        PlanetType::SilverBank,
        SpaceType::DeadSpace,
    );
    let far: u128 = 0x200000000 * 100; // 2^33 distance units, times hundred

    let planets = [regular, bank];
    for planet in planets {
        let cap = planet.population_cap;
        let pop = cap;

        // Same expressions as decayed_pop_arriving for a full send.
        let dist_scaled = far * 100 * cap;
        let d_factor = planet.range * 21600 * (cap + pop);
        assert(dist_scaled < bound, "dist_scaled near u128 limit");
        assert(d_factor < bound, "d_factor near u128 limit");
        assert(pop * d_factor < bound, "pop * d_factor near u128 limit");
        assert_eq(decayed_pop_arriving(pop, cap, planet.range, far), 0);
        assert_eq(decayed_pop_arriving(pop, cap, planet.range, 0), pop);

        // Growth over the whole u64 range.
        let growth = planet.population_growth * (U64_MAX as u128);
        assert(growth < bound, "growth near u128 limit");

        // Attack resolution multiplies population by defense and arrivals by 100.
        assert(cap * planet.defense < bound, "defense product near u128 limit");
        assert(cap * 100 < bound, "arrival product near u128 limit");

        // Upgrade silver cost at the highest rank.
        assert(planet.silver_cap * 20 * 6 < bound, "silver cost near u128 limit");

        assert_all_actions_ok(BOOSTED_LOCATION, planet);
    }
}
