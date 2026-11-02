// Spaceship activation checks (H-03): only the controller may activate, and only the Crescent.
use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::FromField;
use ::libs::artifact_utils::assert_can_activate_spaceship;
use ::types::storage::{artifact::{Artifact, ArtifactType}, planet::{Planet, PlanetType}};

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
