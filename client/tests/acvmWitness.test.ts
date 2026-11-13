import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBase64,
  packWitness,
  packWitnessSync,
  unpackWitness,
  unpackWitnessSync,
} from "../src/Session/Acvm/acvmWitness.ts";

test("witness buffers round-trip", () => {
  const witness = new Map<number, string>([
    [2, "aa"],
    [0, ""],
    [7, "0x10ff"],
  ]);
  const packed = packWitnessSync(witness);
  const unpacked = unpackWitnessSync(packed);
  assert.equal(unpacked.size, 3);
  assert.equal(unpacked.get(2), "aa");
  assert.equal(unpacked.get(0), "");
  assert.equal(unpacked.get(7), "0x10ff");
});

test("async witness packing matches the sync bytes", async () => {
  const witness = new Map<number, string>([
    [1, "abc"],
    [4, "ff"],
  ]);
  const packed = await packWitness(witness);
  const sync = packWitnessSync(witness);
  assert.deepEqual(new Uint8Array(packed), new Uint8Array(sync));
  const unpacked = await unpackWitness(packed);
  assert.equal(unpacked.get(1), "abc");
  assert.equal(unpacked.get(4), "ff");
});

test("truncated witness buffers are rejected", () => {
  assert.throws(() => unpackWitnessSync(new ArrayBuffer(2)), /truncated/);
});

test("witness values outside latin1 are rejected", () => {
  assert.throws(() => packWitnessSync(new Map([[1, "\u0100"]])), /byte string/);
});

test("base64 decoding can cross chunk boundaries", async () => {
  const decoded = await decodeBase64("AQIDBAUG", 4);
  assert.deepEqual(Array.from(decoded), [1, 2, 3, 4, 5, 6]);
});
