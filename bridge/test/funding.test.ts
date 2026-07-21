import assert from "node:assert/strict";
import test from "node:test";

import { calculateMinimumEth, parseAmount } from "../src/funding.js";

test("parses decimal $AZTEC amounts without floating-point loss", () => {
  assert.equal(parseAmount("1.25"), 1_250_000_000_000_000_000n);
  assert.equal(parseAmount("10", 6), 10_000_000n);
});

test("rejects zero and malformed bridge amounts", () => {
  assert.throws(() => parseAmount("0"));
  assert.throws(() => parseAmount("-1"));
  assert.throws(() => parseAmount("1e3"));
});

test("applies the configured ETH gas buffer", () => {
  assert.equal(calculateMinimumEth(10n, 30n, 2n, 25n), 100n);
  assert.equal(calculateMinimumEth(0n, 30n, 2n, 0n), 60n);
});
