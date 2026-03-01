use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Serialize, Deserialize, Packable)]
pub struct DFPInitPlanetArgs {
    pub location: Field,
    pub perlin: u8,
    pub level: u8,
    pub time_factor_hundredths: u16,
    pub space_type: u8, // SpaceType enum (stored as u8, use helper functions to convert)
    pub planet_type: u8, // PlanetType enum (stored as u8, use helper functions to convert)
    pub is_home_planet: bool,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct AdminCreatePlanetArgs {
    pub location: Field,
    pub perlin: u8,
    pub level: u8,
    pub planet_type: u8, // PlanetType enum (stored as u8, use helper functions to convert)
    pub require_valid_location_id: bool,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct DFPMoveArgs {
    pub old_loc: Field,
    pub new_loc: Field,
    pub max_dist: u128,
    pub pop_moved: u128,
    pub silver_moved: u128,
    pub moved_artifact_id: Field,
    pub is_abandoning: bool,
    pub sender: AztecAddress,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct DFPCreateArrivalArgs {
    pub player: AztecAddress,
    pub oldLoc: Field,
    pub new_loc: Field,
    pub actual_dist: u128,
    pub effective_dist_times_hundred: u128,
    pub pop_moved: u128,
    pub silver_moved: u128,
    pub travel_time: u64,
    pub moved_artifact_id: Field,
    pub arrival_type: u8, // ArrivalType enum (stored as u8)
}

/// Args for creating an artifact (Noir equivalent of Solidity DFTCreateArtifactArgs).
#[derive(Serialize, Deserialize, Packable)]
pub struct DFTCreateArtifactArgs {
    pub id: Field,
    pub planet_id: Field,
    pub rarity: u8,
    pub biome: u8,
    pub artifact_type: u8,
    pub discoverer: AztecAddress,
    pub controller: AztecAddress,
}

/// Args for finding / rolling a new artifact on a planet (Noir equivalent of Solidity DFPFindArtifactArgs).
#[derive(Serialize, Deserialize, Packable)]
pub struct DFPFindArtifactArgs {
    pub planet_id: Field,
    pub biomebase: u128,
    pub core_address: AztecAddress,
    pub snark_perlin_planethash_key: u128,
    pub snark_perlin_biomebase_key: u128,
    pub snark_perlin_length_scale: u128,
    pub snark_perlin_mirror_x: u8,
    pub snark_perlin_mirror_y: u8,
}
