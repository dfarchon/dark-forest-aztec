/**
 * Chain state types aligned with contracts/types and contracts/scripts/artifacts *Update.state.
 * Scalars: Field/address → string, u128 → string, u64/u32/u8 → number, bool → boolean.
 */

/** Field element or location/planet/artifact id (hex or decimal string). */
export type FieldId = string;

/** Aztec address as string (e.g. toHexString()). */
export type AddressString = string;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface WorldState {
  paused: boolean;
  planet_events_count: string;
  radius: string;
  misc_nonce: string;
  planet_ids_count: string;
  revealed_planet_ids_count: string;
  player_ids_count: string;
  next_change_block: number;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerState {
  init_timestamp: number;
  home_planet_id: string;
  last_reveal_timestamp: number;
  score: string;
  space_junk: string;
  space_junk_limit: string;
  claimed_ships: boolean;
  last_updated: number;
}

// ---------------------------------------------------------------------------
// Planet
// ---------------------------------------------------------------------------

export interface PlanetState {
  perlin: number;
  created_at: number;
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
  population_cap: string;
  population_growth: string;
  range: string;
  speed: string;
  defense: string;
  silver_cap: string;
  silver_growth: string;
  population: string;
  silver: string;
  upgrade_state_0: number;
  upgrade_state_1: number;
  upgrade_state_2: number;
  last_updated: number;
  pausers: string;
  energy_gro_doublers: string;
  silver_gro_doublers: string;
  hat_level: string;
  space_junk: string;
  has_tried_finding_artifact: boolean;
  prospected_block_number: number;
}

// ---------------------------------------------------------------------------
// PlanetRevealedCoords
// ---------------------------------------------------------------------------

export interface PlanetRevealedCoordsState {
  location_id: string;
  x: string;
  y: string;
  revealer: string;
}

// ---------------------------------------------------------------------------
// PlanetEvents (events array length 20 in Noir)
// ---------------------------------------------------------------------------

export interface PlanetEventMetadata {
  id: string;
}

export interface PlanetEventsState {
  events: PlanetEventMetadata[];
  count: number;
  last_updated: number;
}

// ---------------------------------------------------------------------------
// PlanetArtifacts (ids array length 20 in Noir)
// ---------------------------------------------------------------------------

export interface PlanetArtifactsState {
  ids: string[];
  count: number;
  last_updated: number;
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

export interface ArrivalState {
  id: string;
  player: string;
  from_planet: string;
  to_planet: string;
  pop_arriving: string;
  silver_moved: string;
  departure_time: number;
  arrival_time: number;
  arrival_type: number;
  carried_artifact_id: string;
  distance: string;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export interface ArtifactState {
  planet_discovered_on: string;
  rarity: number;
  planet_biome: number;
  minted_at_timestamp: number;
  discoverer: string;
  artifact_type: number;
  activations: string;
  last_activated: number;
  last_deactivated: number;
  wormhole_to: string;
  controller: string;
  last_updated: number;
}

// ---------------------------------------------------------------------------
// ArtifactLocation
// ---------------------------------------------------------------------------

export interface ArtifactLocationState {
  planet_id: string;
  voyage_id: string;
  last_updated: number;
}

// ---------------------------------------------------------------------------
// Entity types (id + state) for keyed collections
// ---------------------------------------------------------------------------

export interface WorldEntity {
  id: string;
  state: WorldState;
}

export interface PlayerEntity {
  id: string;
  state: PlayerState;
}

export interface PlanetEntity {
  id: string;
  state: PlanetState;
}

export interface PlanetRevealedCoordsEntity {
  id: string;
  state: PlanetRevealedCoordsState;
}

export interface PlanetEventsEntity {
  id: string;
  state: PlanetEventsState;
}

export interface PlanetArtifactsEntity {
  id: string;
  state: PlanetArtifactsState;
}

export interface ArrivalEntity {
  id: string;
  state: ArrivalState;
}

export interface ArtifactEntity {
  id: string;
  state: ArtifactState;
}

export interface ArtifactLocationEntity {
  id: string;
  state: ArtifactLocationState;
}
