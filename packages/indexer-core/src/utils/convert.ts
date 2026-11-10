/**
 * Convert raw event/API payloads (bigint, address, field) to client chain types.
 *
 * - u128/u64: non-negative bigint. Negatives and non-integers throw.
 * - u8/u32: non-negative integers within that width. Out of range throws.
 * - Field/address: string, bigint, safe integer, or an object with its own toString().
 * - null/undefined scalars become 0 / 0n / "" so callers can report them as missing.
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
} from "../TableTypes/chain.ts";
import {
  TABLE_NAMES,
  type IndexerSnapshot,
  type TableName,
  type TableRowType,
} from "../types.ts";

type Raw = Record<string, unknown>;

const U8_MAX = 255;
const U32_MAX = 2 ** 32 - 1;
const LIST_MAX = 20;
const UNSIGNED_INT = /^(?:0x[0-9a-fA-F]+|\d+)$/;

function isStringifiable(v: unknown): v is { toString(): string } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const toString = (v as { toString?: unknown }).toString;
  return (
    typeof toString === "function" && toString !== Object.prototype.toString
  );
}

function invalidInteger(v: unknown): Error {
  const shown = typeof v === "string" ? JSON.stringify(v) : String(v);
  return new Error(`Indexer convert: ${shown} is not a valid integer`);
}

function unsignedOverflow(v: unknown, max?: number): Error {
  const limit = max === undefined ? "unsigned integer range" : `0..${max}`;
  return new Error(
    `Indexer convert: number overflow (${String(v)} outside ${limit})`,
  );
}

/** Decimal or 0x-hex integer. Rejects negatives, fractions, and plain objects. */
function readUnsigned(v: unknown): bigint {
  if (typeof v === "bigint") {
    if (v < 0n) throw unsignedOverflow(v);
    return v;
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw invalidInteger(v);
    if (v < 0) throw unsignedOverflow(v);
    return BigInt(v);
  }
  if (typeof v === "string") {
    if (v.startsWith("-")) throw unsignedOverflow(v);
    if (!UNSIGNED_INT.test(v)) throw invalidInteger(v);
    return BigInt(v);
  }
  if (isStringifiable(v)) {
    const s = v.toString();
    if (s.startsWith("-")) throw unsignedOverflow(s);
    if (!UNSIGNED_INT.test(s)) throw invalidInteger(s);
    return BigInt(s);
  }
  throw invalidInteger(v);
}

function stringValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "bigint") {
    if (v < 0n) throw unsignedOverflow(v);
    return String(v);
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw invalidInteger(v);
    return String(v);
  }
  if (isStringifiable(v)) return v.toString();
  throw new Error(`Indexer convert: ${String(v)} is not a valid string`);
}

/** String form for Field and address values. null/undefined become "". */
export function toStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  return stringValue(v);
}

/**
 * Bigint for u64/u128.
 * null/undefined become 0n. Negatives and non-integers throw.
 */
export function toBigInt(v: unknown): bigint {
  if (v === undefined || v === null) return 0n;
  return readUnsigned(v);
}

/**
 * Number for u8/u32.
 * `max` defaults to the u32 limit. Pass 255 for u8.
 * null/undefined become 0. Negatives, non-integers, and values above `max` throw.
 */
export function toSafeNum(v: unknown, max = U32_MAX): number {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new Error(`Indexer convert: invalid number limit ${String(max)}`);
  }
  if (v === undefined || v === null) return 0;
  const n = readUnsigned(v);
  if (n > BigInt(max)) throw unsignedOverflow(v, max);
  return Number(n);
}

function toU8(v: unknown): number {
  return toSafeNum(v, U8_MAX);
}

function toU32(v: unknown): number {
  return toSafeNum(v, U32_MAX);
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return toU32(v) !== 0;
}

function asList(v: unknown, label: string): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new Error(`Indexer convert: ${label} is not an array`);
  }
  if (v.length > LIST_MAX) {
    throw new Error(
      `Indexer convert: ${label} length ${v.length} exceeds ${LIST_MAX}`,
    );
  }
  return v;
}

function checkedCount(count: number, length: number, label: string): number {
  if (count > length) {
    throw new Error(
      `Indexer convert: count ${count} exceeds ${label} length ${length}`,
    );
  }
  return count;
}

