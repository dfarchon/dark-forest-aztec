import assert from "node:assert/strict";
import test from "node:test";

import {
  GuidePointerSequence,
  guidePoseEndpoint,
} from "../src/Frontend/Panes/BoothGuide/guidePointerSequence";

const row = { x: 100, y: 80 },
  firstTarget = { x: 600, y: 350 };

test("the first lesson starts at its row and the next inherits the previous endpoint", () => {
  const sequence = new GuidePointerSequence();
  assert.deepEqual(sequence.origin("planet:select", row, 1200, 800), row);
  sequence.remember(firstTarget);
  assert.deepEqual(sequence.origin("move:energy", row, 1200, 800), firstTarget);
});

test("repeated cycles and a cursor remount keep the same step's original start", () => {
  const sequence = new GuidePointerSequence();
  sequence.origin("select", row, 1200, 800);
  sequence.remember(firstTarget);
  assert.deepEqual(
    sequence.origin("select", { x: 200, y: 120 }, 1200, 800),
    row
  );
  sequence.origin("energy", row, 1200, 800);
  sequence.remember({ x: 900, y: 400 });
  assert.deepEqual(sequence.origin("energy", row, 1200, 800), firstTarget);
});

test("reset and manual navigation discard the inherited origin", () => {
  const sequence = new GuidePointerSequence();
  sequence.origin("select", row, 1200, 800);
  sequence.remember(firstTarget);
  sequence.reset();
  assert.deepEqual(sequence.origin("fog:target", row, 1200, 800), row);
});

test("off-screen endpoints and window resizes fall back to the current lesson", () => {
  const sequence = new GuidePointerSequence();
  sequence.remember({ x: 1400, y: 400 });
  assert.deepEqual(sequence.origin("first", row, 1200, 800), row);
  sequence.remember(firstTarget);
  assert.deepEqual(sequence.origin("next", row, 1200, 800), firstTarget);
  assert.deepEqual(sequence.origin("next", row, 400, 300), row);
  sequence.reset();
  assert.equal(sequence.origin("unavailable", null, 400, 300), null);
});

test("drag endpoints use the release position and invalid poses do not corrupt history", () => {
  assert.deepEqual(
    guidePoseEndpoint({
      kind: "drag",
      from: row,
      to: firstTarget,
      thenScroll: "up",
    }),
    firstTarget
  );
  assert.equal(guidePoseEndpoint({ kind: "hide" }), null);
  assert.equal(
    guidePoseEndpoint({ kind: "click", at: { x: NaN, y: 2 } }),
    null
  );
  const sequence = new GuidePointerSequence();
  const mutable = { ...firstTarget };
  sequence.remember(mutable);
  mutable.x = 0;
  const origin = sequence.origin("next", row, 1200, 800)!;
  origin.x = 2;
  assert.deepEqual(sequence.origin("next", row, 1200, 800), firstTarget);
});
