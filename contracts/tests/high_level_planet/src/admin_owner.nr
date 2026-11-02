// Admin writes (M-01, M-03): a planet must stay settleable after an admin changes it.
use crate::{CREATED_AT, level_stats, owner, PLAIN_LOCATION};
use ::libs::lazy_update::update_planet;
use ::libs::planet::_initialize_planet;
use ::types::args::DFPInitPlanetArgs;
use ::types::config::{space_junk::SpaceJunkConfig, world::WorldConfig};
use ::types::storage::planet::{Planet, PlanetType, SpaceType};

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
