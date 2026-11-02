// Admin writes (M-01, M-03): a planet must stay settleable after an admin changes it.
use crate::{CREATED_AT, enemy, level_stats, owner, PLAIN_LOCATION};
use ::aztec::protocol::address::AztecAddress;
use ::libs::lazy_update::{apply_arrival, update_planet};
use ::libs::planet::_initialize_planet;
use ::types::args::DFPInitPlanetArgs;
use ::types::config::{space_junk::SpaceJunkConfig, world::WorldConfig};
use ::types::storage::{arrival::{Arrival, ArrivalType}, planet::{Planet, PlanetType, SpaceType}};

fn owned_planet() -> Planet {
    let args = DFPInitPlanetArgs {
        location: PLAIN_LOCATION,
        perlin: 0,
        level: 8,
        time_factor_hundredths: 100,
        space_type: SpaceType::Nebula,
        planet_type: PlanetType::Planet,
        is_home_planet: false,
    };
    let mut planet = _initialize_planet(
        args,
        CREATED_AT,
        owner(),
        level_stats(8),
        WorldConfig::zero(),
        SpaceJunkConfig::zero(),
    );
    planet.owner = owner();
    planet.last_updated = CREATED_AT;
    planet
}

#[test]
unconstrained fn update_to_same_or_later_time_succeeds() {
    let planet = owned_planet();
    assert_eq(update_planet(CREATED_AT, planet).last_updated, CREATED_AT);
    assert_eq(update_planet(CREATED_AT + 1, planet).last_updated, CREATED_AT + 1);
}

/// A due arrival older than `last_updated` (what the old `safe_set_owner` produced)
/// must revert with a clear message instead of underflowing.
#[test(should_fail_with = "Cannot update planet to an earlier time")]
unconstrained fn update_to_earlier_time_fails() {
    let planet = owned_planet();
    let _ = update_planet(CREATED_AT - 1, planet);
}

/// What the old `set_owner` wrote on an empty slot: an owner and nothing else.
fn defenseless_planet() -> Planet {
    let mut planet = Planet::zero();
    planet.owner = owner();
    planet
}

fn arrival_from(player: AztecAddress, arrival_type: u8) -> Arrival {
    let mut arrival = Arrival::zero();
    arrival.to_planet = PLAIN_LOCATION;
    arrival.arrival_type = arrival_type;
    arrival.player = player;
    arrival.pop_arriving = 100;
    arrival
}

#[test(should_fail_with = "Planet defense is 0")]
unconstrained fn enemy_arrival_on_zero_defense_fails() {
    let _ = apply_arrival(
        defenseless_planet(),
        arrival_from(enemy(), ArrivalType::Normal),
    );
}

#[test]
unconstrained fn friendly_and_wormhole_arrivals_skip_the_defense_division() {
    let (_, friendly) = apply_arrival(
        defenseless_planet(),
        arrival_from(owner(), ArrivalType::Normal),
    );
    assert_eq(friendly.owner, owner());

    let (_, wormhole) = apply_arrival(
        defenseless_planet(),
        arrival_from(enemy(), ArrivalType::Wormhole),
    );
    assert_eq(wormhole.owner, owner());
    assert_eq(wormhole.population, 0);
}
