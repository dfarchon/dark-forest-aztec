import assert from "node:assert/strict";
import test from "node:test";

import type { IndexerSnapshot } from "../src/types.ts";
import {
  normalizeSnapshot,
  toBigInt,
  toSafeNum,
} from "../src/utils/convert.ts";

function emptySnap(): IndexerSnapshot {
  return {
    lastProcessedBlock: 1,
    world: new Map(),
    player: new Map(),
    planet: new Map(),
    planet_revealed_coords: new Map(),
    planet_events: new Map(),
    planet_artifacts: new Map(),
    arrival: new Map(),
    artifact: new Map(),
    artifact_location: new Map(),
  };
}

test("toSafeNum keeps unsigned integers inside the requested width", () => {
  assert.equal(toSafeNum(255, 255), 255);
  assert.equal(toSafeNum("4294967295"), 4294967295);
  assert.equal(toSafeNum(0x10), 16);
  assert.equal(toSafeNum(null), 0);
});

test("toSafeNum rejects negatives, fractions, and values past u8 or u32", () => {
  assert.throws(() => toSafeNum(-1), /overflow/);
  assert.throws(() => toSafeNum(1.5), /not a valid integer/);
  assert.throws(() => toSafeNum("abc"), /not a valid integer/);
  assert.throws(() => toSafeNum([1]), /not a valid integer/);
  assert.throws(() => toSafeNum(256, 255), /overflow/);
  assert.throws(() => toSafeNum(2 ** 32), /overflow/);
});

test("toBigInt rejects negatives and non-integers", () => {
  assert.equal(toBigInt("0x10"), 16n);
  assert.equal(toBigInt(null), 0n);
  assert.throws(() => toBigInt(-1n), /overflow/);
  assert.throws(() => toBigInt("-2"), /overflow/);
  assert.throws(() => toBigInt("1.5"), /not a valid integer/);
  assert.throws(() => toBigInt("abc"), /not a valid integer/);
});

test("normalizeSnapshot rejects a plain object used as an address", () => {
  const snap = emptySnap();
  snap.arrival.set("0xarr", {
    id: "0xarr",
    player: { a: 1 },
    from_planet: "0xa",
    to_planet: "0xb",
    pop_arriving: 1n,
    silver_moved: 0n,
    departure_time: 1n,
    arrival_time: 2n,
    arrival_type: 1,
    carried_artifact_id: "0",
    distance: 1n,
  } as never);
  assert.throws(() => normalizeSnapshot(snap), /not a valid string/);
});

test("normalizeSnapshot rejects an empty event id", () => {
  const snap = emptySnap();
  snap.planet_events.set("0xplanet", {
    events: [{ id: "" }],
    count: 1,
    last_updated: 1n,
  } as never);
  assert.throws(() => normalizeSnapshot(snap), /is empty/);
});
