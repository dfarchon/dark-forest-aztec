import assert from "node:assert/strict";
import test from "node:test";
import { GUIDE_CHAPTERS } from "../src/Frontend/Panes/BoothGuide/guideChapters";
import {
  GuideAssistGate,
  needsGuideMouse,
} from "../src/Frontend/Panes/BoothGuide/guideAssist";
import { terminalGuide } from "../src/Frontend/Panes/BoothGuide/guideTerminal";
import {
  APPROACH_MS,
  sampleGuidePointer,
} from "../src/Frontend/Panes/BoothGuide/guidePointerMotion";

test("a completed demonstration can execute its action only once", () => {
  const gate = new GuideAssistGate(),
    id = gate.begin(1);
  assert.equal(gate.isCurrent(id), true);
  assert.equal(gate.complete(id, 1), true);
  assert.equal(gate.complete(id, 1), false);
  assert.equal(gate.isCurrent(id), false);
});

test("navigation, cancellation and a replacement request reject stale callbacks", () => {
  const gate = new GuideAssistGate(),
    first = gate.begin(1);
  assert.equal(gate.complete(first, 2), false);
  gate.cancel();
  assert.equal(gate.complete(first, 1), false);
  const second = gate.begin(2),
    third = gate.begin(2);
  assert.equal(gate.complete(second, 2), false);
  assert.equal(gate.complete(third, 2), true);
});

test("all mouse exercises animate assistance while zoom and reading keep their own flow", () => {
  for (const chapter of GUIDE_CHAPTERS)
    for (const step of chapter.steps)
      assert.equal(
        needsGuideMouse(step),
        !["zoom", "zoomIn", "readScoring", "accountSafety"].includes(step)
      );
});

test("terminal instructions and gestures match Edge and Bar settings", () => {
  const edge = terminalGuide(undefined),
    bar = terminalGuide("bar");
  assert.equal(edge.target, "terminal-edge");
  assert.equal(edge.gesture, "hover");
  assert.match(edge.hint, /far-right edge/);
  assert.equal(bar.target, "terminal-toggle");
  assert.equal(bar.gesture, "click");
  assert.match(bar.hint, /Click the terminal icon/);
});

test("a hover demonstration approaches and waits without pretending to click", () => {
  const pose = { kind: "hover", at: { x: 900, y: 300 } } as const;
  for (const elapsed of [0, APPROACH_MS / 2, APPROACH_MS, APPROACH_MS + 400]) {
    const frame = sampleGuidePointer(pose, { x: 100, y: 100 }, elapsed);
    assert.equal(frame.pressed, false);
    assert.notEqual(frame.gesture, "click");
    assert.equal(frame.complete, false);
  }
  const done = sampleGuidePointer(pose, { x: 100, y: 100 }, APPROACH_MS + 1100);
  assert.equal(done.complete, true);
  assert.equal(done.gesture, "hover");
  assert.deepEqual(done.at, pose.at);
});
