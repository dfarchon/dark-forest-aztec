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

/// Cold, rarely changing planet properties. These fields are separated from
/// the frequently refreshed state so callers can authenticate them with an
/// independent root.
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetStatic {
    pub perlin: u8,
    pub created_at: u64,
    pub planet_level: u8,
    pub planet_type: u8,
    pub space_type: u8,
    pub is_home_planet: bool,
    pub is_initialized: bool,
    pub destroyed: bool,
    pub population_cap: u128,
    pub silver_cap: u128,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetDynamic {
    pub owner: AztecAddress,
    pub invader: AztecAddress,
    pub capturer: AztecAddress,
    pub invade_start_block: u32,
    pub population: u128,
    pub silver: u128,
    pub last_updated: u64,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetStats {
    pub population_growth: u128,
    pub range: u128,
    pub speed: u128,
    pub defense: u128,
    pub silver_growth: u128,
    pub upgrade_state_0: u8,
    pub upgrade_state_1: u8,
    pub upgrade_state_2: u8,
}

#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetModifiers {
    pub pausers: u128,
    pub energy_gro_doublers: u128,
    pub silver_gro_doublers: u128,
    pub hat_level: u128,
    pub space_junk: u128,
    pub has_tried_finding_artifact: bool,
    pub prospected_block_number: u32,
}

/// Roots emitted alongside the legacy full Planet update during migration.
#[derive(Eq, Serialize, Deserialize, Packable)]
pub struct PlanetSplitRoots {
    pub static_root: Field,
    pub dynamic_root: Field,
    pub stats_root: Field,
    pub modifier_root: Field,
    pub composed_root: Field,
}

impl PlanetSplitRoots {
    pub fn zero() -> Self {
        PlanetSplitRoots {
            static_root: 0,
            dynamic_root: 0,
            stats_root: 0,
            modifier_root: 0,
            composed_root: 0,
        }
    }
}

impl PlanetStatic {
    pub fn zero() -> Self {
        PlanetStatic {
            perlin: 0,
            created_at: 0,
            planet_level: 0,
            planet_type: 0,
            space_type: 0,
            is_home_planet: false,
            is_initialized: false,
            destroyed: false,
            population_cap: 0,
            silver_cap: 0,
        }
    }
}

impl PlanetDynamic {
    pub fn zero() -> Self {
        PlanetDynamic {
            owner: AztecAddress::zero(),
            invader: AztecAddress::zero(),
            capturer: AztecAddress::zero(),
            invade_start_block: 0,
            population: 0,
            silver: 0,
            last_updated: 0,
        }
    }
}

impl PlanetStats {
    pub fn zero() -> Self {
        PlanetStats {
            population_growth: 0,
            range: 0,
            speed: 0,
            defense: 0,
            silver_growth: 0,
            upgrade_state_0: 0,
            upgrade_state_1: 0,
            upgrade_state_2: 0,
        }
    }
}

impl PlanetModifiers {
    pub fn zero() -> Self {
        PlanetModifiers {
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

    pub fn from_split(
        static_state: PlanetStatic,
        dynamic_state: PlanetDynamic,
        stats: PlanetStats,
        modifiers: PlanetModifiers,
    ) -> Self {
        Planet {
            perlin: static_state.perlin,
            created_at: static_state.created_at,
            owner: dynamic_state.owner,
            planet_level: static_state.planet_level,
            planet_type: static_state.planet_type,
            space_type: static_state.space_type,
            is_home_planet: static_state.is_home_planet,
            is_initialized: static_state.is_initialized,
            destroyed: static_state.destroyed,
            invader: dynamic_state.invader,
            capturer: dynamic_state.capturer,
            invade_start_block: dynamic_state.invade_start_block,
            population_cap: static_state.population_cap,
            population_growth: stats.population_growth,
            range: stats.range,
            speed: stats.speed,
            defense: stats.defense,
            silver_cap: static_state.silver_cap,
            silver_growth: stats.silver_growth,
            population: dynamic_state.population,
            silver: dynamic_state.silver,
            upgrade_state_0: stats.upgrade_state_0,
            upgrade_state_1: stats.upgrade_state_1,
            upgrade_state_2: stats.upgrade_state_2,
            last_updated: dynamic_state.last_updated,
            pausers: modifiers.pausers,
            energy_gro_doublers: modifiers.energy_gro_doublers,
            silver_gro_doublers: modifiers.silver_gro_doublers,
            hat_level: modifiers.hat_level,
            space_junk: modifiers.space_junk,
            has_tried_finding_artifact: modifiers.has_tried_finding_artifact,
            prospected_block_number: modifiers.prospected_block_number,
        }
    }

    pub fn split_static(&self) -> PlanetStatic {
        PlanetStatic {
            perlin: self.perlin,
            created_at: self.created_at,
            planet_level: self.planet_level,
            planet_type: self.planet_type,
            space_type: self.space_type,
            is_home_planet: self.is_home_planet,
            is_initialized: self.is_initialized,
            destroyed: self.destroyed,
            population_cap: self.population_cap,
            silver_cap: self.silver_cap,
        }
    }

    pub fn split_dynamic(&self) -> PlanetDynamic {
        PlanetDynamic {
            owner: self.owner,
            invader: self.invader,
            capturer: self.capturer,
            invade_start_block: self.invade_start_block,
            population: self.population,
            silver: self.silver,
            last_updated: self.last_updated,
        }
    }

    pub fn split_stats(&self) -> PlanetStats {
        PlanetStats {
            population_growth: self.population_growth,
            range: self.range,
            speed: self.speed,
            defense: self.defense,
            silver_growth: self.silver_growth,
            upgrade_state_0: self.upgrade_state_0,
            upgrade_state_1: self.upgrade_state_1,
            upgrade_state_2: self.upgrade_state_2,
        }
    }

    pub fn split_modifiers(&self) -> PlanetModifiers {
        PlanetModifiers {
            pausers: self.pausers,
            energy_gro_doublers: self.energy_gro_doublers,
            silver_gro_doublers: self.silver_gro_doublers,
            hat_level: self.hat_level,
            space_junk: self.space_junk,
            has_tried_finding_artifact: self.has_tried_finding_artifact,
            prospected_block_number: self.prospected_block_number,
        }
    }
}

#[test]
fn planet_split_round_trip_preserves_all_fields() {
    let mut original = Planet::zero();
    original.perlin = 91;
    original.created_at = 17;
    original.owner = AztecAddress::zero();
    original.planet_level = 4;
    original.planet_type = PlanetType::SilverMine;
    original.space_type = SpaceType::DeepSpace;
    original.is_home_planet = true;
    original.is_initialized = true;
    original.destroyed = true;
    original.population_cap = 1000;
    original.population_growth = 7;
    original.range = 8;
    original.speed = 9;
    original.defense = 10;
    original.silver_cap = 1100;
    original.silver_growth = 11;
    original.population = 120;
    original.silver = 130;
    original.upgrade_state_0 = 1;
    original.upgrade_state_1 = 2;
    original.upgrade_state_2 = 3;
    original.last_updated = 140;
    original.pausers = 4;
    original.energy_gro_doublers = 5;
    original.silver_gro_doublers = 6;
    original.hat_level = 7;
    original.space_junk = 8;
    original.has_tried_finding_artifact = true;
    original.prospected_block_number = 150;

    let restored = Planet::from_split(
        original.split_static(),
        original.split_dynamic(),
        original.split_stats(),
        original.split_modifiers(),
    );
    assert(restored == original);
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
    pub global Planet: u8 = 0;
    pub global SilverMine: u8 = 1;
    pub global Ruins: u8 = 2;
    pub global TradingPost: u8 = 3;
    pub global SilverBank: u8 = 4;
}

pub mod PlanetEventType {
    pub global Arrival: u8 = 0;
}

pub mod SpaceType {
    pub global Nebula: u8 = 0;
    pub global Space: u8 = 1;
    pub global DeepSpace: u8 = 2;
    pub global DeadSpace: u8 = 3;
}

pub mod UpgradeBranch {
    pub global Defense: u8 = 0;
    pub global Range: u8 = 1;
    pub global Speed: u8 = 2;
}

pub mod Biome {
    pub global Unknown: u8 = 0;
    pub global Ocean: u8 = 1;
    pub global Forest: u8 = 2;
    pub global Grassland: u8 = 3;
    pub global Tundra: u8 = 4;
    pub global Swamp: u8 = 5;
    pub global Desert: u8 = 6;
    pub global Ice: u8 = 7;
    pub global Wasteland: u8 = 8;
    pub global Lava: u8 = 9;
    pub global Corrupted: u8 = 10;
}
