import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "@dfpunk/types";

import {
  buildScoreboard,
  scoreboardRank,
} from "../src/Frontend/Utils/scoreboard";

function player(address: string, score: number, initTimestamp = 1): Player {
  return { address, score, initTimestamp } as Player;
}

test("scores sort descending with shared ranks and deterministic address order, without changing players", () => {
  const players = [
    player("0xcccc", 10),
    player("0xbbbb", 50),
    player("0xaaaa", 50),
    player("0xdddd", 100),
  ];
  const before = structuredClone(players);
  const rows = buildScoreboard(players);
  assert.deepEqual(
    rows.map((row) => [row.address, row.score, row.rank]),
    [
      ["0xdddd", 100, 1],
      ["0xaaaa", 50, 2],
      ["0xbbbb", 50, 2],
      ["0xcccc", 10, 4],
    ]
  );
  assert.equal(scoreboardRank(rows, "0xBBBB"), 2);
  assert.deepEqual(players, before);
});

test("joined zero-score players are ranked, uninitialized players are excluded, and invalid scores remain unknown", () => {
  const rows = buildScoreboard([
    player("0xpositive", 20),
    player("0xzero", 0),
    player("0xunjoined", 100, 0),
    player("0xunknown", NaN),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.address, row.rank]),
    [
      ["0xpositive", 1],
      ["0xzero", 2],
      ["0xunknown", undefined],
    ]
  );
  assert.equal(rows[2].score, undefined);
});

test("a fresh confirmed snapshot updates rank after score changes and new joins", () => {
  const initial = buildScoreboard([player("0xme", 10), player("0xother", 20)]);
  const updated = buildScoreboard([
    player("0xme", 30),
    player("0xother", 20),
    player("0xnew", 50),
  ]);
  assert.equal(scoreboardRank(initial, "0xme"), 2);
  assert.equal(scoreboardRank(updated, "0xme"), 2);
  assert.equal(scoreboardRank(updated, "0xother"), 3);
  assert.equal(updated[0].address, "0xnew");
  assert.equal(updated[1].score, 30);
});

test("missing accounts and empty games do not display a fabricated rank", () => {
  assert.deepEqual(buildScoreboard([]), []);
  assert.equal(scoreboardRank([], "0xme"), undefined);
  assert.equal(
    scoreboardRank(buildScoreboard([player("0xother", 1)]), "0xme"),
    undefined
  );
  assert.equal(scoreboardRank([], undefined), undefined);
});
