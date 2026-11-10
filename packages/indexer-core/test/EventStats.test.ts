import assert from "node:assert/strict";
import test from "node:test";

import { EventStats } from "../src/service/EventStats.ts";

test("EventStats starts empty and complete at the configured block", () => {
  const stats = new EventStats(5);
  assert.deepEqual(stats.get(), {
    fromBlock: 5,
    toBlock: 4,
    counts: {
      WorldUpdate: 0,
      PlayerUpdate: 0,
      PlanetUpdate: 0,
      PlanetRevealedCoordsUpdate: 0,
      PlanetEventsUpdate: 0,
      PlanetArtifactsUpdate: 0,
      ArrivalUpdate: 0,
      ArtifactUpdate: 0,
      ArtifactLocationUpdate: 0,
    },
    total: 0,
    complete: true,
  });
});

test("EventStats accumulates counts and then a snapshot marks history incomplete", () => {
  const stats = new EventStats(1);
  stats.add({ PlanetUpdate: 2, ArrivalUpdate: 1 }, 10);
  stats.add({ PlanetUpdate: 3 }, 12);

  const accumulated = stats.get();
  assert.equal(accumulated.toBlock, 12);
  assert.equal(accumulated.counts.PlanetUpdate, 5);
  assert.equal(accumulated.counts.ArrivalUpdate, 1);
  assert.equal(accumulated.total, 6);
  assert.equal(accumulated.complete, true);

  stats.resetAfterSnapshot(100);
  const reset = stats.get();
  assert.equal(reset.fromBlock, 101);
  assert.equal(reset.toBlock, 100);
  assert.equal(reset.total, 0);
  assert.equal(reset.complete, false);
});

test("EventStats.markComplete keeps counts and the previous toBlock", () => {
  const stats = new EventStats(1);
  stats.resetAfterSnapshot(40);
  stats.markComplete(1);

  const marked = stats.get();
  assert.equal(marked.fromBlock, 1);
  assert.equal(marked.toBlock, 40);
  assert.equal(marked.total, 0);
  assert.equal(marked.complete, true);
});
