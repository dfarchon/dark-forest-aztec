use ::aztec::protocol::address::AztecAddress;
use ::aztec::protocol::traits::{Deserialize, Packable, Serialize};

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct Planet {
    // PlanetMeta
    // pub location_id: Field,
    pub perlin: u8,
    pub created_at: u64,
    // PlanetOwner
    pub owner: AztecAddress,
    pub planet_level: u8,
    pub planet_type: u8, // 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
    pub space_type: u8, // 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
    pub is_home_planet: bool,
    pub is_initialized: bool,
    pub destroyed: bool,
    pub invader: AztecAddress,
    pub capturer: AztecAddress,
    pub invade_start_block: u32,
    // PlanetCaps
    pub population_cap: u128,
    pub population_growth: u128,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub silver_cap: u128,
    pub silver_growth: u128,
    // PlanetResources
    pub population: u128,
    pub silver: u128,
    pub upgrade_state_0: u8,
    pub upgrade_state_1: u8,
    pub upgrade_state_2: u8,
    pub last_updated: u64,
    // PlanetMods
    pub pausers: u128,
    pub energy_gro_doublers: u128,
    pub silver_gro_doublers: u128,
    pub hat_level: u128,
    pub space_junk: u128,
    pub has_tried_finding_artifact: bool,
    pub prospected_block_number: u32,
}

impl Planet {
    pub fn zero() -> Self {
        Planet {
            // location_id: 0 as Field,
            perlin: 0,
            created_at: 0,
            owner: AztecAddress::zero(),
            planet_level: 0,
            planet_type: 0,
            space_type: 0,
            is_home_planet: false,
            is_initialized: false,
            destroyed: false,
            invader: AztecAddress::zero(),
            capturer: AztecAddress::zero(),
            invade_start_block: 0,
            population_cap: 0,
            population_growth: 0,
            range: 0,
            speed: 0,
            defense: 0,
            silver_cap: 0,
            silver_growth: 0,
            population: 0,
            silver: 0,
            upgrade_state_0: 0,
            upgrade_state_1: 0,
            upgrade_state_2: 0,
            last_updated: 0,
            pausers: 0,
            energy_gro_doublers: 0,
            silver_gro_doublers: 0,
            hat_level: 0,
            space_junk: 0,
            has_tried_finding_artifact: false,
            prospected_block_number: 0,
        }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetRevealedCoords {
    pub location_id: Field,
    pub x: Field,
    pub y: Field,
    pub revealer: AztecAddress,
}

impl PlanetRevealedCoords {
    pub fn zero() -> Self {
        Self {
            location_id: 0 as Field,
            x: 0 as Field,
            y: 0 as Field,
            revealer: AztecAddress::zero(),
        }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetEventMetadata {
    pub id: Field,
    // pub event_type: u8,
    // pub time_trigger: u64,
    // pub time_created: u64,
}

impl PlanetEventMetadata {
    pub fn zero() -> Self {
        PlanetEventMetadata {
            id: 0,
            // event_type: 0,
            // time_trigger: 0,
            // time_created: 0,
        }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetEvents {
    pub events: [PlanetEventMetadata; 20],
    pub count: u32,
    pub last_updated: u64,
}

impl PlanetEvents {
    pub fn zero() -> Self {
        PlanetEvents { events: [PlanetEventMetadata::zero(); 20], count: 0, last_updated: 0 }
    }
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetArtifacts {
    pub ids: [Field; 20],
    pub count: u32,
    pub last_updated: u64,
}

impl PlanetArtifacts {
    pub fn zero() -> Self {
        PlanetArtifacts { ids: [0; 20], count: 0, last_updated: 0 }
    }
}

pub mod PlanetType {
    pub fn Planet() -> u8 {
        0
    }
    pub fn SilverMine() -> u8 {
        1
    }
    pub fn Ruins() -> u8 {
        2
    }
    pub fn TradingPost() -> u8 {
        3
    }
    pub fn SilverBank() -> u8 {
        4
    }
}

pub mod PlanetEventType {
    pub fn Arrival() -> u8 {
        0
    }
}

pub mod SpaceType {
    pub fn Nebula() -> u8 {
        0
    }
    pub fn Space() -> u8 {
        1
    }
    pub fn DeepSpace() -> u8 {
        2
    }
    pub fn DeadSpace() -> u8 {
        3
    }
}

pub mod UpgradeBranch {
    pub fn Defense() -> u8 {
        0
    }
    pub fn Range() -> u8 {
        1
    }
    pub fn Speed() -> u8 {
        2
    }
}

pub mod Biome {
    pub fn Unknown() -> u8 {
        0
    }
    pub fn Ocean() -> u8 {
        1
    }
    pub fn Forest() -> u8 {
        2
    }
    pub fn Grassland() -> u8 {
        3
    }
    pub fn Tundra() -> u8 {
        4
    }
    pub fn Swamp() -> u8 {
        5
    }
    pub fn Desert() -> u8 {
        6
    }
    pub fn Ice() -> u8 {
        7
    }
    pub fn Wasteland() -> u8 {
        8
    }
    pub fn Lava() -> u8 {
        9
    }
    pub fn Corrupted() -> u8 {
        10
    }
}
