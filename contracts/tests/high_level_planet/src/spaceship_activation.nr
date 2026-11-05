// Only the controller may activate a spaceship, and only the Crescent.
// Activating a crescent copies silver stats from the default mine of the same place.
use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::FromField;
use ::libs::artifact_utils::{apply_crescent, assert_can_activate_spaceship};
use ::libs::game_utils::_default_planet;
use ::types::config::default_stats::PlanetDefaultStats;
use ::types::storage::{artifact::{Artifact, ArtifactType}, planet::{Planet, PlanetType, SpaceType}};

fn controller() -> AztecAddress {
    AztecAddress::from_field(0x0a11ce)
}

fn stranger() -> AztecAddress {
    AztecAddress::from_field(0x0e7e111)
}

fn ship(artifact_type: u8) -> Artifact {
    let mut artifact = Artifact::zero();
    artifact.artifact_type = artifact_type;
    artifact.controller = controller();
    artifact
}

fn unowned_planet() -> Planet {
    let mut planet = Planet::zero();
    planet.planet_level = 1;
    planet.planet_type = PlanetType::Planet;
    planet
}

#[test]
unconstrained fn controller_can_activate_fresh_crescent_on_unowned_planet() {
    assert_can_activate_spaceship(
        ship(ArtifactType::ShipCrescent),
        unowned_planet(),
        controller(),
    );
}

#[test(should_fail_with = "you can only activate a spaceship you control")]
unconstrained fn stranger_cannot_activate_crescent() {
    assert_can_activate_spaceship(
        ship(ArtifactType::ShipCrescent),
        unowned_planet(),
        stranger(),
    );
}

#[test(should_fail_with = "you can only activate a spaceship you control")]
unconstrained fn stranger_cannot_activate_titan() {
    assert_can_activate_spaceship(ship(ArtifactType::ShipTitan), unowned_planet(), stranger());
}

#[test(should_fail_with = "only the crescent can be activated")]
unconstrained fn controller_cannot_activate_mothership() {
    assert_can_activate_spaceship(
        ship(ArtifactType::ShipMothership),
        unowned_planet(),
        controller(),
    );
}

#[test(should_fail_with = "only the crescent can be activated")]
unconstrained fn controller_cannot_activate_whale() {
    assert_can_activate_spaceship(
        ship(ArtifactType::ShipWhale),
        unowned_planet(),
        controller(),
    );
}

#[test(should_fail_with = "only the crescent can be activated")]
unconstrained fn controller_cannot_activate_gear() {
    assert_can_activate_spaceship(ship(ArtifactType::ShipGear), unowned_planet(), controller());
}

#[test(should_fail_with = "only the crescent can be activated")]
unconstrained fn controller_cannot_activate_titan() {
    assert_can_activate_spaceship(
        ship(ArtifactType::ShipTitan),
        unowned_planet(),
        controller(),
    );
}

#[test(should_fail_with = "crescent cannot be activated more than once")]
unconstrained fn crescent_cannot_be_activated_twice() {
    let mut crescent = ship(ArtifactType::ShipCrescent);
    crescent.activations = 1;
    assert_can_activate_spaceship(crescent, unowned_planet(), controller());
}

#[test(should_fail_with = "can only activate crescent on unowned planets")]
unconstrained fn crescent_rejects_owned_planet() {
    let mut planet = unowned_planet();
    planet.owner = stranger();
    assert_can_activate_spaceship(ship(ArtifactType::ShipCrescent), planet, controller());
}

#[test(should_fail_with = "planet level must be more than one")]
unconstrained fn crescent_rejects_level_zero_planet() {
    let mut planet = unowned_planet();
    planet.planet_level = 0;
    assert_can_activate_spaceship(ship(ArtifactType::ShipCrescent), planet, controller());
}

#[test(should_fail_with = "cannot turn a silver mine into a silver mine")]
unconstrained fn crescent_rejects_silver_mine() {
    let mut planet = unowned_planet();
    planet.planet_type = PlanetType::SilverMine;
    assert_can_activate_spaceship(ship(ArtifactType::ShipCrescent), planet, controller());
}

global CRESCENT_LOCATION: Field = 0x2222;
global CRESCENT_TIME_FACTOR: u16 = 100;

fn level_one_stats() -> PlanetDefaultStats {
    PlanetDefaultStats {
        population_cap: 400000,
        population_growth: 833,
        range: 177,
        speed: 75,
        defense: 400,
        silver_growth: 56,
        silver_cap: 100000,
        barbarian_percentage: 1,
    }
}

fn spawned(planet_type: u8) -> Planet {
    _default_planet(
        CRESCENT_LOCATION,
        1,
        planet_type,
        SpaceType::Space,
        CRESCENT_TIME_FACTOR,
        level_one_stats(),
    )
}

fn default_mine() -> Planet {
    spawned(PlanetType::SilverMine)
}

fn assert_default_mine_stats(planet: Planet, growth_multiplier: u128) {
    let expected = default_mine();
    assert_eq(planet.planet_type, PlanetType::SilverMine);
    assert_eq(planet.silver_growth, expected.silver_growth * growth_multiplier);
    assert_eq(planet.silver_cap, expected.silver_cap);
    assert_eq(planet.defense, expected.defense);
}

#[test]
unconstrained fn crescent_seeds_empty_planet_from_default_mine() {
    let mut planet = spawned(PlanetType::Planet);
    planet.population = 42;
    let range = planet.range;
    let speed = planet.speed;
    let owner = planet.owner;
    let converted = apply_crescent(
        planet,
        CRESCENT_LOCATION,
        CRESCENT_TIME_FACTOR,
        level_one_stats(),
    );

    assert_default_mine_stats(converted, 1);
    assert_eq(converted.silver, 1);
    assert_eq(converted.population, 42);
    assert_eq(converted.range, range);
    assert_eq(converted.speed, speed);
    assert_eq(converted.owner, owner);
}

#[test]
unconstrained fn crescent_keeps_existing_silver() {
    let mut planet = spawned(PlanetType::Planet);
    planet.silver = 500;
    let converted = apply_crescent(
        planet,
        CRESCENT_LOCATION,
        CRESCENT_TIME_FACTOR,
        level_one_stats(),
    );

    assert_default_mine_stats(converted, 1);
    assert_eq(converted.silver, 500);
}

#[test]
unconstrained fn crescent_clamps_silver_bank_to_mine_cap() {
    let mut bank = spawned(PlanetType::SilverBank);
    let mine_cap = default_mine().silver_cap;
    assert(bank.silver_cap > mine_cap, "silver bank cap should exceed the mine cap");
    bank.silver = bank.silver_cap;
    let speed = bank.speed;
    let population_cap = bank.population_cap;
    let converted = apply_crescent(
        bank,
        CRESCENT_LOCATION,
        CRESCENT_TIME_FACTOR,
        level_one_stats(),
    );

    assert_default_mine_stats(converted, 1);
    assert_eq(converted.silver, mine_cap);
    assert_eq(converted.speed, speed);
    assert_eq(converted.population_cap, population_cap);
}

#[test]
unconstrained fn crescent_doubles_growth_when_whale_is_docked() {
    let mut planet = spawned(PlanetType::Planet);
    planet.silver_gro_doublers = 1;
    let converted = apply_crescent(
        planet,
        CRESCENT_LOCATION,
        CRESCENT_TIME_FACTOR,
        level_one_stats(),
    );

    assert_default_mine_stats(converted, 2);
    assert_eq(converted.silver, 1);
}
