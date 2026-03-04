/**
 * Chain state shapes for decode input (key + state).
 *
 * Numeric fields use `Numberish` (string | number | bigint) so that both the
 * indexer layer (which stores bigint) and other sources (string / number) can
 * be passed directly to decode functions without unsafe casts.
 */

/** A value that can be losslessly converted to a JS number via `Number()`. */
export type Numberish = string | number | bigint;

export interface WorldState {
  paused: boolean;
  planet_events_count: Numberish;
  radius: Numberish;
  misc_nonce: Numberish;
  planet_ids_count: Numberish;
  revealed_planet_ids_count: Numberish;
  player_ids_count: Numberish;
  next_change_block: number;
}

export interface PlayerState {
  init_timestamp: Numberish;
  home_planet_id: string;
  last_reveal_timestamp: Numberish;
  score: Numberish;
  space_junk: Numberish;
  space_junk_limit: Numberish;
  claimed_ships: boolean;
  last_updated: Numberish;
}

export interface PlanetState {
  perlin: number;
  created_at: Numberish;
  owner: string;
  planet_level: number;
  planet_type: number;
  space_type: number;
  is_home_planet: boolean;
  is_initialized: boolean;
  destroyed: boolean;
  invader: string;
  capturer: string;
  invade_start_block: number;
  population_cap: Numberish;
  population_growth: Numberish;
  range: Numberish;
  speed: Numberish;
  defense: Numberish;
  silver_cap: Numberish;
  silver_growth: Numberish;
  population: Numberish;
  silver: Numberish;
  upgrade_state_0: number;
  upgrade_state_1: number;
  upgrade_state_2: number;
  last_updated: Numberish;
  pausers: Numberish;
  energy_gro_doublers: Numberish;
  silver_gro_doublers: Numberish;
  hat_level: Numberish;
  space_junk: Numberish;
  has_tried_finding_artifact: boolean;
  prospected_block_number: number;
}

export interface PlanetRevealedCoordsState {
  location_id: string;
  x: string;
  y: string;
  revealer: string;
}

export interface PlanetEventMetadata {
  id: string;
}

export interface PlanetEventsState {
  events: PlanetEventMetadata[];
  count: number;
  last_updated: Numberish;
}

export interface PlanetArtifactsState {
  ids: string[];
  count: number;
  last_updated: Numberish;
}

export interface ArrivalState {
  id: string;
  player: string;
  from_planet: string;
  to_planet: string;
  pop_arriving: Numberish;
  silver_moved: Numberish;
  departure_time: Numberish;
  arrival_time: Numberish;
  arrival_type: number;
  carried_artifact_id: string;
  distance: Numberish;
}

export interface ArtifactState {
  planet_discovered_on: string;
  rarity: number;
  planet_biome: number;
  minted_at_timestamp: Numberish;
  discoverer: string;
  artifact_type: number;
  activations: Numberish;
  last_activated: Numberish;
  last_deactivated: Numberish;
  wormhole_to: string;
  controller: string;
  last_updated: Numberish;
}

export interface ArtifactLocationState {
  planet_id: string;
  voyage_id: string;
  last_updated: Numberish;
}
