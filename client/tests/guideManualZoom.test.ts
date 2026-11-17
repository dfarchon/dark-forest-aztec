import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  applyGuideManualZoom,
  guideZoomInCenter,
  guideZoomOutCenter,
} from "../src/Frontend/Panes/BoothGuide/guideManualZoom";

function viewport(width: number) {
  return {
    widthInWorldUnits: width,
    minWorldWidth: 2,
    maxWorldWidth: 212000,
    mouseSensitivity: 1.001,
    momentum: true,
    velocity: { x: 20, y: -15 } as { x: number; y: number } | undefined,
    center: { x: 41022, y: -26136 },
    setData(data: {
      widthInWorldUnits: number;
      centerWorldCoords: { x: number; y: number };
    }) {
      this.widthInWorldUnits = data.widthInWorldUnits;
      this.center = { ...data.centerWorldCoords };
    },
  };
}

test("zooming out past the limit reaches the exact boundary and centers the universe", () => {
  const view = viewport(205000);
  applyGuideManualZoom(view, view.widthInWorldUnits, 100, { x: 0, y: 0 });
  assert.equal(view.widthInWorldUnits, view.maxWorldWidth);
  assert.deepEqual(view.center, { x: 0, y: 0 });
  assert.equal(view.momentum, false);
  assert.equal(view.velocity, undefined);
});

test("the guide uses the pre-scroll scale, without doubling the normal viewport zoom", () => {
  const view = viewport(10000),
    events = new EventEmitter();
  events.on("wheel", (delta: number) => {
    view.widthInWorldUnits *= view.mouseSensitivity ** delta;
    view.center = { x: 40000, y: -20000 }; // Normal cursor-centered zoom.
  });
  let before = view.widthInWorldUnits;
  events.prependListener("wheel", () => {
    before = view.widthInWorldUnits;
  });
  events.on("wheel", (delta: number) =>
    applyGuideManualZoom(view, before, delta, { x: 0, y: 0 })
  );
  events.emit("wheel", 100);
  assert.equal(view.widthInWorldUnits, 10000 * view.mouseSensitivity ** 100);
  assert.deepEqual(view.center, { x: 0, y: 0 });
});

test("zoom-in preserves its planet anchor and clamps at the minimum scale", () => {
  const view = viewport(4),
    planet = { x: 41022, y: -26136 };
  applyGuideManualZoom(view, 4, -10000, planet);
  assert.equal(view.widthInWorldUnits, view.minWorldWidth);
  assert.deepEqual(view.center, planet);
  planet.x = 0;
  assert.equal(view.center.x, 41022);
});

test("early zoom-out stays near its arbitrary starting position instead of snapping to zero", () => {
  const start = { width: 100, center: { x: 41022, y: -26136 } };
  assert.deepEqual(guideZoomOutCenter(start, 100, 212000), start.center);
  const next = guideZoomOutCenter(start, 110, 212000);
  assert.ok(next.x > 41021.99 && next.x < start.center.x);
  assert.ok(next.y < -26135.99 && next.y > start.center.y);
});

test("zoom-out interpolates continuously and reaches the exact universe center at the limit", () => {
  const start = { width: 1000, center: { x: 40000, y: -20000 } };
  assert.deepEqual(guideZoomOutCenter(start, 106500, 212000), {
    x: 20000,
    y: -10000,
  });
  let previous = Infinity;
  for (const width of [1000, 2000, 10000, 100000, 200000, 212000]) {
    const center = guideZoomOutCenter(start, width, 212000);
    const distance = Math.hypot(center.x, center.y);
    assert.ok(distance <= previous);
    previous = distance;
  }
  assert.deepEqual(guideZoomOutCenter(start, 212000, 212000), { x: 0, y: 0 });
  const view = viewport(200000);
  applyGuideManualZoom(view, 200000, 1000, (width) =>
    guideZoomOutCenter(start, width, view.maxWorldWidth)
  );
  assert.equal(view.widthInWorldUnits, view.maxWorldWidth);
  assert.deepEqual(view.center, { x: 0, y: 0 });
});

test("a new starting position after a pan continues without jumping and still ends at zero", () => {
  const moved = { width: 100000, center: { x: -30000, y: 5000 } };
  assert.deepEqual(
    guideZoomOutCenter(moved, moved.width, 212000),
    moved.center
  );
  assert.deepEqual(guideZoomOutCenter(moved, 212000, 212000), { x: 0, y: 0 });
});

test("zoom-in starts at the current view and eases toward the target planet", () => {
  const start = { width: 212000, center: { x: 0, y: 0 } };
  const target = { x: 40000, y: -20000 };
  assert.deepEqual(
    guideZoomInCenter(start, 212000, 1000, target),
    start.center
  );
  const early = guideZoomInCenter(start, 211990, 1000, target);
  assert.ok(early.x > 0 && early.x < 0.01);
  assert.deepEqual(guideZoomInCenter(start, 106500, 1000, target), {
    x: 20000,
    y: -10000,
  });
  assert.deepEqual(guideZoomInCenter(start, 1000, 1000, target), target);
});

test("zoom-in reaches exactly the planet when scrolling beyond its intended view", () => {
  const view = viewport(212000),
    target = { x: 41022, y: -26136 };
  const start = { width: view.widthInWorldUnits, center: { x: 0, y: 0 } };
  applyGuideManualZoom(view, start.width, -100000, (width) =>
    guideZoomInCenter(start, width, 1000, target)
  );
  assert.equal(view.widthInWorldUnits, view.minWorldWidth);
  assert.deepEqual(view.center, target);
});

test("after a pan, zoom-in can start from the new position without a discontinuity", () => {
  const moved = { width: 50000, center: { x: -12000, y: 18000 } };
  const target = { x: 41022, y: -26136 };
  assert.deepEqual(
    guideZoomInCenter(moved, moved.width, 1000, target),
    moved.center
  );
  assert.deepEqual(guideZoomInCenter(moved, 1000, 1000, target), target);
});
