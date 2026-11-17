import assert from "node:assert/strict";
import test from "node:test";

import {
  placeGuidePanel,
  type GuideObstacle,
} from "../src/Frontend/Panes/BoothGuide/guidePanelPlacement";

const size = { width: 320, height: 460 };
const view = { width: 1440, height: 900 };
function clear(
  point: { x: number; y: number; height: number },
  boxes: GuideObstacle[]
) {
  for (const box of boxes)
    assert.ok(
      point.x + size.width <= box.x ||
        point.x >= box.x + box.width ||
        point.y + point.height <= box.y ||
        point.y >= box.y + box.height
    );
  assert.ok(
    point.x >= 0 &&
      point.y >= 0 &&
      point.x + size.width <= view.width &&
      point.y + point.height <= view.height
  );
}

test("a manually chosen clear position stays put", () => {
  assert.deepEqual(placeGuidePanel(view, size, { x: 300, y: 100 }, []), {
    x: 300,
    y: 100,
    height: 460,
  });
});

test("opening avoids top-left status, Help, and the explorer dock", () => {
  const boxes = [
    { x: 8, y: 8, width: 190, height: 220 },
    { x: 550, y: 100, width: 520, height: 560 },
    { x: 8, y: 820, width: 800, height: 60 },
  ];
  const result = placeGuidePanel(view, size, { x: 56, y: 52 }, boxes);
  clear(result, boxes);
  assert.equal(result.height, size.height);
});

test("a newly opened window relocates the guide without moving that window", () => {
  const boxes = [{ x: 290, y: 90, width: 500, height: 600 }];
  const before = structuredClone(boxes);
  clear(placeGuidePanel(view, size, { x: 300, y: 100 }, boxes), boxes);
  assert.deepEqual(boxes, before);
});

test("a shorter free region reduces guide height instead of covering another window", () => {
  const small = { width: 720, height: 480 };
  const box = { x: 0, y: 300, width: 720, height: 180 };
  const result = placeGuidePanel(small, size, { x: 56, y: 52 }, [box]);
  assert.ok(result.height >= 160 && result.height < size.height);
  assert.ok(result.y + result.height <= box.y - 12);
  assert.ok(result.x + size.width <= small.width && result.y >= 0);
});

test("repeated checks remain stable after finding an empty position", () => {
  const boxes = [{ x: 8, y: 8, width: 190, height: 220 }];
  const first = placeGuidePanel(view, size, { x: 56, y: 52 }, boxes);
  for (let i = 0; i < 10; i++)
    assert.deepEqual(placeGuidePanel(view, size, first, boxes), first);
});

test("resizing keeps the guide within the available viewport", () => {
  const smaller = { width: 800, height: 600 };
  const result = placeGuidePanel(smaller, size, { x: 1100, y: 700 }, []);
  assert.ok(result.x >= 12 && result.y >= 12);
  assert.ok(result.x + size.width <= smaller.width - 12);
  assert.ok(result.y + result.height <= smaller.height - 12);
});
