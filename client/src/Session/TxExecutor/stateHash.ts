/**
 * Poseidon2 hash computation for contract state objects.
 *
 * Each serialize* function produces an array of Fieldable values in the exact
 * order that Noir's #[derive(Serialize)] emits for the corresponding struct.
 * The resulting hash must match what the storage contracts compute via
 * poseidon2_hash(state.serialize()).
 *
 * Noir type → Fieldable mapping:
 *   Field        → bigint
 *   u8/u32/u64   → number  (fits in JS number)
 *   u128         → bigint
 *   bool         → boolean
 *   AztecAddress → bigint  (the inner Field)
 */

import type { Fr } from "@aztec/aztec.js/fields";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import type { Fieldable } from "@aztec/foundation/serialize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addressToField(addr: unknown): bigint {
  const s = String(addr ?? "0x0");
  return BigInt(s.startsWith("0x") ? s : `0x${s}`);
}

function num(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
}

function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  return BigInt(String(v ?? 0));
}

function bool(v: unknown): boolean {
  return !!v;
}

// ---------------------------------------------------------------------------
// Zero-state detection
// ---------------------------------------------------------------------------

function isAllZero(fields: Fieldable[]): boolean {
  for (const f of fields) {
    if (typeof f === "boolean") {
      if (f) return false;
    } else if (typeof f === "number") {
      if (f !== 0) return false;
    } else if (typeof f === "bigint") {
      if (f !== 0n) return false;
    } else {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Serialize functions (field order matches Noir #[derive(Serialize)])
// ---------------------------------------------------------------------------

export function serializePlanet(p: Record<string, unknown>): Fieldable[] {
  return [
    num(p.perlin),
    num(p.created_at),
    addressToField(p.owner),
    num(p.planet_level),
    num(p.planet_type),
    num(p.space_type),
    bool(p.is_home_planet),
    bool(p.is_initialized),
    bool(p.destroyed),
    addressToField(p.invader),
    addressToField(p.capturer),
    num(p.invade_start_block),
    big(p.population_cap),
    big(p.population_growth),
    big(p.range),
    big(p.speed),
    big(p.defense),
    big(p.silver_cap),
    big(p.silver_growth),
    big(p.population),
    big(p.silver),
    num(p.upgrade_state_0),
    num(p.upgrade_state_1),
    num(p.upgrade_state_2),
    num(p.last_updated),
    big(p.pausers),
    big(p.energy_gro_doublers),
    big(p.silver_gro_doublers),
    big(p.hat_level),
    big(p.space_junk),
    bool(p.has_tried_finding_artifact),
    num(p.prospected_block_number),
  ];
}

export function serializePlanetEvents(
  pe: Record<string, unknown>
): Fieldable[] {
  const events = pe.events as { id: unknown }[];
  const fields: Fieldable[] = [];
  for (let i = 0; i < 20; i++) {
    fields.push(big(events[i]?.id ?? 0));
  }
  fields.push(num(pe.count));
  fields.push(num(pe.last_updated));
  return fields;
}

export function serializePlanetArtifacts(
  pa: Record<string, unknown>
): Fieldable[] {
  const ids = pa.ids as unknown[];
  const fields: Fieldable[] = [];
  for (let i = 0; i < 20; i++) {
    fields.push(big(ids[i] ?? 0));
  }
  fields.push(num(pa.count));
  fields.push(num(pa.last_updated));
  return fields;
}

export function serializeArrival(a: Record<string, unknown>): Fieldable[] {
  return [
    big(a.id),
    addressToField(a.player),
    big(a.from_planet),
    big(a.to_planet),
    big(a.pop_arriving),
    big(a.silver_moved),
    num(a.departure_time),
    num(a.arrival_time),
    num(a.arrival_type),
    big(a.carried_artifact_id),
    big(a.distance),
  ];
}

export function serializeArtifact(a: Record<string, unknown>): Fieldable[] {
  return [
    big(a.planet_discovered_on),
    num(a.rarity),
    num(a.planet_biome),
    num(a.minted_at_timestamp),
    addressToField(a.discoverer),
    num(a.artifact_type),
    big(a.activations),
    num(a.last_activated),
    num(a.last_deactivated),
    big(a.wormhole_to),
    addressToField(a.controller),
    num(a.last_updated),
  ];
}

export function serializeArtifactLocation(
  al: Record<string, unknown>
): Fieldable[] {
  return [big(al.planet_id), big(al.voyage_id), num(al.last_updated)];
}

export function serializePlayer(p: Record<string, unknown>): Fieldable[] {
  return [
    num(p.init_timestamp),
    big(p.home_planet_id),
    num(p.last_reveal_timestamp),
    big(p.score),
    big(p.space_junk),
    big(p.space_junk_limit),
    bool(p.claimed_ships),
    num(p.last_updated),
  ];
}

export function serializeWorld(w: Record<string, unknown>): Fieldable[] {
  return [
    bool(w.paused),
    big(w.planet_events_count),
    big(w.radius),
    big(w.misc_nonce),
    big(w.planet_ids_count),
    big(w.revealed_planet_ids_count),
    big(w.player_ids_count),
    num(w.next_change_block),
  ];
}

// ---------------------------------------------------------------------------
// Hash functions
// ---------------------------------------------------------------------------

type SerializeFn = (obj: Record<string, unknown>) => Fieldable[];

async function computeHash(
  obj: Record<string, unknown>,
  serializeFn: SerializeFn
): Promise<Fr> {
  const { Fr: FrClass } = await import("@aztec/aztec.js/fields");
  const fields = serializeFn(obj);
  if (isAllZero(fields)) return FrClass.ZERO;
  return poseidon2Hash(fields);
}

export const computePlanetHash = (p: Record<string, unknown>) =>
  computeHash(p, serializePlanet);

export const computePlanetEventsHash = (pe: Record<string, unknown>) =>
  computeHash(pe, serializePlanetEvents);

export const computePlanetArtifactsHash = (pa: Record<string, unknown>) =>
  computeHash(pa, serializePlanetArtifacts);

export const computeArrivalHash = (a: Record<string, unknown>) =>
  computeHash(a, serializeArrival);

export const computeArtifactHash = (a: Record<string, unknown>) =>
  computeHash(a, serializeArtifact);

export const computeArtifactLocationHash = (al: Record<string, unknown>) =>
  computeHash(al, serializeArtifactLocation);

export const computePlayerHash = (p: Record<string, unknown>) =>
  computeHash(p, serializePlayer);

export const computeWorldHash = (w: Record<string, unknown>) =>
  computeHash(w, serializeWorld);
