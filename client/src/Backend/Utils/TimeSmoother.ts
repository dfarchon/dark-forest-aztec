/**
 * TimeSmoother: converts a stepwise sequence of authoritative timestamps
 * (L2 block timestamps, arriving ~once per block with unpredictable
 * delivery latency) into a continuously advancing display time.
 *
 * Model: an OFFSET HIGH-WATER ENVELOPE. Each observation samples
 * `offset = chainTimestampMs − monotonicMs`. Because chain timestamps
 * are regular while delivery is not, a LATE delivery produces a lower
 * offset sample — which must not slow the display. The envelope keeps
 * the highest offset seen (raised at most `futureToleranceMs` per
 * observation, bounding bad-RPC influence) and the display target is
 * `envelope + monotonicNow`, capped `maxExtrapolationMs` past the last
 * observation. Late deliveries refresh liveness but never lower phase.
 *
 * Consequences: while observations are fresh the display advances at
 * [1, maxRate]x wall rate and NEVER stalls or reverses; when starved it
 * freezes at the cap and reports `isStale()` so UIs can say "syncing"
 * instead of showing a stuck countdown.
 *
 * DISPLAY ONLY — never use for transaction timestamps (contracts assert
 * freshness against the sequencer's real block time).
 *
 * Usage:
 *   const smoother = new TimeSmoother();
 *   smoother.observe(blockTimestampMs); // on each chain sync
 *   const displayMs = smoother.now();   // every animation frame
 */

export interface TimeSmootherOptions {
  /** Monotonic wall clock in ms; defaults to performance.now. */
  monotonicNow?: () => number;
  /** Error-decay time constant in ms; larger = gentler catch-up. */
  tauMs?: number;
  /** Forward error beyond this snaps in one step (staleness recovery). */
  snapThresholdMs?: number;
  /** Freeze extrapolation this long after the last observation. */
  maxExtrapolationMs?: number;
  /** Call gap treated as "frames were suspended" (fallback discontinuity). */
  hiddenGapMs?: number;
  /** Max upward envelope movement per observation (bad-RPC bound). */
  futureToleranceMs?: number;
  /** Rate ceiling as a multiple of wall rate (display never exceeds it). */
  maxRate?: number;
}

const DEFAULT_TAU_MS = 30_000;
const DEFAULT_SNAP_THRESHOLD_MS = 150_000;
const DEFAULT_MAX_EXTRAPOLATION_MS = 300_000;
// Fallback only (system sleep / rAF stalls without a visibility event):
// the primary discontinuity signal is markDiscontinuity(). A jump lands
// on the envelope target, which is monotone and never stale-low.
const DEFAULT_HIDDEN_GAP_MS = 30_000;
const DEFAULT_FUTURE_TOLERANCE_MS = 120_000;
const DEFAULT_MAX_RATE = 1.5;

export class TimeSmoother {
  private readonly monotonicNow: () => number;
  private readonly tauMs: number;
  private readonly snapThresholdMs: number;
  private readonly maxExtrapolationMs: number;
  private readonly hiddenGapMs: number;
  private readonly futureToleranceMs: number;
  private readonly maxRate: number;

  /** Highest accepted (chainMs − monoMs) offset; NaN = never observed. */
  private offsetHighWaterMs = Number.NaN;

  /** Monotonic time of the freshest observation (liveness, not phase). */
  private lastObservationMono = 0;

  /** Last returned display value; undefined until the first now() call. */
  private display: number | undefined;

  /** Monotonic time at the last now() call. */
  private lastCallMono = 0;

  constructor(options?: TimeSmootherOptions) {
    this.monotonicNow = options?.monotonicNow ?? (() => performance.now());
    this.tauMs = options?.tauMs ?? DEFAULT_TAU_MS;
    this.snapThresholdMs =
      options?.snapThresholdMs ?? DEFAULT_SNAP_THRESHOLD_MS;
    this.maxExtrapolationMs =
      options?.maxExtrapolationMs ?? DEFAULT_MAX_EXTRAPOLATION_MS;
    this.hiddenGapMs = options?.hiddenGapMs ?? DEFAULT_HIDDEN_GAP_MS;
    this.futureToleranceMs =
      options?.futureToleranceMs ?? DEFAULT_FUTURE_TOLERANCE_MS;
    this.maxRate = options?.maxRate ?? DEFAULT_MAX_RATE;
  }

  private hasObservation(): boolean {
    return !Number.isNaN(this.offsetHighWaterMs);
  }

  /**
   * Feed an authoritative timestamp (ms). Low offset samples (late
   * deliveries) refresh liveness but never lower the phase; high samples
   * raise the envelope by at most futureToleranceMs each.
   */
  observe(authoritativeMs: number): void {
    if (!Number.isFinite(authoritativeMs) || authoritativeMs <= 0) return;
    const mono = this.monotonicNow();
    const offset = authoritativeMs - mono;

    if (!this.hasObservation()) {
      this.offsetHighWaterMs = offset;
      this.lastObservationMono = mono;
      return;
    }

    const raise = offset - this.offsetHighWaterMs;
    if (raise > 0) {
      this.offsetHighWaterMs += Math.min(raise, this.futureToleranceMs);
    }
    this.lastObservationMono = Math.max(this.lastObservationMono, mono);
  }

  /**
   * Explicit "the viewer wasn't watching" hint (e.g. visibilitychange to
   * visible): jump to the capped target without slewing. Monotonic-safe.
   */
  markDiscontinuity(): void {
    if (!this.hasObservation() || this.display === undefined) return;
    const mono = this.monotonicNow();
    const target = this.targetAt(mono);
    this.display = Math.max(this.display, target);
    this.lastCallMono = mono;
  }

  /**
   * True when no observation has arrived for maxExtrapolationMs: the
   * display is frozen at the cap and UIs should show "syncing" rather
   * than a stuck countdown.
   */
  isStale(): boolean {
    if (!this.hasObservation()) return false;
    return (
      this.monotonicNow() - this.lastObservationMono > this.maxExtrapolationMs
    );
  }

  /**
   * Smoothed display time in ms. Returns 0 until the first observation,
   * preserving callers' existing zero-guards.
   */
  now(): number {
    if (!this.hasObservation()) return 0;
    const mono = this.monotonicNow();
    const target = this.targetAt(mono);

    if (this.display === undefined) {
      this.display = target;
      this.lastCallMono = mono;
      return this.display;
    }

    const dt = mono - this.lastCallMono;
    if (dt <= 0) return this.display;
    this.lastCallMono = mono;

    // Frames were suspended (fallback path): catch up invisibly.
    if (dt > this.hiddenGapMs) {
      this.display = Math.max(this.display, target);
      return this.display;
    }

    const err = target - (this.display + dt);

    if (err > this.snapThresholdMs) {
      this.display = target;
      return this.display;
    }

    // Base advance at wall rate plus bounded catch-up toward the target;
    // never past the target (freeze exactly at the cap when stale), and
    // never below wall rate while the target is still ahead.
    const catchUp = Math.min(
      Math.max(err, 0) * (1 - Math.exp(-dt / this.tauMs)),
      (this.maxRate - 1) * dt
    );
    const delta = Math.min(dt + catchUp, Math.max(target - this.display, 0));
    this.display += delta;
    return this.display;
  }

  /** Envelope target: phase high-water + capped monotonic progress. */
  private targetAt(mono: number): number {
    return (
      this.offsetHighWaterMs +
      Math.min(mono, this.lastObservationMono + this.maxExtrapolationMs)
    );
  }
}
