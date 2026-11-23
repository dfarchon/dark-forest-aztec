import assert from "node:assert/strict";
import test from "node:test";

import { aggregateDashboard, type DashboardInput } from "./report.ts";

function input(partial: Partial<DashboardInput> = {}): DashboardInput {
  return {
    actions: [],
    arrivals: [],
    artifacts: [],
    planetCount: 0,
    planetInits: [],
    bucketSeconds: 3600,
    generatedAt: 99,
    ...partial,
  };
}

test("aggregateDashboard stacks actions by hour and fills the quiet hour", () => {
  const report = aggregateDashboard(
    input({
      actions: [
        { timestamp: 10, player: "a", action: "move", quantity: null },
        { timestamp: 20, player: "a", action: "move", quantity: null },
        {
          timestamp: 30,
          player: "b",
          action: "upgrade_planet",
          quantity: null,
        },
        { timestamp: 8000, player: "a", action: "move", quantity: null },
      ],
    }),
  );
  assert.deepEqual(report.actions, ["move", "upgrade_planet"]);
  assert.equal(report.summary.operations, 4);
  assert.equal(report.summary.players, 2);
  assert.deepEqual(
    report.hourly.map((row) => ({
      bucket: row.bucket,
      move: row.actions.move,
      upgrade: row.actions.upgrade_planet,
      activePlayers: row.activePlayers,
    })),
    [
      { bucket: 0, move: 2, upgrade: 1, activePlayers: 2 },
      { bucket: 3600, move: 0, upgrade: 0, activePlayers: 0 },
      { bucket: 7200, move: 1, upgrade: 0, activePlayers: 1 },
    ],
  );
  assert.deepEqual(report.players, [
    { player: "a", operations: 3, kinds: 1 },
    { player: "b", operations: 1, kinds: 1 },
  ]);
});

test("aggregateDashboard sums silver with bigint and keeps invalid quantities at zero", () => {
  const report = aggregateDashboard(
    input({
      actions: [
        {
          timestamp: 1000,
          player: "a",
          action: "withdraw_silver",
          quantity: "9007199254740993",
        },
        {
          timestamp: 1001,
          player: "a",
          action: "withdraw_silver",
          quantity: "2",
        },
        {
          timestamp: 1002,
          player: "a",
          action: "withdraw_silver",
          quantity: "nope",
        },
      ],
      arrivals: [
        { timestamp: 1000, arrivalType: 1, silver: "100" },
        { timestamp: 1000, arrivalType: 1, silver: "20" },
      ],
    }),
  );
  assert.equal(report.summary.silverWithdrawn, "9007199254740995");
  assert.equal(report.summary.silverMoved, "120");
  assert.equal(report.hourly[0]?.silverWithdrawn, "9007199254740995");
  assert.equal(report.hourly[0]?.silverMoved, "120");
});

test("aggregateDashboard counts voyage types and groups artifacts", () => {
  const report = aggregateDashboard(
    input({
      arrivals: [
        { timestamp: 1000, arrivalType: 1, silver: "1" },
        { timestamp: 1000, arrivalType: 1, silver: "1" },
        { timestamp: 1000, arrivalType: 2, silver: "1" },
        { timestamp: 1000, arrivalType: 3, silver: "1" },
        { timestamp: 1000, arrivalType: 9, silver: "1" },
      ],
      artifacts: [
        { artifactType: 1, rarity: 2 },
        { artifactType: 1, rarity: 2 },
        { artifactType: 5, rarity: 1 },
      ],
      planetCount: 4,
      planetInits: [
        { bucket: 0, planetLevel: 1, initialized: 1, cumulative: 1 },
      ],
    }),
  );
  assert.equal(report.summary.voyages, 5);
  assert.equal(report.summary.planets, 4);
  assert.deepEqual(report.voyages, { normal: 2, photoid: 1, wormhole: 1 });
  assert.deepEqual(report.artifacts, [
    { artifactType: 1, rarity: 2, count: 2 },
    { artifactType: 5, rarity: 1, count: 1 },
  ]);
  assert.equal(report.planetInits.length, 1);
});

test("aggregateDashboard rejects a bucket size that is not a positive integer", () => {
  assert.throws(
    () => aggregateDashboard(input({ bucketSeconds: 0 })),
    /positive integer/,
  );
});
