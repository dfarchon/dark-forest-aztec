/**
 * Chain state types aligned with contracts/types and contracts/scripts/artifacts *Update.state.
 * Scalars: Field/address → string, u128/u64 → bigint, u32/u8 → number, bool → boolean.
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
  radius: bigint;
  misc_nonce: bigint;
  next_change_block: number;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerState {
  init_timestamp: bigint;
  home_planet_id: string;
  last_reveal_timestamp: bigint;
  score: bigint;
  space_junk: bigint;
  space_junk_limit: bigint;
  claimed_ships: boolean;
  last_updated: bigint;
}

// ---------------------------------------------------------------------------
// Planet
// ---------------------------------------------------------------------------

export interface PlanetState {
  perlin: number;
  created_at: bigint;
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
  population_cap: bigint;
  population_growth: bigint;
  range: bigint;
  speed: bigint;
  defense: bigint;
  silver_cap: bigint;
  silver_growth: bigint;
  population: bigint;
  silver: bigint;
  upgrade_state_0: number;
  upgrade_state_1: number;
  upgrade_state_2: number;
  last_updated: bigint;
  pausers: bigint;
  energy_gro_doublers: bigint;
  silver_gro_doublers: bigint;
  hat_level: bigint;
  space_junk: bigint;
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
  last_updated: bigint;
}

// ---------------------------------------------------------------------------
// PlanetArtifacts (ids array length 20 in Noir)
// ---------------------------------------------------------------------------

export interface PlanetArtifactsState {
  ids: string[];
  count: number;
  last_updated: bigint;
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

export interface ArrivalState {
  id: string;
  player: string;
  from_planet: string;
  to_planet: string;
  pop_arriving: bigint;
  silver_moved: bigint;
  departure_time: bigint;
  arrival_time: bigint;
  arrival_type: number;
  carried_artifact_id: string;
  distance: bigint;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export interface ArtifactState {
  planet_discovered_on: string;
  rarity: number;
  planet_biome: number;
  minted_at_timestamp: bigint;
  discoverer: string;
  artifact_type: number;
  activations: bigint;
  last_activated: bigint;
  last_deactivated: bigint;
  wormhole_to: string;
  controller: string;
  last_updated: bigint;
}

// ---------------------------------------------------------------------------
// ArtifactLocation
// ---------------------------------------------------------------------------

export interface ArtifactLocationState {
  planet_id: string;
  voyage_id: string;
  last_updated: bigint;
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
