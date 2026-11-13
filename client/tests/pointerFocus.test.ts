import assert from "node:assert/strict";
import test from "node:test";

import { CursorState } from "@dfpunk/types";

import {
  mapPointerAction,
  pointerTarget,
  registerPointerOverlay,
} from "../src/Frontend/Utils/PointerFocus.ts";

function sample(x: number, y: number, deltaY = 0) {
  return {
    clientX: x,
    clientY: y,
    deltaY,
    composedPath: () => [] as EventTarget[],
  };
}

test("placing the miner is the only map action that is not a normal map press", () => {
  assert.equal(mapPointerAction(CursorState.TargetingExplorer), "place-miner");
  assert.equal(mapPointerAction(CursorState.Normal), "map");
  assert.equal(mapPointerAction(CursorState.TargetingForces), "map");
});

test("a registered overlay claims the pointer even when nothing is hit underneath", () => {
  const unregister = registerPointerOverlay(() => ({
    left: 10,
    right: 40,
    top: 5,
    bottom: 25,
  }));
  try {
    assert.equal(pointerTarget(sample(20, 10)).kind, "terminal");
    assert.equal(pointerTarget(sample(0, 0)).kind, "map");
  } finally {
    unregister();
  }
  assert.equal(pointerTarget(sample(20, 10)).kind, "map");
});
