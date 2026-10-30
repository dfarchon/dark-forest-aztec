import assert from "node:assert/strict";
import test from "node:test";

import { parseSnapshotV2Manifest } from "../src/Session/Indexer/snapshotV2.ts";

const tables = {
  world: { chunkCount: 0, rowCount: 0 },
  player: { chunkCount: 0, rowCount: 0 },
  planet: { chunkCount: 1, rowCount: 1 },
  planet_revealed_coords: { chunkCount: 0, rowCount: 0 },
  planet_events: { chunkCount: 0, rowCount: 0 },
  planet_artifacts: { chunkCount: 0, rowCount: 0 },
  arrival: { chunkCount: 0, rowCount: 0 },
  artifact: { chunkCount: 0, rowCount: 0 },
  artifact_location: { chunkCount: 0, rowCount: 0 },
};

test("parseSnapshotV2Manifest accepts a manifest with or without a block hash", () => {
  const base = {
    version: 2,
    lastProcessedBlock: 500,
    chunkRows: 1000,
    tables,
  };

  const withoutHash = parseSnapshotV2Manifest(base);
  assert.ok(withoutHash);
  assert.equal(withoutHash.lastProcessedBlockHash, undefined);

  const withHash = parseSnapshotV2Manifest({
    ...base,
    lastProcessedBlockHash: "0xabc",
  });
  assert.equal(withHash?.lastProcessedBlockHash, "0xabc");

  const ignored = parseSnapshotV2Manifest({
    ...base,
    lastProcessedBlockHash: 12,
  });
  assert.ok(ignored);
  assert.equal(ignored.lastProcessedBlockHash, undefined);
});
