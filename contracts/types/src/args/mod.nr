use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};
use dep::aztec::protocol_types::address::AztecAddress;


#[derive(Serialize, Deserialize, Packable)]
pub struct DFPInitPlanetArgs {
    pub location: Field,
    pub perlin: u8,
    pub level: u8,
    pub time_factor_hundredths: u128,
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
    pub abandoning: u128,
    pub sender: AztecAddress,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct DFPCreateArrivalArgs {
    pub player: AztecAddress,
    pub old_loc: Field,
    pub new_loc: Field,
    pub actual_dist: u128,
    pub effective_dist_times_hundred: u128,
    pub pop_moved: u128,
    pub silver_moved: u128,
    pub travel_time: u64,
    pub moved_artifact_id: Field,
    pub arrival_type: u8, // ArrivalType enum (stored as u8)
}