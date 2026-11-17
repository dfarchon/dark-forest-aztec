import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROACH_MS,
  DRAG_MS,
  guideCurve,
  sampleGuidePointer,
} from "../src/Frontend/Panes/BoothGuide/guidePointerMotion";

const origin = { x: 100, y: 70 },
  target = { x: 800, y: 400 };

test("the cursor leaves the lesson row and reaches the target before pressing", () => {
  const pose = { kind: "click", at: target } as const;
  assert.deepEqual(sampleGuidePointer(pose, origin, 0).at, origin);
  const travel = sampleGuidePointer(pose, origin, APPROACH_MS / 2);
  assert.ok(travel.at!.x > origin.x && travel.at!.x < target.x);
  assert.equal(travel.gesture, "travel");
  assert.equal(travel.pressed, false);
  assert.deepEqual(sampleGuidePointer(pose, origin, APPROACH_MS).at, target);
  assert.equal(
    sampleGuidePointer(pose, origin, APPROACH_MS + 400).pressed,
    true
  );
  assert.equal(
    sampleGuidePointer(pose, origin, APPROACH_MS + 750).pressed,
    false
  );
});

test("slider motion approaches the handle, presses, drags, then releases", () => {
  const from = { x: 600, y: 240 },
    to = { x: 900, y: 240 };
  const pose = { kind: "drag", from, to } as const;
  assert.deepEqual(sampleGuidePointer(pose, origin, APPROACH_MS).at, from);
  const mid = sampleGuidePointer(pose, origin, APPROACH_MS + DRAG_MS / 2);
  assert.equal(mid.pressed, true);
  assert.ok(mid.at!.x > from.x && mid.at!.x < to.x);
  assert.equal(mid.at!.y, from.y);
  const end = sampleGuidePointer(pose, origin, APPROACH_MS + DRAG_MS - 1);
  assert.deepEqual(end.at, to);
  assert.equal(end.pressed, false);
  assert.equal(end.dragProgress, 1);
});

test("map drag followed by scroll keeps the original gesture sequence", () => {
  const frame = sampleGuidePointer(
    { kind: "drag", from: origin, to: target, thenScroll: "up" },
    origin,
    APPROACH_MS + DRAG_MS + 100
  );
  assert.deepEqual(frame.at, target);
  assert.equal(frame.gesture, "scroll");
  assert.equal(frame.direction, "up");
  assert.equal(frame.pressed, false);
});

test("motion fades before a new cycle and restarts from the lesson row", () => {
  const pose = { kind: "click", at: target } as const;
  assert.equal(
    sampleGuidePointer(pose, origin, APPROACH_MS + 1100 + 350).opacity,
    0
  );
  const restart = sampleGuidePointer(
    pose,
    origin,
    APPROACH_MS + 1100 + 300 + 450
  );
  assert.equal(restart.cycle, 1);
  assert.deepEqual(restart.at, origin);
  assert.equal(restart.complete, false);
});

test("curves stay bounded, missing targets hide, and reduced motion does not sweep", () => {
  for (let i = 0; i <= 100; i++) {
    const p = guideCurve(target, origin, i / 100);
    assert.ok(p.x >= origin.x && p.x <= target.x);
    assert.ok(p.y >= origin.y && p.y <= target.y);
  }
  assert.equal(sampleGuidePointer({ kind: "hide" }, origin, 0).at, null);
  assert.equal(
    sampleGuidePointer({ kind: "click", at: target }, null, 0).at,
    null
  );
  assert.equal(
    sampleGuidePointer({ kind: "click", at: { x: NaN, y: 1 } }, origin, 0).at,
    null
  );
  const reduced = sampleGuidePointer(
    { kind: "click", at: target },
    origin,
    100,
    true
  );
  assert.deepEqual(reduced.at, target);
  assert.equal(reduced.pressed, false);
});
