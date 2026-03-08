import test from "node:test";
import assert from "node:assert/strict";

import { START_BLOCK } from "@dfpunk/contracts";

import { parseServerConfig } from "./config.ts";

test("parseServerConfig defaults to devnet and known frontend origins", () => {
  const config = parseServerConfig({});

  assert.equal(config.aztecNodeUrl, "https://v4-devnet-2.aztec-labs.com");
  assert.equal(config.nodeKind, "remote");
  assert.deepEqual(config.corsOrigins, [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://df-aztec.netlify.app",
  ]);
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
