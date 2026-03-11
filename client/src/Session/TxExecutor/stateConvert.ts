/**
 * Strict conversion layer: IndexerConnection state types → contract-compatible
 * Record<string, unknown> format. Ensures types match what Aztec Noir ABI expects.
 *
 * Indexer chain.ts uses: string for Field/address, bigint for u128/u64, number for u32/u8.
 * Contract expects:      bigint for Field/u128/u64, number for u32/u8, string for address.
 *
 * Key conversions:
 *   FieldId (string)  → bigint   (BigInt(str))
 *   bigint timestamp  → number   (Number()) for u32 fields
 *   string address    → string   (keep as-is)
 *   arrays            → pad to length 20 with zeros
 */

import type {
  ArrivalState,
  ArtifactLocationState,
  ArtifactState,
  PlanetArtifactsState,
  PlanetEventsState,
  PlanetRevealedCoordsState,
  PlanetState,
  PlayerState,
  WorldState,
} from "../Indexer/TableTypes/chain";
import { arrivalZero, artifactLocationZero, artifactZero } from "./stateZeros";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBigint(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(String(v ?? 0));
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v ?? 0);
}

/** Pad array to exactly `len` elements, filling with `fill()` results. */
function padArray(
  arr: Record<string, unknown>[],
  len: number,
  fill: () => Record<string, unknown>
): Record<string, unknown>[] {
  const out = arr.slice(0, len);
  while (out.length < len) out.push(fill());
  return out;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export function worldToContract(s: WorldState): Record<string, unknown> {
  return {
    paused: s.paused,
    radius: toBigint(s.radius),
    misc_nonce: toBigint(s.misc_nonce),
    next_change_block: toNumber(s.next_change_block),
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export function playerToContract(s: PlayerState): Record<string, unknown> {
  return {
    init_timestamp: toNumber(s.init_timestamp),
    home_planet_id: toBigint(s.home_planet_id),
    last_reveal_timestamp: toNumber(s.last_reveal_timestamp),
    score: toBigint(s.score),
    space_junk: toBigint(s.space_junk),
    space_junk_limit: toBigint(s.space_junk_limit),
    claimed_ships: s.claimed_ships,
    last_updated: toNumber(s.last_updated),
  };
}

// ---------------------------------------------------------------------------
// PlanetRevealedCoords
// ---------------------------------------------------------------------------

export function planetRevealedCoordsToContract(
  s: PlanetRevealedCoordsState
): Record<string, unknown> {
  return {
    location_id: toBigint(s.location_id),
    x: toBigint(s.x),
    y: toBigint(s.y),
    revealer: s.revealer,
  };
}

// ---------------------------------------------------------------------------
// Planet
// ---------------------------------------------------------------------------

export function planetToContract(s: PlanetState): Record<string, unknown> {
  return {
    perlin: s.perlin,
    created_at: toNumber(s.created_at),
    owner: s.owner,
    planet_level: s.planet_level,
    planet_type: s.planet_type,
    space_type: s.space_type,
    is_home_planet: s.is_home_planet,
    is_initialized: s.is_initialized,
    destroyed: s.destroyed,
    invader: s.invader,
    capturer: s.capturer,
    invade_start_block: s.invade_start_block,
    population_cap: toBigint(s.population_cap),
    population_growth: toBigint(s.population_growth),
    range: toBigint(s.range),
    speed: toBigint(s.speed),
    defense: toBigint(s.defense),
    silver_cap: toBigint(s.silver_cap),
    silver_growth: toBigint(s.silver_growth),
    population: toBigint(s.population),
    silver: toBigint(s.silver),
    upgrade_state_0: s.upgrade_state_0,
    upgrade_state_1: s.upgrade_state_1,
    upgrade_state_2: s.upgrade_state_2,
    last_updated: toNumber(s.last_updated),
    pausers: toBigint(s.pausers),
    energy_gro_doublers: toBigint(s.energy_gro_doublers),
    silver_gro_doublers: toBigint(s.silver_gro_doublers),
    hat_level: toBigint(s.hat_level),
    space_junk: toBigint(s.space_junk),
    has_tried_finding_artifact: s.has_tried_finding_artifact,
    prospected_block_number: s.prospected_block_number,
  };
}

// ---------------------------------------------------------------------------
// PlanetEvents
// ---------------------------------------------------------------------------

export function planetEventsToContract(
  s: PlanetEventsState
): Record<string, unknown> {
  const events = (s.events ?? []).map((e) => ({ id: toNumber(e.id) }));
  while (events.length < 20) events.push({ id: 0 });
  return {
    events: events.slice(0, 20),
    count: s.count,
    last_updated: toNumber(s.last_updated),
  };
}

// ---------------------------------------------------------------------------
// PlanetArtifacts
// ---------------------------------------------------------------------------

export function planetArtifactsToContract(
  s: PlanetArtifactsState
): Record<string, unknown> {
  const ids = (s.ids ?? []).map((id) => toBigint(id));
  while (ids.length < 20) ids.push(0n);
  return {
    ids: ids.slice(0, 20),
    count: s.count,
    last_updated: toNumber(s.last_updated),
  };
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

export function arrivalToContract(s: ArrivalState): Record<string, unknown> {
  return {
    id: toNumber(s.id),
    player: s.player,
    from_planet: toBigint(s.from_planet),
    to_planet: toBigint(s.to_planet),
    pop_arriving: toBigint(s.pop_arriving),
    silver_moved: toBigint(s.silver_moved),
    departure_time: toNumber(s.departure_time),
    arrival_time: toNumber(s.arrival_time),
    arrival_type: s.arrival_type,
    carried_artifact_id: toBigint(s.carried_artifact_id),
    distance: toBigint(s.distance),
  };
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export function artifactToContract(s: ArtifactState): Record<string, unknown> {
  return {
    planet_discovered_on: toBigint(s.planet_discovered_on),
    rarity: s.rarity,
    planet_biome: s.planet_biome,
    minted_at_timestamp: toNumber(s.minted_at_timestamp),
    discoverer: s.discoverer,
    artifact_type: s.artifact_type,
    activations: toBigint(s.activations),
    last_activated: toNumber(s.last_activated),
    last_deactivated: toNumber(s.last_deactivated),
    wormhole_to: toBigint(s.wormhole_to),
    controller: s.controller,
    last_updated: toNumber(s.last_updated),
  };
}

// ---------------------------------------------------------------------------
// ArtifactLocation
// ---------------------------------------------------------------------------

export function artifactLocationToContract(
  s: ArtifactLocationState
): Record<string, unknown> {
  return {
    planet_id: toBigint(s.planet_id),
    voyage_id: toBigint(s.voyage_id),
    last_updated: toNumber(s.last_updated),
  };
}

// ---------------------------------------------------------------------------
// Array padding helpers (for move args: arrivals[20], artifacts[20], etc.)
// ---------------------------------------------------------------------------

export function padArrivals(arr: ArrivalState[]): Record<string, unknown>[] {
  return padArray(arr.map(arrivalToContract), 20, arrivalZero);
}

export function padArtifacts(arr: ArtifactState[]): Record<string, unknown>[] {
  return padArray(arr.map(artifactToContract), 20, artifactZero);
}

export function padArtifactLocations(
  arr: ArtifactLocationState[]
): Record<string, unknown>[] {
  return padArray(
    arr.map(artifactLocationToContract),
    20,
    artifactLocationZero
  );
}
