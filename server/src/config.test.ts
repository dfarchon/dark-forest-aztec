import test from "node:test";
import assert from "node:assert/strict";

import { START_BLOCK } from "@dfpunk/contracts";

import { parseServerConfig } from "./config.ts";
import { getNetworkPreset } from "./networkPresets.ts";

test("parseServerConfig defaults to devnet and known frontend origins", () => {
  const config = parseServerConfig({});

  assert.equal(config.aztecNodeUrl, "https://v4-devnet-2.aztec-labs.com");
  assert.equal(config.nodeKind, "remote");
  assert.equal(config.networkPreset, "devnet");
  assert.deepEqual(config.corsOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://df-aztec.netlify.app",
  ]);
});

test("parseServerConfig auto-detects local preset for localhost", () => {
  const config = parseServerConfig({
    AZTEC_NODE_URL: "http://localhost:8080",
  });
  const localPreset = getNetworkPreset("local");

  assert.equal(config.networkPreset, "local");
  assert.equal(config.nodeKind, "local");
  assert.equal(config.pollIntervalMs, localPreset.pollIntervalMs);
  assert.equal(config.debounceMs, localPreset.debounceMs);
  assert.equal(config.persistMinIntervalSec, localPreset.persistMinIntervalSec);
  assert.equal(config.maxBlocksPerRequest, localPreset.maxBlocksPerRequest);
});

test("parseServerConfig uses devnet preset values for remote URL", () => {
  const config = parseServerConfig({});
  const devnetPreset = getNetworkPreset("devnet");

  assert.equal(config.pollIntervalMs, devnetPreset.pollIntervalMs);
  assert.equal(config.debounceMs, devnetPreset.debounceMs);
  assert.equal(config.persistMinIntervalSec, devnetPreset.persistMinIntervalSec);
  assert.equal(config.maxBlocksPerRequest, devnetPreset.maxBlocksPerRequest);
});

test("parseServerConfig NETWORK_PRESET overrides auto-detection", () => {
  const config = parseServerConfig({
    AZTEC_NODE_URL: "https://remote.aztec.example",
    NETWORK_PRESET: "mainnet",
  });
  const mainnetPreset = getNetworkPreset("mainnet");

  assert.equal(config.networkPreset, "mainnet");
  assert.equal(config.pollIntervalMs, mainnetPreset.pollIntervalMs);
  assert.equal(config.persistMinIntervalSec, mainnetPreset.persistMinIntervalSec);
});

test("parseServerConfig env vars override preset values", () => {
  const config = parseServerConfig({
    POLL_INTERVAL_MS: "5000",
    DEBOUNCE_MS: "3000",
    MAX_BLOCKS_PER_REQUEST: "42",
    PERSIST_MIN_INTERVAL_SEC: "99",
  });

  assert.equal(config.networkPreset, "devnet");
  assert.equal(config.pollIntervalMs, 5000);
  assert.equal(config.debounceMs, 3000);
  assert.equal(config.maxBlocksPerRequest, 42);
  assert.equal(config.persistMinIntervalSec, 99);
});

test("parseServerConfig rejects unknown NETWORK_PRESET", () => {
  assert.throws(
    () => parseServerConfig({ NETWORK_PRESET: "staging" }),
    /NETWORK_PRESET/,
  );
});

test("parseServerConfig prefers INDEXER_START_BLOCK override", () => {
  const config = parseServerConfig({
    AZTEC_NODE_URL: "https://devnet.aztec.example",
    INDEXER_START_BLOCK: "456",
    PORT: "3100",
    SQLITE_PATH: "./data/test.db",
    PERSIST_MIN_INTERVAL_SEC: "5",
    CORS_ORIGINS: "https://game.example",
  });

  assert.equal(config.aztecNodeUrl, "https://devnet.aztec.example");
  assert.equal(config.indexerStartBlock, 456);
  assert.equal(config.nodeKind, "remote");
  assert.equal(config.port, 3100);
});

test("parseServerConfig falls back to workspace START_BLOCK", () => {
  const config = parseServerConfig({
    AZTEC_NODE_URL: "http://localhost:8080",
  });

  assert.equal(config.indexerStartBlock, START_BLOCK);
  assert.equal(config.nodeKind, "local");
});

test("parseServerConfig rejects invalid INDEXER_START_BLOCK", () => {
  assert.throws(
    () =>
      parseServerConfig({
        AZTEC_NODE_URL: "https://devnet.aztec.example",
        INDEXER_START_BLOCK: "-1",
      }),
    /INDEXER_START_BLOCK/,
  );
});

test("parseServerConfig rejects invalid AZTEC_NODE_URL", () => {
  assert.throws(
    () =>
      parseServerConfig({
        AZTEC_NODE_URL: "not-a-url",
      }),
    /AZTEC_NODE_URL/,
  );
});
