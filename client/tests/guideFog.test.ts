import assert from "node:assert/strict";
import test from "node:test";
import type { Rectangle } from "@dfpunk/types";
import type GameUIManager from "../src/Backend/GameLogic/GameUIManager";
import {
  confirmGuideFogMove,
  fogChunk,
  guideMinerAnchor,
  GuideFogTarget,
  isGuideFogDestination,
  isGuideFogTarget,
  pickGuideFogTarget,
} from "../src/Frontend/Panes/BoothGuide/guideFog";

const view = { center: { x: 0, y: 0 }, width: 1000, height: 800 };

test("the preferred target is farther into the fog while staying comfortably on screen", () => {
  const target = pickGuideFogTarget({ x: 0, y: 0 }, view, () => true)!;
  assert.ok(target.x >= 340 && target.y >= 170);
  assert.ok(target.x <= 420 && target.y <= 336);
});

test("a miss near the preferred patch searches the rest of the screen without falling back home", () => {
  const target = pickGuideFogTarget({ x: 0, y: 0 }, view, (p) => p.x < -200)!;
  assert.ok(
    target && target.x < -200 && target.x >= -420 && Math.abs(target.y) <= 336
  );
  assert.equal(
    pickGuideFogTarget({ x: 90000, y: 90000 }, view, () => false),
    undefined
  );
});

test("explorer movement and repeated animation cycles do not move a pinned target", () => {
  const target = new GuideFogTarget();
  let calls = 0;
  const choose = () => ({ x: ++calls * 100, y: 40 });
  for (let now = 0; now < 5000; now += 100)
    assert.deepEqual(
      target.resolve(now, choose, () => true),
      { x: 100, y: 40 }
    );
  assert.equal(calls, 1);
  const copy = target.resolve(5100, choose, () => true)!;
  copy.x = -1;
  assert.equal(target.resolve(5200, choose, () => true)!.x, 100);
  target.reset();
  assert.equal(target.resolve(5300, choose, () => true)!.x, 200);
});

test("a newly explored target is replaced, and a temporary search miss can be retried", () => {
  const target = new GuideFogTarget();
  assert.equal(
    target.resolve(
      0,
      () => undefined,
      () => true
    ),
    undefined
  );
  assert.deepEqual(
    target.resolve(
      400,
      () => ({ x: 100, y: 40 }),
      () => true
    ),
    { x: 100, y: 40 }
  );
  assert.deepEqual(
    target.resolve(
      800,
      () => ({ x: 200, y: 40 }),
      (p) => p.x !== 100
    ),
    { x: 200, y: 40 }
  );
});

function fixture() {
  let mined = false,
    mining = false,
    starts = 0;
  let pattern = { fromChunk: fogChunk({ x: 32, y: 48 }) };
  let explored: Rectangle[] = [];
  const ui = {
    getWorldRadius: () => 1000,
    getGameManager: () => ({
      hasMinedChunk: () => mined,
      getCurrentlyExploringChunk: () => undefined,
      getExploredChunks: () =>
        explored.map((chunkFootprint) => ({ chunkFootprint })),
    }),
    getMiningPattern: () => pattern,
    getMinerLocation: () => undefined,
    getHomeCoords: () => ({ x: 900, y: 0 }),
    isMining: () => mining,
    startExplore: () => {
      starts++;
      mining = true;
    },
  } as unknown as GameUIManager;
  return {
    ui,
    get starts() {
      return starts;
    },
    setMined: () => {
      mined = true;
    },
    setExplored: (chunks: Rectangle[]) => {
      explored = chunks;
    },
    apply: (coords: { x: number; y: number }) => {
      pattern = { fromChunk: fogChunk(coords) };
    },
  };
}

test("the explorer's pattern is the anchor before falling back to home", () => {
  const f = fixture();
  assert.deepEqual(guideMinerAnchor(f.ui), { x: 40, y: 56 });
});

test("guidance leaves clearance from explored chunks even when the exact target is still dark", () => {
  const f = fixture();
  f.setExplored([fogChunk({ x: 320, y: 144 })]);
  const nearFrontier = { x: 360, y: 184 };
  assert.equal(isGuideFogDestination(f.ui, nearFrontier), true);
  assert.equal(isGuideFogTarget(f.ui, nearFrontier, view), false);
  const target = pickGuideFogTarget({ x: 0, y: 0 }, view, (point) =>
    isGuideFogTarget(f.ui, point, view)
  );
  assert.ok(target);
  assert.notDeepEqual(target, nearFrontier);
  assert.equal(isGuideFogTarget(f.ui, target, view), true);
  assert.equal(isGuideFogTarget(f.ui, { x: 400, y: 240 }, view), true);
  // A newly mined neighbouring chunk invalidates the cached hint before its centre is mined.
  f.setExplored([fogChunk({ x: 384, y: 240 })]);
  assert.equal(isGuideFogTarget(f.ui, { x: 400, y: 240 }, view), false);
});

test("the guidance margin also stays inside the world boundary", () => {
  const f = fixture();
  assert.equal(isGuideFogDestination(f.ui, { x: 980, y: 0 }), true);
  assert.equal(isGuideFogTarget(f.ui, { x: 980, y: 0 }, view), false);
  assert.equal(isGuideFogTarget(f.ui, { x: 940, y: 0 }, view), true);
});

test("mapped, out-of-world and unchanged targets cannot complete the fog exercise", () => {
  const f = fixture();
  assert.equal(
    isGuideFogDestination(f.ui, { x: 64, y: 64 }, { x: 32, y: 48 }),
    true
  );
  assert.equal(
    isGuideFogDestination(f.ui, { x: 35, y: 50 }, { x: 32, y: 48 }),
    false
  );
  assert.equal(isGuideFogDestination(f.ui, { x: 1000, y: 0 }), false);
  assert.equal(isGuideFogDestination(f.ui, { x: NaN, y: 0 }), false);
  f.setMined();
  assert.equal(isGuideFogDestination(f.ui, { x: 64, y: 64 }), false);
});

test("completion requires the applied explorer target and resumes a paused explorer", () => {
  const f = fixture(),
    target = { x: 64, y: 64 };
  assert.equal(confirmGuideFogMove(f.ui, target), false);
  assert.equal(f.starts, 0);
  f.apply(target);
  assert.equal(confirmGuideFogMove(f.ui, target), true);
  assert.equal(f.starts, 1);
  assert.equal(confirmGuideFogMove(f.ui, target), true);
  assert.equal(f.starts, 1);
});