export function rawToWorldState(r: Raw): WorldState {
  return {
    paused: toBool(r.paused),
    radius: toBigInt(r.radius),
    misc_nonce: toBigInt(r.misc_nonce),
    next_change_block: toU32(r.next_change_block),
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
    perlin: toU8(r.perlin),
    created_at: toBigInt(r.created_at),
    owner: toStr(r.owner),
    planet_level: toU8(r.planet_level),
    planet_type: toU8(r.planet_type),
    space_type: toU8(r.space_type),
    is_home_planet: toBool(r.is_home_planet),
    is_initialized: toBool(r.is_initialized),
    destroyed: toBool(r.destroyed),
    invader: toStr(r.invader),
    capturer: toStr(r.capturer),
    invade_start_block: toU32(r.invade_start_block),
    population_cap: toBigInt(r.population_cap),
    population_growth: toBigInt(r.population_growth),
    range: toBigInt(r.range),
    speed: toBigInt(r.speed),
    defense: toBigInt(r.defense),
    silver_cap: toBigInt(r.silver_cap),
    silver_growth: toBigInt(r.silver_growth),
    population: toBigInt(r.population),
    silver: toBigInt(r.silver),
    upgrade_state_0: toU8(r.upgrade_state_0),
    upgrade_state_1: toU8(r.upgrade_state_1),
    upgrade_state_2: toU8(r.upgrade_state_2),
    last_updated: toBigInt(r.last_updated),
    pausers: toBigInt(r.pausers),
    energy_gro_doublers: toBigInt(r.energy_gro_doublers),
    silver_gro_doublers: toBigInt(r.silver_gro_doublers),
    hat_level: toBigInt(r.hat_level),
    space_junk: toBigInt(r.space_junk),
    has_tried_finding_artifact: toBool(r.has_tried_finding_artifact),
    prospected_block_number: toU32(r.prospected_block_number),
  };
}

/** Convert raw planet_revealed_coords state. */
export function rawToPlanetRevealedCoordsState(
  r: Raw,
): PlanetRevealedCoordsState {
  return {
    location_id: toStr(r.location_id),
    x: toStr(r.x),
    y: toStr(r.y),
    revealer: toStr(r.revealer),
  };
}

export function rawToPlanetEventsState(r: Raw): PlanetEventsState {
  const events = asList(r.events, "events");
  return {
    events: events.map((e) => ({
      id: toStr((e as Raw)?.id),
    })),
    count: checkedCount(toU32(r.count), events.length, "events"),
    last_updated: toBigInt(r.last_updated),
  };
}

export function rawToPlanetArtifactsState(r: Raw): PlanetArtifactsState {
  const ids = asList(r.ids, "ids");
  return {
    ids: ids.map((id) => toStr(id)),
    count: checkedCount(toU32(r.count), ids.length, "ids"),
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
    arrival_type: toU8(r.arrival_type),
    carried_artifact_id: toStr(r.carried_artifact_id),
    distance: toBigInt(r.distance),
  };
}

