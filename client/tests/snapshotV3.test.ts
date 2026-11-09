import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TABLE_NAMES } from "@dfpunk/indexer-core";
import { OffChainBlockSource } from "../src/Session/Indexer/OffChainSource.ts";

const snapshotId = "00000000-0000-4000-8000-000000000001";
const chunk = JSON.stringify({
  version: 3,
  snapshotId,
  table: "world",
  chunkIndex: 0,
  rows: { "0": { paused: false } },
});
const hash = createHash("sha256").update(chunk).digest("hex");
const manifest = {
  version: 3,
  snapshotId,
  lastProcessedBlock: 42,
  lastProcessedBlockHash: "chain-hash",
  identity: {
    networkId: "1:rollup",
    startBlock: 1,
    tipTag: "proven",
    schemaVersion: 2,
    storageAddresses: { WorldStorage: "0x1" },
  },
  chunkRows: 1000,
  tables: Object.fromEntries(
    TABLE_NAMES.map((table) => [
      table,
      table === "world"
        ? { rowCount: 1, hashes: [hash] }
        : { rowCount: 0, hashes: [] },
    ])
  ),
};

function source(payload: string) {
  return new OffChainBlockSource({
    baseUrl: "http://indexer.test",
    fetch: async (url) =>
      new Response(
        String(url).endsWith("/manifest") ? JSON.stringify(manifest) : payload,
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
  });
}

test("v3 accepts a complete, hash-verified nine-table snapshot", async () => {
  const snap = await source(chunk).getSnapshot();
  assert.equal(snap?.lastProcessedBlock, 42);
  assert.equal(snap?.identity?.networkId, "1:rollup");
  assert.deepEqual(snap?.world.get("0"), { paused: false });
  assert.equal(snap?.planet.size, 0);
});

test("v3 rejects a chunk from another same-height publication", async () => {
  const mixed = chunk.replace(
    snapshotId,
    "00000000-0000-4000-8000-000000000002"
  );
  await assert.rejects(() => source(mixed).getSnapshot(), /hash mismatch/);
});

test("v3 restarts from a new manifest when an old publication expires", async () => {
  const nextId = "00000000-0000-4000-8000-000000000002";
  const nextChunk = chunk.replace(snapshotId, nextId);
  const nextHash = createHash("sha256").update(nextChunk).digest("hex");
  let manifests = 0;
  const indexer = new OffChainBlockSource({
    baseUrl: "http://indexer.test",
    fetch: async (url) => {
      if (String(url).endsWith("/manifest")) {
        manifests++;
        return Response.json(
          manifests === 1
            ? manifest
            : {
                ...manifest,
                snapshotId: nextId,
                tables: {
                  ...manifest.tables,
                  world: { rowCount: 1, hashes: [nextHash] },
                },
              }
        );
      }
      return String(url).includes(snapshotId)
        ? new Response("expired", { status: 404 })
        : new Response(nextChunk);
    },
  });
  const snap = await indexer.getSnapshot();
  assert.equal(manifests, 2);
  assert.deepEqual(snap?.world.get("0"), { paused: false });
});
