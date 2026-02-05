// Planet types and sub-tables for optimized storage access
//
// The original Planet struct is split into 5 sub-tables to minimize
// the number of tables accessed per operation:
//
// | Function                  | Meta | Owner | Caps | Resources | Mods | Total |
// |---------------------------|:----:|:-----:|:----:|:---------:|:----:|:-----:|
// | buff_planet               |      |       |  W   |           |      |   1   |
// | debuff_planet             |      |       |  W   |           |      |   1   |
// | check_planet_dos          |      |   R   |      |           |      |   1   |
// | set_owner                 |      |  RW   |      |           |      |   1   |
// | transfer_planet           |      |  RW   |      |           |      |   1   |
// | withdraw_silver           |      |   R   |      |    RW     |      |   2   |
// | check_move_validity       |      |   R   |      |     R     |      |   2   |
// | upgrade_planet_internal   |      |   R   |   W  |    RW     |      |   3   |
// | refresh_planet_internal   |      |  RW   |  RW  |    RW     |  RW  |   4   |
// | _initialize_planet        |  W   |   W   |   W  |     W     |   W  |   5   |

use dep::aztec::protocol_types::address::AztecAddress;
use dep::aztec::protocol_types::traits::{Deserialize, Packable, Serialize};

// ========== PlanetMeta ==========
// Static display data, rarely accessed at runtime
// Only written during initialization

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetMeta {
    pub location_id: Field,
    pub perlin: u8,
    pub created_at: u64,
}

impl PlanetMeta {
    pub fn zero() -> Self {
        PlanetMeta {
            location_id: 0 as Field,
            perlin: 0,
            created_at: 0,
        }
    }
}

// ========== PlanetOwner ==========
// Ownership + validation data (most permission checks happen here)

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetOwner {
    pub owner: AztecAddress,
    pub planet_level: u8,
    pub planet_type: u8,        // 0=Planet, 1=SilverMine, 2=Ruins, 3=TradingPost, 4=SilverBank
    pub space_type: u8,         // 0=Nebula, 1=Space, 2=DeepSpace, 3=DeadSpace
    pub is_home_planet: bool,
    pub is_initialized: bool,
    pub destroyed: bool,
    pub invader: AztecAddress,
    pub capturer: AztecAddress,
    pub invade_start_block: u32,
}

impl PlanetOwner {
    pub fn zero() -> Self {
        PlanetOwner {
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
        }
    }
}

// ========== PlanetCaps ==========
// Capacity/stats modified together during buff/debuff

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetCaps {
    pub population_cap: u128,
    pub population_growth: u128,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub silver_cap: u128,
    pub silver_growth: u128,
}

impl PlanetCaps {
    pub fn zero() -> Self {
        PlanetCaps {
            population_cap: 0,
            population_growth: 0,
            range: 0,
            speed: 0,
            defense: 0,
            silver_cap: 0,
            silver_growth: 0,
        }
    }
}

// ========== PlanetResources ==========
// Dynamic state that changes frequently (renamed from PlanetState to avoid confusion)

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetResources {
    pub population: u128,
    pub silver: u128,
    pub upgrade_state_0: u8,
    pub upgrade_state_1: u8,
    pub upgrade_state_2: u8,
    pub last_updated: u64,
}

impl PlanetResources {
    pub fn zero() -> Self {
        PlanetResources {
            population: 0,
            silver: 0,
            upgrade_state_0: 0,
            upgrade_state_1: 0,
            upgrade_state_2: 0,
            last_updated: 0,
        }
    }
}

// ========== PlanetMods ==========
// Modifiers and special effects

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetMods {
    pub pausers: u128,
    pub energy_gro_doublers: u128,
    pub silver_gro_doublers: u128,
    pub hat_level: u128,
    pub space_junk: u128,
    pub has_tried_finding_artifact: bool,
    pub prospected_block_number: u32,
}