export function rawToArtifactState(r: Raw): ArtifactState {
  return {
    planet_discovered_on: toStr(r.planet_discovered_on),
    rarity: toU8(r.rarity),
    planet_biome: toU8(r.planet_biome),
    minted_at_timestamp: toBigInt(r.minted_at_timestamp),
    discoverer: toStr(r.discoverer),
    artifact_type: toU8(r.artifact_type),
    activations: toBigInt(r.activations),
    last_activated: toBigInt(r.last_activated),
    last_deactivated: toBigInt(r.last_deactivated),
    wormhole_to: toStr(r.wormhole_to),
    owner: toStr(r.owner),
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

const converters: {
  [K in TableName]: (r: Raw) => TableRowType[K];
} = {
  world: rawToWorldState,
  player: rawToPlayerState,
  planet: rawToPlanetState,
  planet_revealed_coords: rawToPlanetRevealedCoordsState,
  planet_events: rawToPlanetEventsState,
  planet_artifacts: rawToPlanetArtifactsState,
  arrival: rawToArrivalState,
  artifact: rawToArtifactState,
  artifact_location: rawToArtifactLocationState,
};

/** Convert raw state object to typed state for the given table. */
export function rawToState<K extends TableName>(
  table: K,
  raw: Raw,
): TableRowType[K] {
  const fn = converters[table];
  if (!fn) throw new Error(`Unknown table: ${table}`);
  return fn(raw);
}

function fail(
  table: TableName,
  id: string,
  key: string,
  why: string,
  src: unknown,
): never {
  throw new Error(
    `Indexer convert: ${table}:${id}.${key} ${why} (raw=${String(src)})`,
  );
}

function assertUnsigned(
  table: TableName,
  id: string,
  key: string,
  src: unknown,
  value: bigint,
): void {
  let n: bigint;
  try {
    n = readUnsigned(src);
  } catch {
    fail(table, id, key, "is not a valid integer", src);
  }
  if (n !== value) fail(table, id, key, "is not a valid integer", src);
}

function assertString(
  table: TableName,
  id: string,
  key: string,
  src: unknown,
  value: string,
): void {
  let parsed: string;
  try {
    parsed = stringValue(src);
  } catch {
    fail(table, id, key, "is not a valid string", src);
  }
  if (parsed === "" || value === "") fail(table, id, key, "is empty", src);
  if (parsed !== value) fail(table, id, key, "is not a valid string", src);
}

function assertBoolean(
  table: TableName,
  id: string,
  key: string,
  src: unknown,
  value: boolean,
): void {
  const ok = value
    ? src === true || src === 1 || src === "1"
    : src === false || src === 0 || src === "0";
  if (!ok) fail(table, id, key, "is not a valid boolean", src);
}

function assertList(
  table: TableName,
  id: string,
  key: string,
  src: unknown,
  value: unknown[],
): void {
  if (!Array.isArray(src)) fail(table, id, key, "is not an array", src);
  if (src.length !== value.length) {
    fail(
      table,
      id,
      key,
      `length changed from ${src.length} to ${value.length}`,
      src,
    );
  }
  if (src.length > LIST_MAX) {
    fail(table, id, key, `exceeds length ${LIST_MAX}`, src);
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const srcItem = src[i];
    const itemKey = `${key}[${i}]`;
    if (srcItem === undefined || srcItem === null) {
      fail(table, id, itemKey, "missing", srcItem);
    }
    if (typeof item === "string") {
      assertString(table, id, itemKey, srcItem, item);
      continue;
    }
    if (
      item !== null &&
      typeof item === "object" &&
      "id" in item &&
      typeof (item as { id: unknown }).id === "string"
    ) {
      if (typeof srcItem !== "object" || Array.isArray(srcItem)) {
        fail(table, id, itemKey, "is not an object", srcItem);
      }
      const srcId = (srcItem as Raw).id;
      if (srcId === undefined || srcId === null) {
        fail(table, id, `${itemKey}.id`, "missing", srcId);
      }
      assertString(
        table,
        id,
        `${itemKey}.id`,
        srcId,
        (item as { id: string }).id,
      );
      continue;
    }
    fail(table, id, itemKey, "has an unexpected shape", srcItem);
  }
}

/**
 * Throws if converting `raw` changed a value or dropped list entries
 * (bad string, missing field, empty id, or a count past the list length).
 */
function assertLossless(
  table: TableName,
  id: string,
  raw: Raw,
  typed: Raw,
): void {
  for (const [key, value] of Object.entries(typed)) {
    const src = raw[key];
    if (src === undefined || src === null) fail(table, id, key, "missing", src);
    if (typeof value === "bigint") assertUnsigned(table, id, key, src, value);
    else if (typeof value === "number") {
      assertUnsigned(table, id, key, src, BigInt(value));
    } else if (typeof value === "boolean") {
      assertBoolean(table, id, key, src, value);
    } else if (typeof value === "string") {
      assertString(table, id, key, src, value);
    } else if (Array.isArray(value)) assertList(table, id, key, src, value);
  }

  const listKey = Array.isArray(typed.events)
    ? "events"
    : Array.isArray(typed.ids)
      ? "ids"
      : undefined;
  if (listKey !== undefined && typeof typed.count === "number") {
    const length = (typed[listKey] as unknown[]).length;
    if (typed.count > length) {
      fail(
        table,
        id,
        "count",
        `exceeds ${listKey} length ${length}`,
        raw.count,
      );
    }
  }
}

/**
 * Convert one row and reject values that did not survive the conversion.
 * Shared by snapshot load and live block updates.
 */
export function convertRow<K extends TableName>(
  table: K,
  id: string,
  raw: unknown,
): TableRowType[K] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Indexer convert: ${table}:${id} is not an object`);
  }
  const typed = rawToState(table, raw as Raw);
  assertLossless(table, id, raw as Raw, typed as unknown as Raw);
  return typed;
}

/**
 * Convert every snapshot row to typed state in place.
 * Throws on the first bad value so callers can discard the whole snapshot.
 */
export function normalizeSnapshot(snap: IndexerSnapshot): IndexerSnapshot {
  for (const table of TABLE_NAMES) {
    const map = snap[table] as Map<string, unknown>;
    for (const [id, row] of map) {
      map.set(id, convertRow(table, id, row));
    }
  }
  return snap;
}

/** Normalize event id to TableId (world = "0", else string). */
export function rawIdToTableId(table: TableName, rawId: unknown): string {
  if (table === "world") return "0";
  return toStr(rawId);
}
