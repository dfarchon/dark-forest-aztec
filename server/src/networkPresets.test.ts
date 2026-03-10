import assert from "node:assert/strict";
import test from "node:test";

import {
  getNetworkPreset,
  isNetworkPresetName,
  NETWORK_PRESET_NAMES,
} from "./networkPresets.ts";

test("NETWORK_PRESET_NAMES contains all expected networks", () => {
  assert.deepEqual(
    [...NETWORK_PRESET_NAMES].sort(),
    ["devnet", "local", "mainnet", "testnet"],
  );
});

test("getNetworkPreset returns preset for each known name", () => {
  for (const name of NETWORK_PRESET_NAMES) {
    const preset = getNetworkPreset(name);
    assert.equal(preset.name, name);
    assert.equal(typeof preset.pollIntervalMs, "number");
    assert.equal(typeof preset.debounceMs, "number");
    assert.equal(typeof preset.persistMinIntervalSec, "number");
    assert.equal(typeof preset.maxBlocksPerRequest, "number");
  }
});

test("isNetworkPresetName returns true for valid names", () => {
  assert.equal(isNetworkPresetName("devnet"), true);
  assert.equal(isNetworkPresetName("local"), true);
  assert.equal(isNetworkPresetName("mainnet"), true);
  assert.equal(isNetworkPresetName("testnet"), true);
});

test("isNetworkPresetName returns false for unknown names", () => {
  assert.equal(isNetworkPresetName("staging"), false);
  assert.equal(isNetworkPresetName(""), false);
});

test("devnet preset has relaxed polling for unstable node", () => {
  const preset = getNetworkPreset("devnet");
  assert.ok(preset.pollIntervalMs >= 5_000);
});

test("local preset has aggressive polling for sandbox", () => {
  const preset = getNetworkPreset("local");
  assert.ok(preset.pollIntervalMs <= 2_000);
});
