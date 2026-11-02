// Pirate cap (H-04): unowned planets keep their space-type-buffed pirates above
// population_cap, except silver banks. A Titan never weakens pirates.
use crate::{CREATED_AT, enemy, level_stats, owner, PLAIN_LOCATION};
use ::aztec::protocol::address::AztecAddress;
use ::libs::lazy_update::{apply_arrival, update_planet};
use ::libs::planet::_initialize_planet;
use ::types::args::DFPInitPlanetArgs;
use ::types::config::{space_junk::SpaceJunkConfig, world::WorldConfig};
use ::types::storage::{arrival::{Arrival, ArrivalType}, planet::{Planet, PlanetType, SpaceType}};

fn unowned_planet(level: u8, planet_type: u8, space_type: u8) -> Planet {
    let args = DFPInitPlanetArgs {
        location: PLAIN_LOCATION,
        perlin: 0,
        level,
        time_factor_hundredths: 100,
        space_type,
        planet_type,
        is_home_planet: false,
    };
    let planet = _initialize_planet(
        args,
        CREATED_AT,
        owner(),
        level_stats(level),
        WorldConfig::zero(),
        SpaceJunkConfig::zero(),
    );
    assert_eq(planet.owner, AztecAddress::zero());
    planet
}

fn attack(planet: Planet, pop_arriving: u128) -> Planet {
    let mut arrival = Arrival::zero();
    arrival.to_planet = PLAIN_LOCATION;
    arrival.arrival_type = ArrivalType::Normal;
    arrival.player = enemy();
    arrival.pop_arriving = pop_arriving;
    apply_arrival(planet, arrival).1
}

/// (level, space_type, pirates as a multiple of population_cap, in hundredths)
global OVERFULL: [(u8, u8, u128); 3] = [
    (9, SpaceType::DeadSpace, 500),
    (8, SpaceType::DeadSpace, 400),
    (9, SpaceType::DeepSpace, 250),
];

#[test]
unconstrained fn unowned_pirates_survive_refresh_above_cap() {
    for case in OVERFULL {
        let (level, space_type, ratio) = case;
        let planet = unowned_planet(level, PlanetType::Planet, space_type);
        assert_eq(planet.population, planet.population_cap * ratio / 100);

        let elapsed: [u64; 3] = [0, 86_400, 31_536_000];
        for dt in elapsed {
            let refreshed = update_planet(CREATED_AT + dt, planet);
            assert_eq(refreshed.population, planet.population);
            assert(refreshed.population > refreshed.population_cap, "pirates capped on refresh");
        }
    }
}

#[test]
unconstrained fn failed_attack_leaves_remaining_pirates_uncapped() {
    for case in OVERFULL {
        let (level, space_type, _) = case;
        let planet = update_planet(
            CREATED_AT + 86_400,
            unowned_planet(level, PlanetType::Planet, space_type),
        );
        let pop_arriving = planet.population_cap / 10;
        let attacked = attack(planet, pop_arriving);

        assert_eq(attacked.owner, AztecAddress::zero());
        assert_eq(attacked.population, planet.population - pop_arriving * 100 / planet.defense);
        assert(attacked.population > attacked.population_cap, "remaining pirates capped");
    }
}

#[test]
unconstrained fn conquest_caps_survivors() {
    for case in OVERFULL {
        let (level, space_type, _) = case;
        let planet = unowned_planet(level, PlanetType::Planet, space_type);
        // Enough to beat the pirates and still overflow the cap.
        let pop_arriving = planet.population * planet.defense / 100 + planet.population_cap * 2;
        let captured = attack(planet, pop_arriving);

        assert_eq(captured.owner, enemy());
        assert_eq(captured.population, captured.population_cap);

        let refreshed = update_planet(CREATED_AT + 31_536_000, captured);
        assert_eq(refreshed.population, refreshed.population_cap);
    }
}

#[test]
unconstrained fn titan_does_not_cap_unowned_pirates() {
    let mut planet = unowned_planet(9, PlanetType::Planet, SpaceType::DeadSpace);
    planet.pausers = 1;

    let refreshed = update_planet(CREATED_AT + 86_400, planet);
    assert_eq(refreshed.population, planet.population);
    assert(refreshed.population > refreshed.population_cap, "titan capped pirates");

    let attacked = attack(refreshed, refreshed.population_cap / 10);
    assert(attacked.population > attacked.population_cap, "titan capped remaining pirates");
}

#[test]
unconstrained fn titan_paused_owned_planet_stays_capped() {
    let mut planet = unowned_planet(9, PlanetType::Planet, SpaceType::DeadSpace);
    planet.owner = owner();
    planet.pausers = 1;

    let refreshed = update_planet(CREATED_AT + 86_400, planet);
    assert_eq(refreshed.population, refreshed.population_cap);
}

#[test]
unconstrained fn unowned_silver_bank_is_capped() {
    let planet = unowned_planet(9, PlanetType::SilverBank, SpaceType::DeadSpace);
    assert(planet.population > planet.population_cap, "fixture should start overfull");

    let refreshed = update_planet(CREATED_AT + 86_400, planet);
    assert_eq(refreshed.population, refreshed.population_cap);
}
