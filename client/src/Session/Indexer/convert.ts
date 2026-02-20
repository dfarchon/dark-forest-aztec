/**
 * Convert raw event/API payloads (bigint, address, field) to client chain types.
 *
 * - u128/u64 (chain): kept as bigint for exact arithmetic.
 * - u8/u32: use toSafeNum (throws if > Number.MAX_SAFE_INTEGER).
 * - Field/address: kept as string (hex or decimal).
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
} from "./TableTypes/chain";
import type { TableName } from "./types";

type Raw = Record<string, unknown>;

/** String form for display/API; Field and address stay as string. */
export function toStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "bigint") return String(v);
  if (typeof v === "object" && "toString" in (v as object))
    return (v as { toString(): string }).toString();
  return String(v);
}

/** Bigint for u64/u128. */
export function toBigInt(v: unknown): bigint {
  if (v === undefined || v === null) return BigInt(0);
  if (typeof v === "bigint") return v;
  try {
    return BigInt(toStr(v));
  } catch {
    return BigInt(0);
  }
}

/**
 * Number for u8/u32. Throws if value exceeds Number.MAX_SAFE_INTEGER (overflow).
 */
export function toSafeNum(v: unknown): number {
  const max = Number.MAX_SAFE_INTEGER;
  if (v === undefined || v === null) return 0;
  if (typeof v === "number" && !Number.isNaN(v)) {
    if (v > max || v < -max) {
      throw new Error(
        `Indexer convert: number overflow (${v} outside safe integer range)`
      );
    }
    return v;
  }
  if (typeof v === "bigint") {
    if (v > BigInt(max) || v < BigInt(-max)) {
      throw new Error(
        `Indexer convert: bigint overflow (${String(v)} outside safe integer range)`
      );
    }
    return Number(v);
  }
  const n = Number(toStr(v));
  if (Number.isNaN(n)) return 0;
  if (n > max || n < -max) {
    throw new Error(
      `Indexer convert: number overflow (${n} outside safe integer range)`
    );
  }
  return n;
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return toSafeNum(v) !== 0;
}

export function rawToWorldState(r: Raw): WorldState {
  return {
    paused: toBool(r.paused),
    planet_events_count: toStr(r.planet_events_count),
    radius: toBigInt(r.radius),
    misc_nonce: toBigInt(r.misc_nonce),
    planet_ids_count: toBigInt(r.planet_ids_count),
    revealed_planet_ids_count: toBigInt(r.revealed_planet_ids_count),
    player_ids_count: toBigInt(r.player_ids_count),
    next_change_block: toSafeNum(r.next_change_block),
  };
}

export function rawToPlayerState(r: Raw): PlayerState {
  return {
    init_timestamp: toBigInt(r.init_timestamp),
    home_planet_id: toStr(r.home_planet_id),
    last_reveal_timestamp: toBigInt(r.last_reveal_timestamp),
    score: toBigInt(r.score),
    space_junk: toBigInt(r.space_junk),
    space_junk_limit: toBigInt(r.space_junk_limit),
    claimed_ships: toBool(r.claimed_ships),
    last_updated: toBigInt(r.last_updated),
  };
}

export function rawToPlanetState(r: Raw): PlanetState {
  return {
    perlin: toSafeNum(r.perlin),
    created_at: toBigInt(r.created_at),
    owner: toStr(r.owner),
    planet_level: toSafeNum(r.planet_level),
    planet_type: toSafeNum(r.planet_type),
    space_type: toSafeNum(r.space_type),
    is_home_planet: toBool(r.is_home_planet),
    is_initialized: toBool(r.is_initialized),
    destroyed: toBool(r.destroyed),
    invader: toStr(r.invader),
    capturer: toStr(r.capturer),
    invade_start_block: toSafeNum(r.invade_start_block),
    population_cap: toBigInt(r.population_cap),
    population_growth: toBigInt(r.population_growth),
    range: toBigInt(r.range),
    speed: toBigInt(r.speed),
    defense: toBigInt(r.defense),
    silver_cap: toBigInt(r.silver_cap),
    silver_growth: toBigInt(r.silver_growth),
    population: toBigInt(r.population),
    silver: toBigInt(r.silver),
    upgrade_state_0: toSafeNum(r.upgrade_state_0),
    upgrade_state_1: toSafeNum(r.upgrade_state_1),
    upgrade_state_2: toSafeNum(r.upgrade_state_2),
    last_updated: toBigInt(r.last_updated),
    pausers: toBigInt(r.pausers),
    energy_gro_doublers: toBigInt(r.energy_gro_doublers),
    silver_gro_doublers: toBigInt(r.silver_gro_doublers),
    hat_level: toBigInt(r.hat_level),
    space_junk: toBigInt(r.space_junk),
    has_tried_finding_artifact: toBool(r.has_tried_finding_artifact),
    prospected_block_number: toSafeNum(r.prospected_block_number),
  };
}

