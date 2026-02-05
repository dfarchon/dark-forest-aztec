mod game_utils;

pub use game_utils::{
    calculate_byte_uint_from_location_id,
    location_id_valid,
    revert_if_bad_snark_perlin_flags,
    space_type_from_perlin,
    get_planet_level_type_and_space_type,
    _get_radius,
    _random_artifact_type_and_level_bonus,
    _get_biome,
    default_upgrade,
    time_delay_upgrade,
    abandoning_upgrade,
    _get_upgrade_for_artifact,
    artifact_rarity_from_planet_level,
    _put_artifact_on_planet,
    _take_artifact_off_planet,
    is_activated,
    is_artifact_on_planet, 
    get_planet_artifact, 
    get_active_artifact,
    get_planet_default_space_junk,
    _buff_planet,
    _debuff_planet,
    update_world_radius,
    is_pop_cap_boost,  
    is_pop_gro_boost,
    is_range_boost,
    is_speed_boost,
    is_def_boost,
    is_half_space_junk,
    _default_planet,
}

mod lazy_update;

pub use lazy_update::{
    update_silver,
    update_population,
    update_planet,
    apply_arrival,
    apply_pending_events,
}

mod planet;

