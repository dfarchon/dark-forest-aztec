import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { gunzipSync, gzipSync } from "node:zlib";

import { SnapshotStore } from "./persistence.ts";

test("v3 snapshot publication is immutable and an invalid replacement keeps the active version", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-v3-"));
  try {
    const store = new SnapshotStore(path.join(dir, "indexer.db"), 0);
    store.setSnapshotIdentity({
      networkId: "1:rollup",
      startBlock: 1,
      tipTag: "proven",
      schemaVersion: 2,
      storageAddresses: { WorldStorage: "0x1" },
    });
    const tables = Object.fromEntries(
      [
        "world",
        "player",
        "planet",
        "planet_revealed_coords",
        "planet_events",
        "planet_artifacts",
        "arrival",
        "artifact",
        "artifact_location",
      ].map((name) => [name, {}]),
    );
    const snapshot = (value: number) =>
      JSON.stringify({
        lastProcessedBlock: 42,
        lastProcessedBlockHash: `hash-${value}`,
        ...tables,
        world: { "0": { value } },
      });
    store.forceSave(42, snapshot(1));
    const first = store.getActiveV3Manifest();
    assert.ok(first);
    const firstChunk = store.getV3Chunk(first.snapshotId, "world", 0);
    assert.ok(firstChunk);
    assert.equal(
      JSON.parse(gunzipSync(firstChunk).toString()).rows["0"].value,
      1,
    );
    store.forceSave(42, snapshot(2));
    const second = store.getActiveV3Manifest();
    assert.ok(second);
    assert.notEqual(second.snapshotId, first.snapshotId);
    assert.equal(
      JSON.parse(
        gunzipSync(store.getV3Chunk(first.snapshotId, "world", 0)!).toString(),
      ).rows["0"].value,
      1,
    );
    assert.throws(
      () => store.forceSave(43, JSON.stringify({ lastProcessedBlock: 43 })),
      /hash/,
    );
    (store as unknown as { writeChunks: () => void }).writeChunks = () => {
      throw new Error("chunk write failed");
    };
    assert.throws(() => store.forceSave(42, snapshot(3)), /chunk write failed/);
    assert.equal(store.getActiveV3Manifest()?.snapshotId, second.snapshotId);
    assert.equal(store.restore()?.blockNumber, 42);
    assert.equal(
      (store.restore()?.data.world as Record<string, { value: number }>)["0"]
        .value,
      2,
    );
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SnapshotStore.createBackupBuffer returns a readable SQLite backup", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-store-test-"));
  const dbPath = path.join(tempDir, "indexer.db");
  const backupPath = path.join(tempDir, "backup.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    store.save(
      42,
      JSON.stringify({
        lastProcessedBlock: 42,
        world: {
          "0": {
            paused: false,
          },
        },
      }),
    );

    const backupBuffer = await store.createBackupBuffer();
    fs.writeFileSync(backupPath, backupBuffer);

    const backupDb = new Database(backupPath, { readonly: true });
    const row = backupDb
      .prepare("SELECT block_number, data FROM snapshots WHERE id = 1")
      .get() as { block_number: number; data: string } | undefined;

    assert.ok(row);
    assert.equal(row?.block_number, 42);
    assert.match(row?.data ?? "", /lastProcessedBlock/);

    backupDb.close();
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SnapshotStore resets stored snapshot when snapshot schema version changes", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-store-version-"),
  );
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const v1Store = new SnapshotStore(dbPath, 0, {
      dbSchemaVersion: 1,
      snapshotSchemaVersion: 1,
    });
    v1Store.save(
      99,
      JSON.stringify({
        lastProcessedBlock: 99,
        world: {
          "0": {
            paused: false,
            radius: "1",
            misc_nonce: "1",
            next_change_block: 0,
          },
        },
      }),
    );
    const restoredV1 = v1Store.restore();
    assert.ok(restoredV1);
    v1Store.close();

    const v2Store = new SnapshotStore(dbPath, 0, {
      dbSchemaVersion: 1,
      snapshotSchemaVersion: 2,
    });
    const restoredV2 = v2Store.restore();
    assert.equal(restoredV2, null);
    v2Store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dual-write: save() writes to both v1 snapshots and v2 snapshot_chunks tables", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-dualwrite-"));
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    const snapshotData = {
      lastProcessedBlock: 100,
      world: {
        "0": {
          paused: false,
          radius: "1",
          misc_nonce: "1",
          next_change_block: 0,
        },
      },
      planet: {},
      player: {},
      planet_revealed_coords: {},
      planet_events: {},
      planet_artifacts: {},
      arrival: {},
      artifact: {},
      artifact_location: {},
    };
    store.save(100, JSON.stringify(snapshotData));

    // v1: old table still populated
    const v1Row = store.restore();
    assert.ok(v1Row);
    assert.equal(v1Row?.blockNumber, 100);

    // v2: chunk table populated
    const db = new Database(dbPath, { readonly: true });
    const chunks = db
      .prepare("SELECT * FROM snapshot_chunks WHERE snapshot_block = ?")
      .all(100) as Array<{
      snapshot_block: number;
      table_name: string;
      chunk_index: number;
      row_count: number;
      encoding: string;
      payload: Buffer;
    }>;

    // Only "world" has data (1 row → 1 chunk), rest have 0 rows → 0 chunks
    const worldChunks = chunks.filter((c) => c.table_name === "world");
    assert.equal(worldChunks.length, 1);
    assert.equal(worldChunks[0].chunk_index, 0);
    assert.equal(worldChunks[0].row_count, 1);

    // Decompress and verify chunk payload
    const chunkPayload = JSON.parse(
      gunzipSync(worldChunks[0].payload).toString(),
    );
    assert.equal(chunkPayload.version, 2);
    assert.equal(chunkPayload.table, "world");
    assert.equal(chunkPayload.chunkRows, 1000);
    assert.deepEqual(chunkPayload.rows, snapshotData.world);

    // metadata: active_snapshot_block set
    const metaRow = db
      .prepare("SELECT value FROM metadata WHERE key = 'active_snapshot_block'")
      .get() as { value: string } | undefined;
    assert.ok(metaRow);
    assert.equal(metaRow?.value, "100");

    // manifest written
    const manifest = db
      .prepare("SELECT * FROM snapshot_manifests WHERE snapshot_block = ?")
      .get(100) as { manifest_json: string } | undefined;
    assert.ok(manifest);
    const parsed = JSON.parse(manifest!.manifest_json);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.tables.world.rowCount, 1);

    db.close();
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getActiveEncodedChunk ignores legacy stored chunks missing chunkRows", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-legacy-chunk-"),
  );
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    const snapshotData = {
      lastProcessedBlock: 100,
      world: {
        "0": {
          paused: false,
          radius: "1",
          misc_nonce: "1",
          next_change_block: 0,
        },
      },
      planet: {},
      player: {},
      planet_revealed_coords: {},
      planet_events: {},
      planet_artifacts: {},
      arrival: {},
      artifact: {},
      artifact_location: {},
    };
    store.save(100, JSON.stringify(snapshotData));

    const db = new Database(dbPath);
    const legacyChunkJson = JSON.stringify({
      version: 2,
      table: "world",
      chunkIndex: 0,
      chunkCount: 1,
      rowCount: 1,
      rows: snapshotData.world,
      lastProcessedBlock: 100,
    });
    db.prepare(
      `UPDATE snapshot_chunks
       SET payload = ?, encoding = 'gzip'
       WHERE snapshot_block = ? AND table_name = ? AND chunk_index = ?`,
    ).run(gzipSync(Buffer.from(legacyChunkJson)), 100, "world", 0);
    db.close();

    const chunk = store.getActiveEncodedChunk("world", 0, 1000);
    assert.equal(chunk, "invalid");
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getActiveSnapshotPayload reconstructs the active snapshot version from v2 data", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-active-snapshot-"),
  );
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    store.save(
      100,
      JSON.stringify({
        lastProcessedBlock: 100,
        world: {
          "0": {
            paused: false,
            radius: "1",
            misc_nonce: "1",
            next_change_block: 0,
          },
        },
        player: {},
        planet: {},
        planet_revealed_coords: {},
        planet_events: {},
        planet_artifacts: {},
        arrival: {},
        artifact: {},
        artifact_location: {},
      }),
    );

    const db = new Database(dbPath);
    db.prepare(
      "UPDATE snapshots SET block_number = ?, data = ? WHERE id = 1",
    ).run(
      101,
      JSON.stringify({
        lastProcessedBlock: 101,
        world: {},
        player: { rogue: { score: "999" } },
        planet: {},
        planet_revealed_coords: {},
        planet_events: {},
        planet_artifacts: {},
        arrival: {},
        artifact: {},
        artifact_location: {},
      }),
    );
    db.close();

    const active = store.getActiveSnapshotPayload();
    assert.ok(active);
    assert.equal(active?.blockNumber, 100);
    const parsed = JSON.parse(active!.jsonString) as {
      lastProcessedBlock: number;
      world: Record<string, unknown>;
      player: Record<string, unknown>;
    };
    assert.equal(parsed.lastProcessedBlock, 100);
    assert.deepEqual(Object.keys(parsed.world), ["0"]);
    assert.deepEqual(Object.keys(parsed.player), []);

    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("verifyChunkConsistency returns true when v1 and v2 match", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-verify-"));
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    const snapshotData = {
      lastProcessedBlock: 50,
      world: { "0": { paused: false } },
      planet: {},
      player: {},
      planet_revealed_coords: {},
      planet_events: {},
      planet_artifacts: {},
      arrival: {},
      artifact: {},
      artifact_location: {},
    };
    const jsonString = JSON.stringify(snapshotData);
    store.save(50, jsonString);

    const result = store.verifyChunkConsistency(jsonString);
    assert.equal(result, true);

    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanup retains only N=2 snapshot versions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-cleanup-"));
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    const makeSnapshot = (block: number) =>
      JSON.stringify({
        lastProcessedBlock: block,
        world: { "0": { paused: false } },
        planet: {},
        player: {},
        planet_revealed_coords: {},
        planet_events: {},
        planet_artifacts: {},
        arrival: {},
        artifact: {},
        artifact_location: {},
      });

    store.save(10, makeSnapshot(10));
    store.save(20, makeSnapshot(20));
    store.save(30, makeSnapshot(30));

    const db = new Database(dbPath, { readonly: true });
    const blocks = db
      .prepare(
        "SELECT DISTINCT snapshot_block FROM snapshot_chunks ORDER BY snapshot_block",
      )
      .all() as Array<{ snapshot_block: number }>;

    // Only blocks 20 and 30 should remain (block 10 cleaned up)
    assert.deepEqual(
      blocks.map((b) => b.snapshot_block),
      [20, 30],
    );

    db.close();
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanup after restart preserves last active block, not incomplete crash block", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-restart-cleanup-"),
  );
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const makeSnapshot = (block: number) =>
      JSON.stringify({
        lastProcessedBlock: block,
        world: { "0": { paused: false } },
        planet: {},
        player: {},
        planet_revealed_coords: {},
        planet_events: {},
        planet_artifacts: {},
        arrival: {},
        artifact: {},
        artifact_location: {},
      });

    // First "run": save block 100 and 200
    const store1 = new SnapshotStore(dbPath, 0);
    store1.save(100, makeSnapshot(100));
    store1.save(200, makeSnapshot(200));
    store1.close();
    // active_snapshot_block = 200 in metadata

    // Simulate crash: manually insert incomplete chunks for block 300
    // (only world, missing other tables — as if crash during Phase A)
    const rawDb = new Database(dbPath);
    rawDb
      .prepare(
        "INSERT INTO snapshot_chunks (snapshot_block, table_name, chunk_index, row_count, encoding, payload) VALUES (?, ?, ?, ?, 'gzip', ?)",
      )
      .run(300, "world", 0, 1, Buffer.from("fake"));
    rawDb.close();

    // Second "run": new SnapshotStore reads active=200 from metadata
    const store2 = new SnapshotStore(dbPath, 0);
    // save block 310 — cleanup should keep [310, 200], delete 100 and 300's residue
    store2.save(310, makeSnapshot(310));

    const db = new Database(dbPath, { readonly: true });
    const blocks = db
      .prepare(
        "SELECT DISTINCT snapshot_block FROM snapshot_chunks ORDER BY snapshot_block",
      )
      .all() as Array<{ snapshot_block: number }>;

    // block 200 (last complete active) + 310 (current) kept
    // block 100 and 300 (crash residue) cleaned up
    assert.deepEqual(
      blocks.map((b) => b.snapshot_block),
      [200, 310],
    );

    db.close();
    store2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("verifyChunkConsistency returns false for a corrupt gzip chunk", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-bad-gzip-"));
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    const jsonString = JSON.stringify({
      lastProcessedBlock: 7,
      world: { "0": { paused: false } },
      player: {},
      planet: {},
      planet_revealed_coords: {},
      planet_events: {},
      planet_artifacts: {},
      arrival: {},
      artifact: {},
      artifact_location: {},
    });
    store.save(7, jsonString);
    const db = new Database(dbPath);
    db.prepare(
      `UPDATE snapshot_chunks SET payload = ? WHERE snapshot_block = ? AND table_name = 'world'`,
    ).run(Buffer.from("not-gzip"), 7);
    db.close();

    assert.equal(store.verifyChunkConsistency(jsonString), false);
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("schema mismatch clears the active snapshot pointer", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-schema-ptr-"));
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0, {
      dbSchemaVersion: 1,
      snapshotSchemaVersion: 1,
    });
    store.save(
      9,
      JSON.stringify({
        lastProcessedBlock: 9,
        world: {},
        player: {},
        planet: {},
        planet_revealed_coords: {},
        planet_events: {},
        planet_artifacts: {},
        arrival: {},
        artifact: {},
        artifact_location: {},
      }),
    );
    store.close();

    const reopened = new SnapshotStore(dbPath, 0, {
      dbSchemaVersion: 2,
      snapshotSchemaVersion: 1,
    });
    assert.equal(reopened.getActiveSnapshotPayload(), null);
    const db = new Database(dbPath, { readonly: true });
    const pointer = db
      .prepare("SELECT value FROM metadata WHERE key = 'active_snapshot_block'")
      .get() as { value: string } | undefined;
    assert.equal(pointer, undefined);
    db.close();
    reopened.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
