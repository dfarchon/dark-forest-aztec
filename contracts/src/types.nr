// Dark Forest v0.6 Types
// All enums and structs converted from Solidity to Noir
//
// Enum Strategy (Option A): Enums are defined for type safety in function signatures,
// but structs use u8 for enum fields because Noir enums don't support Serialize/Deserialize/Packable yet.
// Use helper functions to convert between enum types and u8 values when needed.

use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};
use dep::std::meta::derive;

// ========== Enums ==========
// Note: Enums don't have derive attributes - they're for type safety only
// Structs store enum values as u8

pub enum PlanetType {
    Planet,
    SilverMine,
    Ruins,
    TradingPost,
    SilverBank,
}

pub enum PlanetEventType {
    Arrival,
}

pub enum SpaceType {
    Nebula,
    Space,
    DeepSpace,
    DeadSpace,
}

pub enum UpgradeBranch {
    Defense,
    Range,
    Speed,
}

pub enum ArrivalType {
    Unknown,
    Normal,
    Photoid,
    Wormhole,
}

pub enum ArtifactType {
    Unknown,
    Monolith,
    Colossus,
    Spaceship,
    Pyramid,
    Wormhole,
    PlanetaryShield,
    PhotoidCannon,
    BloomFilter,
    BlackDomain,
    ShipMothership,
    ShipCrescent,
    ShipWhale,
    ShipGear,
    ShipTitan,
}

pub enum ArtifactRarity {
    Unknown,
    Common,
    Rare,
    Epic,
    Legendary,
    Mythic,
}

pub enum Biome {
    Unknown,
    Ocean,
    Forest,
    Grassland,
    Tundra,
    Swamp,
    Desert,
    Ice,
    Wasteland,
    Lava,
    Corrupted,
}

// ========== Structs ==========

#[derive(Serialize, Deserialize, Packable)]
pub struct Player {
    pub is_initialized: bool,
    pub player: AztecAddress,
    pub init_timestamp: u128,
    pub home_planet_id: Field,
    pub last_reveal_timestamp: u128,
    pub score: u128,
    pub space_junk: u128,
    pub space_junk_limit: u128,
    pub claimed_ships: bool,
    pub final_rank: u128,
    pub claimed_reward: bool,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct Planet {
    pub owner: AztecAddress,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub population: u128,        // Energy
    pub population_cap: u128,   // Energy cap
    pub population_growth: u128, // Energy growth
    pub silver_cap: u128,
    pub silver_growth: u128,
    pub silver: u128,
    pub planet_level: u8,
    pub planet_type: u8, // PlanetType enum (stored as u8, use helper functions to convert)
    pub is_home_planet: bool,
    pub is_initialized: bool,
    pub created_at: u128,        // Block number
    pub last_updated: u128,       // Block number
    pub perlin: u8,
    pub space_type: u8, // SpaceType enum (stored as u8, use helper functions to convert)
    pub upgrade_state_0: u128,
    pub upgrade_state_1: u128,
    pub upgrade_state_2: u128,
    pub hat_level: u128,
    pub has_tried_finding_artifact: bool,
    pub prospected_block_number: u128,
    pub destroyed: bool,
    pub space_junk: u128,
    pub pausers: u128,
    pub energy_gro_doublers: u128,
    pub silver_gro_doublers: u128,
    pub invader: AztecAddress,
    pub invade_start_block: u128,
    pub capturer: AztecAddress,
    pub location_id: Field,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct RevealedCoords {
    pub location_id: Field,
    pub x: u128,
    pub y: u128,
    pub revealer: AztecAddress,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetData {
    pub planet: Planet,
    pub revealed_coords: RevealedCoords,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct ArrivalData {
    pub id: u128,
    pub player: AztecAddress,
    pub from_planet: Field,
    pub to_planet: Field,
    pub pop_arriving: u128,
    pub silver_moved: u128,
    pub departure_time: u128,
    pub arrival_time: u128,
    pub arrival_type: u8, // ArrivalType enum (stored as u8, use helper functions to convert)
    pub carried_artifact_id: u128,
    pub distance: u128,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct Artifact {
    pub is_initialized: bool,
    pub id: u128,
    pub planet_discovered_on: Field,
    pub rarity: u8, // ArtifactRarity enum (stored as u8, use helper functions to convert)
    pub planet_biome: u8, // Biome enum (stored as u8, use helper functions to convert)
    pub minted_at_timestamp: u128,
    pub discoverer: AztecAddress,
    pub artifact_type: u8, // ArtifactType enum (stored as u8, use helper functions to convert)
    pub activations: u128,
    pub last_activated: u128,
    pub last_deactivated: u128,
    pub wormhole_to: Field,
    pub controller: AztecAddress,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct Upgrade {
    pub pop_cap_multiplier: u128,
    pub pop_gro_multiplier: u128,
    pub range_multiplier: u128,
    pub speed_multiplier: u128,
    pub def_multiplier: u128,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetDefaultStats {
    pub population_cap: u128,
    pub population_growth: u128,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub silver_growth: u128,
    pub silver_cap: u128,
    pub barbarian_percentage: u128,
}

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetEventMetadata {
    pub id: u128,
    pub event_type: u8, // PlanetEventType enum (stored as u8, use helper functions to convert)
    pub time_trigger: u128,
    pub time_created: u128,
}
