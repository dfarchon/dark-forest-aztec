import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { TABLE_NAMES } from "@dfpunk/indexer-core";
import { createApp } from "./api.ts";
import { SnapshotStore } from "./persistence.ts";

test("v3 HTTP manifest pins immutable chunks with matching hashes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-v3-api-"));
  try {
    const store = new SnapshotStore(path.join(dir, "indexer.db"), 0);
    store.setSnapshotIdentity({
      networkId: "1:rollup",
      startBlock: 1,
      tipTag: "proven",
      schemaVersion: 2,
      storageAddresses: { WorldStorage: "0x1" },
    });
    const app = createApp({
      indexer: {} as never,
      cache: {} as never,
      store,
      adminToken: "",
      corsOrigins: [],
    });
    assert.equal((await app.request("/snapshot/v3/manifest")).status, 404);
    const tables = Object.fromEntries(TABLE_NAMES.map((table) => [table, {}]));
    store.forceSave(
      7,
      JSON.stringify({
        lastProcessedBlock: 7,
        lastProcessedBlockHash: "0xhash",
        ...tables,
        world: { "0": { paused: false } },
      }),
    );
    const manifestResponse = await app.request("/snapshot/v3/manifest");
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.identity.startBlock, 1);
    const chunkResponse = await app.request(
      `/snapshot/v3/chunks/${manifest.snapshotId}/world/0`,
    );
    assert.equal(chunkResponse.status, 200);
    const bytes = Buffer.from(await chunkResponse.arrayBuffer());
    const text = gunzipSync(bytes).toString();
    assert.equal(
      createHash("sha256").update(text).digest("hex"),
      manifest.tables.world.hashes[0],
    );
    assert.equal(JSON.parse(text).snapshotId, manifest.snapshotId);
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
