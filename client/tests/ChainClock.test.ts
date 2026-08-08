import type { AztecNode } from "@aztec/aztec.js/node";
import assert from "node:assert/strict";
import test from "node:test";

import { ChainClock } from "../src/Backend/Utils/ChainClock.ts";

const unusedNode = {} as AztecNode;

test("keeps authoritative time frozen while display time advances", () => {
  let wallMs = 1_000_000;
  const clock = new ChainClock(
    unusedNode,
    () => wallMs,
    () => wallMs
  );

  clock.sync(1_000);
  assert.equal(clock.now(), 1_000_000);
  assert.equal(clock.displayNow(), 1_000_000);

  wallMs += 10_000;
  assert.equal(clock.now(), 1_000_000);
  assert.equal(clock.nowSec(), 1_000);
  assert.equal(clock.displayNow(), 1_010_000);
});

test("slews toward a corrected block timestamp without jumping backwards", () => {
  let wallMs = 1_000_000;
  const clock = new ChainClock(
    unusedNode,
    () => wallMs,
    () => wallMs
  );

  clock.sync(1_000);
  wallMs += 10_000;
  const beforeCorrection = clock.displayNow();

  clock.sync(1_008);
  assert.equal(clock.now(), 1_008_000);
  assert.equal(clock.displayNow(), beforeCorrection);

  wallMs += 10_000;
  assert.equal(clock.displayNow(), 1_019_000);

  wallMs += 10_000;
  assert.equal(clock.displayNow(), 1_028_000);
});

test("limits correction after a large timestamp rollback", () => {
  let wallMs = 1_000_000;
  const clock = new ChainClock(
    unusedNode,
    () => wallMs,
    () => wallMs
  );

  clock.sync(1_000);
  wallMs += 5_000;
  const beforeRollback = clock.displayNow();

  clock.sync(900);
  assert.equal(clock.displayNow(), beforeRollback);

  wallMs += 1_000;
  assert.equal(clock.displayNow(), beforeRollback + 900);
  assert.ok(clock.displayNow() >= beforeRollback);
});

test("uses monotonic elapsed time when the system clock jumps", () => {
  let wallMs = 1_000_000;
  let monotonicMs = 0;
  const clock = new ChainClock(
    unusedNode,
    () => wallMs,
    () => monotonicMs
  );

  clock.sync(1_000);
  wallMs += 3_600_000;
  monotonicMs += 1_000;

  assert.equal(clock.now(), 1_000_000);
  assert.equal(clock.displayNow(), 1_001_000);
});
