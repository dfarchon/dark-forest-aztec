import assert from "node:assert/strict";
import test from "node:test";
import { ceilMoveDistance } from "../src/Backend/Utils/Coordinates.ts";

test("distance matches integer ceiling at ordinary and full-width coordinates", () => {
  const origin = { x: 0, y: 0 };
  assert.equal(ceilMoveDistance(origin, { x: 3, y: 4 }), 5);
  assert.equal(ceilMoveDistance(origin, { x: -1, y: 1 }), 2);
  assert.equal(
    ceilMoveDistance({ x: -2147483648, y: 0 }, { x: 2147483647, y: 1 }),
    4294967296
  );
});
