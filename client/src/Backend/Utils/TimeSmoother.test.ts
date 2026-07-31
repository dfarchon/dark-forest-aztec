import assert from "node:assert/strict";
import test from "node:test";

import { TimeSmoother, TimeSmootherOptions } from "./TimeSmoother.ts";

/** Test harness: a manually-advanced monotonic clock. */
function makeSmoother(options?: Omit<TimeSmootherOptions, "monotonicNow">) {
  let mono = 1_000_000;
  const smoother = new TimeSmoother({
    monotonicNow: () => mono,
    ...options,
  });
  return {
    smoother,
    advance(ms: number) {
      mono += ms;
    },
  };
}

const T0 = 1_700_000_000_000; // arbitrary chain-time origin (ms)

test("returns 0 until the first observation", () => {
  const { smoother, advance } = makeSmoother();
  assert.equal(smoother.now(), 0);
  advance(5_000);
  assert.equal(smoother.now(), 0);
});

test("tracks wall rate at steady state, independent of call frequency", () => {
  const run = (stepMs: number) => {
    const { smoother, advance } = makeSmoother();
    smoother.observe(T0);
    smoother.now();
    for (let elapsed = 0; elapsed < 4_000; elapsed += stepMs) {
      advance(stepMs);
      smoother.now();
    }
    return smoother.now();
  };
  const fine = run(10);
  const coarse = run(500);
  assert.ok(Math.abs(fine - coarse) < 1, `fine=${fine} coarse=${coarse}`);
  assert.ok(Math.abs(fine - (T0 + 4_000)) < 1);
});

test("late deliveries never slow the display (envelope keeps phase)", () => {
  const { smoother, advance } = makeSmoother();
  smoother.observe(T0);
  smoother.now();
  let prev = smoother.now();
  // Blocks stamped every 72s but delivered with wildly varying lateness
  // (the observed mainnet pattern). Chain ts advances like a metronome.
  const deliveries = [
    { afterMs: 80_000, ts: T0 + 72_000 },
    { afterMs: 34_000, ts: T0 + 144_000 },
    { afterMs: 120_000, ts: T0 + 216_000 },
    { afterMs: 20_000, ts: T0 + 288_000 },
  ];
  for (const d of deliveries) {
    for (let t = 0; t < d.afterMs; t += 100) {
      advance(100);
      const value = smoother.now();
      const rate = (value - prev) / 100;
      assert.ok(rate >= 0.999, `display stalled (rate=${rate})`);
      assert.ok(rate <= 1.5001, `rate ${rate} exceeds 1.5x wall`);
      prev = value;
    }
    smoother.observe(d.ts);
  }
});

test("an early/prompt delivery raises phase, absorbed at bounded rate", () => {
  const { smoother, advance } = makeSmoother({ tauMs: 10_000 });
  smoother.observe(T0);
  smoother.now();
  let prev = smoother.now();
  // A much fresher offset arrives (previous observation was very late).
  smoother.observe(T0 + 40_000);
  let sawCatchUp = false;
  for (let i = 0; i < 600; i++) {
    advance(100);
    const value = smoother.now();
    const rate = (value - prev) / 100;
    assert.ok(rate <= 1.5001, `rate ${rate} exceeds cap`);
    assert.ok(value >= prev, "monotonicity");
    if (rate > 1.05) sawCatchUp = true;
    prev = value;
  }
  assert.ok(sawCatchUp, "phase raise should produce visible catch-up");
});

test("bad-RPC far-future observation is clamped per observation", () => {
  const tol = 120_000;
  const { smoother, advance } = makeSmoother({ futureToleranceMs: tol });
  smoother.observe(T0);
  smoother.now();
  advance(1_000);
  smoother.observe(T0 + 3_600_000); // one hour ahead
  advance(600_000);
  const value = smoother.now();
  // Envelope moved at most tol; display ≤ origin + elapsed + tol.
  assert.ok(
    value <= T0 + 1_000 + 600_000 + tol + 1,
    `display +${value - T0}ms exceeds bounded acceptance`
  );
});

test("freezes at the extrapolation cap and reports stale", () => {
  const cap = 300_000;
  const { smoother, advance } = makeSmoother({
    maxExtrapolationMs: cap,
    hiddenGapMs: 1_000_000,
  });
  smoother.observe(T0);
  smoother.now();
  assert.equal(smoother.isStale(), false);
  let prev = 0;
  for (let elapsed = 0; elapsed < 400_000; elapsed += 500) {
    advance(500);
    prev = smoother.now();
  }
  assert.ok(prev <= T0 + cap + 1, `display drifted past cap (+${prev - T0})`);
  assert.equal(smoother.isStale(), true);
  // A new observation revives freshness.
  smoother.observe(T0 + 400_000);
  assert.equal(smoother.isStale(), false);
});

test("recovers from staleness via snap beyond the threshold", () => {
  const { smoother, advance } = makeSmoother({
    maxExtrapolationMs: 60_000,
    snapThresholdMs: 90_000,
    hiddenGapMs: 1_000_000,
  });
  smoother.observe(T0);
  smoother.now();
  for (let elapsed = 0; elapsed < 400_000; elapsed += 1_000) {
    advance(1_000);
    smoother.now();
  }
  // Outage ends: fresh observation far ahead of the frozen display.
  smoother.observe(T0 + 400_000);
  advance(100);
  const value = smoother.now();
  assert.ok(
    value >= T0 + 400_000,
    "recovery snap should take the fresh target in one step"
  );
});

test("hidden-gap fallback jumps to target without visible glide", () => {
  const { smoother, advance } = makeSmoother({ hiddenGapMs: 30_000 });
  smoother.observe(T0);
  smoother.now();
  advance(120_000); // suspended frames; no now() calls meanwhile
  smoother.observe(T0 + 120_000);
  const value = smoother.now();
  assert.ok(
    Math.abs(value - (T0 + 120_000)) < 1,
    "post-gap value must land on target immediately"
  );
});

test("markDiscontinuity jumps monotonically and respects the cap", () => {
  const cap = 300_000;
  const { smoother, advance } = makeSmoother({ maxExtrapolationMs: cap });
  smoother.observe(T0);
  smoother.now();
  advance(600_000);
  smoother.markDiscontinuity();
  const value = smoother.now();
  assert.ok(
    value <= T0 + cap + 1,
    `discontinuity must not bypass the cap (got +${value - T0}ms)`
  );
  smoother.markDiscontinuity();
  assert.ok(smoother.now() >= value, "discontinuity must never regress");
});

test("output is monotonic under adversarial observation sequences", () => {
  const { smoother, advance } = makeSmoother();
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  smoother.observe(T0);
  let prev = smoother.now();
  let chain = T0;
  for (let i = 0; i < 2_000; i++) {
    advance(Math.floor(rand() * 200) + 1);
    if (rand() < 0.05) {
      chain += Math.floor(rand() * 80_000) - 20_000; // incl. backwards
      smoother.observe(chain);
    }
    if (rand() < 0.01) smoother.markDiscontinuity();
    const value = smoother.now();
    assert.ok(
      value >= prev,
      `monotonicity violated at i=${i}: ${value} < ${prev}`
    );
    prev = value;
  }
});
