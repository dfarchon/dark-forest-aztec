/**
 * ChainClock: provides chain-adjusted time for game logic.
 *
 * The Aztec L2 block timestamp may differ from the client's system clock
 * (e.g. local devnet time drift). All game-time calculations (energy growth,
 * arrival ETAs, etc.) must use chain time, not Date.now().
 *
 * Usage:
 *   const clock = new ChainClock(node);
 *   await clock.syncFromNode();       // initial sync
 *   const nowMs = clock.now();        // chain-adjusted milliseconds
 *   const nowSec = clock.nowSec();    // chain-adjusted seconds
 */

import type { AztecNode } from "@aztec/aztec.js/node";

const defaultMonotonicNow = (): number =>
  typeof performance === "undefined" ? Date.now() : performance.now();

export class ChainClock {
  private readonly node: AztecNode;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;

  /** Chain time minus client time, in milliseconds. */
  private offsetMs = 0;

  /** Raw chain timestamp (seconds) from the last successful sync. */
  private lastChainTimestampSec = 0;

  /** Monotonic ms of the last successful sync (for throttling). */
  private lastSyncMonotonicMs = 0;

  /** Continuously advancing, display-only chain time. */
  private displayTimeMs = 0;

  /** Monotonic anchor used to advance displayTimeMs. */
  private lastDisplayMonotonicMs = 0;

  /** Latest chain-time target used to calibrate the display clock. */
  private targetDisplayTimeMs = 0;

  /** Monotonic time at which targetDisplayTimeMs was observed. */
  private targetDisplayMonotonicMs = 0;

  private static MIN_SYNC_INTERVAL_MS = 3000;

  /**
   * Maximum clock correction per elapsed millisecond. Keeping this below 1
   * guarantees the display clock never runs backwards while correcting drift.
   */
  private static MAX_DISPLAY_SLEW_RATE = 0.1;

  constructor(
    node: AztecNode,
    wallNow: () => number = Date.now,
    monotonicNow: () => number = defaultMonotonicNow
  ) {
    this.node = node;
    this.wallNow = wallNow;
    this.monotonicNow = monotonicNow;
  }

  /** Sync the clock from a known chain timestamp (seconds). */
  sync(chainTimestampSec: number): void {
    const wallMs = this.wallNow();
    const monotonicMs = this.monotonicNow();
    if (this.lastChainTimestampSec > 0) {
      this.advanceDisplayClock(monotonicMs);
    } else {
      this.displayTimeMs = chainTimestampSec * 1000;
      this.lastDisplayMonotonicMs = monotonicMs;
    }

    this.lastChainTimestampSec = chainTimestampSec;
    this.offsetMs = chainTimestampSec * 1000 - wallMs;
    this.targetDisplayTimeMs = chainTimestampSec * 1000;
    this.targetDisplayMonotonicMs = monotonicMs;
    this.lastSyncMonotonicMs = monotonicMs;
  }

  /**
   * Re-sync by fetching the latest L2 block timestamp, throttled to avoid
   * excessive RPC calls when blocks arrive in quick succession (local devnet).
   */
  async resync(): Promise<void> {
    if (
      this.monotonicNow() - this.lastSyncMonotonicMs <
      ChainClock.MIN_SYNC_INTERVAL_MS
    )
      return;
    await this.syncFromNode();
  }

  /** Fetch the latest L2 block timestamp and sync. */
  async syncFromNode(): Promise<void> {
    try {
      const block = await this.node.getBlock("latest");
      if (block) {
        const ts = Number(block.header.globalVariables.timestamp);
        if (ts > 0) {
          this.sync(ts);
        }
      }
    } catch {
      // keep current offset (0 = use system clock)
    }
  }

  /**
   * Current chain time in milliseconds (latest L2 block timestamp from last sync).
   * Caller must have triggered at least one sync (e.g. at init) before using.
   */
  now(): number {
    return this.lastChainTimestampSec * 1000;
  }

  /** Current chain-adjusted time in seconds. */
  nowSec(): number {
    return Math.floor(this.now() / 1000);
  }

  /**
   * Continuously advancing chain-adjusted time for rendering only.
   *
   * Never use this value for transactions, arrivals, planet updates, or other
   * game-state decisions. Those must continue to use now()/nowSec().
   */
  displayNow(): number {
    if (this.lastChainTimestampSec === 0) return 0;
    this.advanceDisplayClock(this.monotonicNow());
    return this.displayTimeMs;
  }

  /** The current offset in seconds (positive = chain ahead). */
  getOffsetSec(): number {
    return Math.floor(this.offsetMs / 1000);
  }

  /**
   * Last known L2 block timestamp (seconds) without Date.now() extrapolation.
   * Safe to use as the base timestamp for contract calls on devnet where
   * block timestamps may lag behind the client's system clock.
   */
  lastBlockTimestamp(): number {
    return this.lastChainTimestampSec;
  }

  /** Force-sync and return the raw chain timestamp (seconds). */
  async syncAndGetBlockTimestamp(): Promise<number> {
    await this.syncFromNode();
    return this.lastChainTimestampSec;
  }

  /** Fetch the latest L2 block number from the node. */
  async getBlockNumber(): Promise<number> {
    return Number(await this.node.getBlockNumber());
  }

  private advanceDisplayClock(monotonicMs: number): void {
    const elapsedMs = Math.max(0, monotonicMs - this.lastDisplayMonotonicMs);
    if (elapsedMs === 0) return;

    const nominalDisplayMs = this.displayTimeMs + elapsedMs;
    const desiredDisplayMs =
      this.targetDisplayTimeMs +
      Math.max(0, monotonicMs - this.targetDisplayMonotonicMs);
    const maxCorrectionMs = elapsedMs * ChainClock.MAX_DISPLAY_SLEW_RATE;
    const correctionMs = Math.max(
      -maxCorrectionMs,
      Math.min(maxCorrectionMs, desiredDisplayMs - nominalDisplayMs)
    );

    this.displayTimeMs = nominalDisplayMs + correctionMs;
    this.lastDisplayMonotonicMs = monotonicMs;
  }
}