impl PlanetMods {
    pub fn zero() -> Self {
        PlanetMods {
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

// ========== Planet (full struct) ==========

#[derive(Serialize, Deserialize, Packable)]
pub struct Planet {
    pub owner: AztecAddress,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub population: u128,
    pub population_cap: u128,
    pub population_growth: u128,
    pub silver_cap: u128,
    pub silver_growth: u128,
    pub silver: u128,
    pub planet_level: u8,
    pub planet_type: u8,
    pub is_home_planet: bool,
    pub is_initialized: bool,
    pub created_at: u64,
    pub last_updated: u64,
    pub perlin: u8,
    pub space_type: u8,
    pub upgrade_state_0: u8,
    pub upgrade_state_1: u8,
    pub upgrade_state_2: u8,
    pub hat_level: u128,
    pub has_tried_finding_artifact: bool,
    pub prospected_block_number: u32,
    pub destroyed: bool,
    pub space_junk: u128,
    pub pausers: u128,
    pub energy_gro_doublers: u128,
    pub silver_gro_doublers: u128,
    pub invader: AztecAddress,
    pub invade_start_block: u32,
    pub capturer: AztecAddress,
    pub location_id: Field,
}

impl Planet {

    pub fn zero() -> Self {
        Planet {
            owner: AztecAddress::zero(),
            range: 0,
            speed: 0,
            defense: 0,
            population: 0,
            population_cap: 0,
            population_growth: 0,
            silver_cap: 0,
            silver_growth: 0,
            silver: 0,
            planet_level: 0,
            planet_type: 0,
            is_home_planet: false,
            is_initialized: false,
            created_at: 0,
            last_updated: 0,
            perlin: 0,
            space_type: 0,
            upgrade_state_0: 0,
            upgrade_state_1: 0,
            upgrade_state_2: 0,
            hat_level: 0,
            has_tried_finding_artifact: false,
            prospected_block_number: 0,
            destroyed: false,
            space_junk: 0,
            pausers: 0,
            energy_gro_doublers: 0,
            silver_gro_doublers: 0,
            invader: AztecAddress::zero(),
            invade_start_block: 0,
            capturer: AztecAddress::zero(),
            location_id: 0 as Field,
        }
    }

    pub fn to_meta(self) -> PlanetMeta {
        PlanetMeta {
            location_id: self.location_id,
            perlin: self.perlin,
            created_at: self.created_at,
        }
    }

    pub fn to_owner(self) -> PlanetOwner {
        PlanetOwner {
            owner: self.owner,
            planet_level: self.planet_level,
            planet_type: self.planet_type,
            space_type: self.space_type,
            is_home_planet: self.is_home_planet,
            is_initialized: self.is_initialized,
            destroyed: self.destroyed,
            invader: self.invader,
            capturer: self.capturer,
            invade_start_block: self.invade_start_block,
        }
    }

    pub fn to_caps(self) -> PlanetCaps {
        PlanetCaps {
            population_cap: self.population_cap,
            population_growth: self.population_growth,
            range: self.range,
            speed: self.speed,
            defense: self.defense,
            silver_cap: self.silver_cap,
            silver_growth: self.silver_growth,
        }
    }

    pub fn to_resources(self) -> PlanetResources {
        PlanetResources {
            population: self.population,
            silver: self.silver,
            upgrade_state_0: self.upgrade_state_0,
            upgrade_state_1: self.upgrade_state_1,
            upgrade_state_2: self.upgrade_state_2,
            last_updated: self.last_updated,
        }
    }

    pub fn to_mods(self) -> PlanetMods {
        PlanetMods {
            pausers: self.pausers,
            energy_gro_doublers: self.energy_gro_doublers,
            silver_gro_doublers: self.silver_gro_doublers,
            hat_level: self.hat_level,
            space_junk: self.space_junk,
            has_tried_finding_artifact: self.has_tried_finding_artifact,
            prospected_block_number: self.prospected_block_number,
        }
    }

    pub fn from_parts(
        meta: PlanetMeta,
        owner: PlanetOwner,
        caps: PlanetCaps,
        resources: PlanetResources,
        mods: PlanetMods,
    ) -> Self {
        Planet {
            location_id: meta.location_id,
            perlin: meta.perlin,
            created_at: meta.created_at,
            owner: owner.owner,
            planet_level: owner.planet_level,
            planet_type: owner.planet_type,
            space_type: owner.space_type,
            is_home_planet: owner.is_home_planet,
            is_initialized: owner.is_initialized,
            destroyed: owner.destroyed,
            invader: owner.invader,
            capturer: owner.capturer,
            invade_start_block: owner.invade_start_block,
            population_cap: caps.population_cap,
            population_growth: caps.population_growth,
            range: caps.range,
            speed: caps.speed,
            defense: caps.defense,
            silver_cap: caps.silver_cap,
            silver_growth: caps.silver_growth,
            population: resources.population,
            silver: resources.silver,
            upgrade_state_0: resources.upgrade_state_0,
            upgrade_state_1: resources.upgrade_state_1,
            upgrade_state_2: resources.upgrade_state_2,
            last_updated: resources.last_updated,
            pausers: mods.pausers,
            energy_gro_doublers: mods.energy_gro_doublers,
            silver_gro_doublers: mods.silver_gro_doublers,
            hat_level: mods.hat_level,
            space_junk: mods.space_junk,
            has_tried_finding_artifact: mods.has_tried_finding_artifact,
            prospected_block_number: mods.prospected_block_number,
        }
    }

    pub fn to_meta_caps_resources_mods(&self) -> (PlanetMeta, PlanetOwner, PlanetCaps, PlanetResources, PlanetMods) {
        (
            PlanetMeta {
                location_id: self.location_id,
                perlin: self.perlin,
                created_at: self.created_at,
            },
            PlanetOwner {
                owner: self.owner,
                planet_level: self.planet_level,
                planet_type: self.planet_type,
                space_type: self.space_type,
                is_home_planet: self.is_home_planet,
                is_initialized: self.is_initialized,
                destroyed: self.destroyed,
                invader: self.invader,
                capturer: self.capturer,
                invade_start_block: self.invade_start_block,
            },
            PlanetCaps {
                population_cap: self.population_cap,
                population_growth: self.population_growth,
                range: self.range,
                speed: self.speed,
                defense: self.defense,
                silver_cap: self.silver_cap,
                silver_growth: self.silver_growth,
            },
            PlanetResources {
                population: self.population,
                silver: self.silver,
                upgrade_state_0: self.upgrade_state_0,
                upgrade_state_1: self.upgrade_state_1,
                upgrade_state_2: self.upgrade_state_2,
                last_updated: self.last_updated,
            },
            PlanetMods {
                pausers: self.pausers,
                energy_gro_doublers: self.energy_gro_doublers,
                silver_gro_doublers: self.silver_gro_doublers,
                hat_level: self.hat_level,
                space_junk: self.space_junk,
                has_tried_finding_artifact: self.has_tried_finding_artifact,
                prospected_block_number: self.prospected_block_number,
            }
        )
    }
}

// ========== RevealedCoords ==========

#[derive(Serialize, Deserialize, Packable)]
pub struct RevealedCoords {
    pub location_id: Field,
    pub x: Field,
    pub y: Field,
    pub revealer: AztecAddress,
}

impl RevealedCoords {
    pub fn zero() -> Self {
        RevealedCoords {
            location_id: 0 as Field,
            x: 0 as Field,
            y: 0 as Field,
            revealer: AztecAddress::zero(),
        }
    }
}

// ========== PlanetData ==========

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetData {
    pub planet: Planet,
    pub revealed_coords: RevealedCoords,
}

// ========== PlanetEventMetadata ==========

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetEventMetadata {
    pub id: u128,
    pub event_type: u8,
    pub time_trigger: u64,
    pub time_created: u64,
}

impl PlanetEventMetadata {
    pub fn zero() -> Self {
        PlanetEventMetadata {
            id: 0,
            event_type: 0,
            time_trigger: 0,
            time_created: 0,
        }
    }
}

// ========== PlanetEvents ==========
// Fixed-size ring buffer of planet events + count

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetEvents {
    pub events: [PlanetEventMetadata; 20],
    pub events_count: u32,
}

impl PlanetEvents {
    pub fn zero() -> Self {
        PlanetEvents {
            events: [PlanetEventMetadata::zero(); 20],
            events_count: 0,
        }
    }
}

// ========== PlanetArtifacts ==========
// Fixed-size ring buffer of planet artifacts + count

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetArtifacts {
    pub artifacts: [Field; 20],
    pub artifacts_count: u32,
}

impl PlanetArtifacts {
    pub fn zero() -> Self {
        PlanetArtifacts {
            artifacts: [0; 20],
            artifacts_count: 0,
        }
    }
}

// ========== PlanetFullState ==========
// Complete planet state for hash verification

#[derive(Serialize, Deserialize, Packable)]
pub struct PlanetFullState {
    pub meta: PlanetMeta,
    pub owner: PlanetOwner,
    pub caps: PlanetCaps,
    pub resources: PlanetResources,
    pub mods: PlanetMods,
    pub revealed_coords: RevealedCoords,
    pub events: PlanetEvents,
    pub artifacts: PlanetArtifacts,
}

impl PlanetFullState {
    pub fn to_planet(self) -> Planet {
        Planet::from_parts(self.meta, self.owner, self.caps, self.resources, self.mods)
    }
}

pub mod PlanetType {
    pub fn Planet() -> u8 { 0 }
    pub fn SilverMine() -> u8 { 1 }
    pub fn Ruins() -> u8 { 2 }
    pub fn TradingPost() -> u8 { 3 }
    pub fn SilverBank() -> u8 { 4 }
}

pub mod PlanetEventType {
    pub fn Arrival() -> u8 { 0 }
}

pub mod SpaceType {
    pub fn Nebula() -> u8 { 0 }
    pub fn Space() -> u8 { 1 }
    pub fn DeepSpace() -> u8 { 2 }
    pub fn DeadSpace() -> u8 { 3 }
}

pub mod UpgradeBranch {
    pub fn Defense() -> u8 { 0 }
    pub fn Range() -> u8 { 1 }
    pub fn Speed() -> u8 { 2 }
}

