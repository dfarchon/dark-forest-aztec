import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { gunzipSync } from "node:zlib";

import { jsonToSnapshot, SnapshotStore } from "./persistence.ts";

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

test("jsonToSnapshot rehydrates bigint fields from persisted JSON", () => {
  const snapshot = jsonToSnapshot({
    lastProcessedBlock: 42,
    world: {
      "0": {
        paused: false,
        radius: "2",
        misc_nonce: "3",
        next_change_block: 7,
      },
    },
    planet: {
      "123": {
        perlin: 1,
        created_at: "2",
        owner: "0xabc",
        planet_level: 2,
        planet_type: 3,
        space_type: 4,
        is_home_planet: false,
        is_initialized: true,
        destroyed: false,
        invader: "",
        capturer: "",
        invade_start_block: 0,
        population_cap: "10",
        population_growth: "11",
        range: "12",
        speed: "13",
        defense: "14",
        silver_cap: "15",
        silver_growth: "16",
        population: "17",
        silver: "18",
        upgrade_state_0: 0,
        upgrade_state_1: 1,
        upgrade_state_2: 2,
        last_updated: "19",
        pausers: "20",
        energy_gro_doublers: "21",
        silver_gro_doublers: "22",
        hat_level: "23",
        space_junk: "24",
        has_tried_finding_artifact: false,
        prospected_block_number: 25,
      },
    },
    artifact: {
      a1: {
        planet_discovered_on: "1",
        rarity: 1,
        planet_biome: 2,
        minted_at_timestamp: "3",
        discoverer: "0xdef",
        artifact_type: 4,
        activations: "5",
        last_activated: "6",
        last_deactivated: "7",
        wormhole_to: "8",
        owner: "0xowner",
        controller: "0xcontroller",
        last_updated: "9",
      },
    },
  });

  const world = snapshot.world.get("0");
  const planet = snapshot.planet.get("123");
  const artifact = snapshot.artifact.get("a1");

  assert.equal(typeof world?.radius, "bigint");
  assert.equal(world?.radius, 2n);
  assert.equal(typeof planet?.population_cap, "bigint");
  assert.equal(planet?.population_cap, 10n);
  assert.equal(planet?.planet_level, 2);
  assert.equal(planet?.owner, "0xabc");
  assert.deepEqual(Object.keys(world ?? {}).sort(), [
    "misc_nonce",
    "next_change_block",
    "paused",
    "radius",
  ]);
  assert.equal(artifact?.owner, "0xowner");
  assert.equal(artifact?.controller, "0xcontroller");
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
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-dualwrite-"),
  );
  const dbPath = path.join(tempDir, "indexer.db");

  try {
    const store = new SnapshotStore(dbPath, 0);
    const snapshotData = {
      lastProcessedBlock: 100,
      world: { "0": { paused: false, radius: "1", misc_nonce: "1", next_change_block: 0 } },
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

test("verifyChunkConsistency returns true when v1 and v2 match", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-verify-"),
  );
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
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-cleanup-"),
  );
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
