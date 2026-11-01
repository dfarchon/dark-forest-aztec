// Checks every storage state against hashes computed by the TypeScript client
// (scripts/check/state-hash-vectors.ts). A change to the Aztec Poseidon2 sponge,
// to a struct layout, or to the client field order fails here.
mod vectors;

use ::aztec::{
    macros::events::event,
    protocol::{address::AztecAddress, hash::poseidon2_hash, traits::{FromField, Serialize}},
};
use ::macros::StateHash;
use ::types::storage::{
    arrival::Arrival,
    artifact::{Artifact, ArtifactLocation},
    planet::{Planet, PlanetArtifacts, PlanetEvents, PlanetRevealedCoords},
    player::Player,
    world::World,
};

global ID: Field = 7;
global BLOCK_NUMBER: u32 = 42;

#[event]
#[::macros::state_update]
struct PlanetUpdate {
    id: Field,
    block_number: u32,
    state: Planet,
}

#[event]
#[::macros::state_update]
struct PlanetRevealedCoordsUpdate {
    id: Field,
    block_number: u32,
    state: PlanetRevealedCoords,
}

#[event]
#[::macros::state_update]
struct PlanetEventsUpdate {
    id: Field,
    block_number: u32,
    state: PlanetEvents,
}

#[event]
#[::macros::state_update]
struct PlanetArtifactsUpdate {
    id: Field,
    block_number: u32,
    state: PlanetArtifacts,
}

#[event]
#[::macros::state_update]
struct ArrivalUpdate {
    id: Field,
    block_number: u32,
    state: Arrival,
}

#[event]
#[::macros::state_update]
struct ArtifactUpdate {
    id: Field,
    block_number: u32,
    state: Artifact,
}

#[event]
#[::macros::state_update]
struct ArtifactLocationUpdate {
    id: Field,
    block_number: u32,
    state: ArtifactLocation,
}

#[event]
#[::macros::state_update]
struct PlayerUpdate {
    id: AztecAddress,
    block_number: u32,
    state: Player,
}

#[event]
#[::macros::state_update]
struct WorldUpdate {
    id: Field,
    block_number: u32,
    state: World,
}

// The log must match what `self.emit` produced before: [tag, id, block_number, ...serialize()].
fn check<T, let L: u32>(state: T, expected: Field, update: (Field, [Field; L]))
where
    T: Serialize + StateHash,
{
    let fields = state.serialize();
    assert_eq(poseidon2_hash(fields), expected);
    assert_eq(state.state_hash(), expected);
    let (root, log) = update;
    assert_eq(root, expected);
    assert_eq(L, fields.len() + 3);
    assert_eq(log[1], ID);
    assert_eq(log[2], BLOCK_NUMBER as Field);
    for i in 0..fields.len() {
        assert_eq(log[i + 3], fields[i]);
    }
}

fn check_all() {
    for entry in vectors::planet() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            PlanetUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::planet_revealed_coords() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            PlanetRevealedCoordsUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::planet_events() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            PlanetEventsUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::planet_artifacts() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            PlanetArtifactsUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::arrival() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            ArrivalUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::artifact() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            ArtifactUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::artifact_location() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            ArtifactLocationUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::player() {
        let (state, expected) = entry;
        let id = AztecAddress::from_field(ID);
        check(
            state,
            expected,
            PlayerUpdate::encode_update(id, BLOCK_NUMBER, state),
        );
    }
    for entry in vectors::world() {
        let (state, expected) = entry;
        check(
            state,
            expected,
            WorldUpdate::encode_update(ID, BLOCK_NUMBER, state),
        );
    }
}

#[test]
fn state_hashes_match_client_vectors() {
    check_all();
}

// Public storage writes run the unconstrained branch of poseidon2_hash.
#[test]
unconstrained fn state_hashes_match_client_vectors_unconstrained() {
    check_all();
}