/** Convert raw planet_revealed_coords state. */
export function rawToPlanetRevealedCoordsState(
  r: Raw
): PlanetRevealedCoordsState {
  return {
    location_id: toStr(r.location_id),
    x: toStr(r.x),
    y: toStr(r.y),
    revealer: toStr(r.revealer),
  };
}

export function rawToPlanetEventsState(r: Raw): PlanetEventsState {
  const events = (r.events as unknown[] | undefined) ?? [];
  return {
    events: events.slice(0, 20).map((e) => ({
      id: toStr((e as Raw)?.id),
    })),
    count: toSafeNum(r.count),
    last_updated: toBigInt(r.last_updated),
  };
}

export function rawToPlanetArtifactsState(r: Raw): PlanetArtifactsState {
  const ids = (r.ids as unknown[] | undefined) ?? [];
  return {
    ids: ids.slice(0, 20).map((id) => toStr(id)),
    count: toSafeNum(r.count),
    last_updated: toBigInt(r.last_updated),
  };
}

export function rawToArrivalState(r: Raw): ArrivalState {
  return {
    id: toStr(r.id),
    player: toStr(r.player),
    from_planet: toStr(r.from_planet),
    to_planet: toStr(r.to_planet),
    pop_arriving: toBigInt(r.pop_arriving),
    silver_moved: toBigInt(r.silver_moved),
    departure_time: toBigInt(r.departure_time),
    arrival_time: toBigInt(r.arrival_time),
    arrival_type: toSafeNum(r.arrival_type),
    carried_artifact_id: toStr(r.carried_artifact_id),
    distance: toBigInt(r.distance),
  };
}

export function rawToArtifactState(r: Raw): ArtifactState {
  return {
    planet_discovered_on: toStr(r.planet_discovered_on),
    rarity: toSafeNum(r.rarity),
    planet_biome: toSafeNum(r.planet_biome),
    minted_at_timestamp: toBigInt(r.minted_at_timestamp),
    discoverer: toStr(r.discoverer),
    artifact_type: toSafeNum(r.artifact_type),
    activations: toBigInt(r.activations),
    last_activated: toBigInt(r.last_activated),
    last_deactivated: toBigInt(r.last_deactivated),
    wormhole_to: toStr(r.wormhole_to),
    controller: toStr(r.controller),
    last_updated: toBigInt(r.last_updated),
  };
}

export function rawToArtifactLocationState(r: Raw): ArtifactLocationState {
  return {
    planet_id: toStr(r.planet_id),
    voyage_id: toStr(r.voyage_id),
    last_updated: toBigInt(r.last_updated),
  };
}

const converters: Record<
  TableName,
  (
    r: Raw
  ) =>
    | WorldState
    | PlayerState
    | PlanetState
    | PlanetRevealedCoordsState
    | PlanetEventsState
    | PlanetArtifactsState
    | ArrivalState
    | ArtifactState
    | ArtifactLocationState
> = {
  world: rawToWorldState as (r: Raw) => WorldState,
  player: rawToPlayerState as (r: Raw) => PlayerState,
  planet: rawToPlanetState as (r: Raw) => PlanetState,
  planet_revealed_coords: rawToPlanetRevealedCoordsState as (
    r: Raw
  ) => PlanetRevealedCoordsState,
  planet_events: rawToPlanetEventsState as (r: Raw) => PlanetEventsState,
  planet_artifacts: rawToPlanetArtifactsState as (
    r: Raw
  ) => PlanetArtifactsState,
  arrival: rawToArrivalState as (r: Raw) => ArrivalState,
  artifact: rawToArtifactState as (r: Raw) => ArtifactState,
  artifact_location: rawToArtifactLocationState as (
    r: Raw
  ) => ArtifactLocationState,
};

/** Convert raw state object to typed state for the given table. */
export function rawToState(
  table: TableName,
  raw: Raw
):
  | WorldState
  | PlayerState
  | PlanetState
  | PlanetRevealedCoordsState
  | PlanetEventsState
  | PlanetArtifactsState
  | ArrivalState
  | ArtifactState
  | ArtifactLocationState {
  const fn = converters[table];
  if (!fn) throw new Error(`Unknown table: ${table}`);
  return fn(raw) as ReturnType<typeof fn>;
}

/** Normalize event id to TableId (world = "0", else string). */
export function rawIdToTableId(table: TableName, rawId: unknown): string {
  if (table === "world") return "0";
  return toStr(rawId);
}
