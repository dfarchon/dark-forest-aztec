import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

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
        planet_events_count: "1",
        radius: "2",
        misc_nonce: "3",
        planet_ids_count: "4",
        revealed_planet_ids_count: "5",
        player_ids_count: "6",
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
  });

  const world = snapshot.world.get("0");
  const planet = snapshot.planet.get("123");

  assert.equal(typeof world?.radius, "bigint");
  assert.equal(world?.radius, 2n);
  assert.equal(typeof planet?.population_cap, "bigint");
  assert.equal(planet?.population_cap, 10n);
  assert.equal(planet?.planet_level, 2);
  assert.equal(planet?.owner, "0xabc");
});
