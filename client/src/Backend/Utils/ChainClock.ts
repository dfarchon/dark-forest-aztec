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
import { BlockNumber } from "@aztec/foundation/branded-types";

import { TimeSmoother } from "./TimeSmoother.ts";

export class ChainClock {
  private readonly node: AztecNode;

  /** Chain time minus client time, in milliseconds. */
  private offsetMs = 0;

  /** Raw chain timestamp (seconds) from the last successful sync. */
  private lastChainTimestampSec = 0;

  /** Wall-clock ms of the last successful sync (for throttling). */
  private lastSyncMs = 0;

  private static MIN_SYNC_INTERVAL_MS = 3000;

  /** Highest block number ever synced (dedupes repeat notifications). */
  private lastSyncedBlockNumber = 0;

  /** Newest specific block requested and not yet synced. */
  private pendingBlockNumber: number | undefined;

  /** A "latest" fetch has been requested and not yet performed. */
  private pendingLatest = false;

  /** True while the drain loop is servicing pending requests. */
  private draining = false;

  /** In-flight fetch guard for direct syncFromNode callers (boot path). */
  private syncInFlight: Promise<void> | undefined;

  /**
   * Post-sync listeners, fired after EVERY successful raw-clock update
   * (notified block, "latest", boot, retries alike). "Do X after time
   * advances" work belongs here — an observer cannot be starved, raced,
   * or resolved early the way a shared promise over coalesced work can.
   */
  private readonly syncListeners: Array<() => void> = [];

  /** Display-only smoothing of chain time; never feeds tx timestamps. */
  private readonly smoother = new TimeSmoother();

  constructor(node: AztecNode) {
    this.node = node;
  }

  /** Sync the clock from a known chain timestamp (seconds). */
  sync(chainTimestampSec: number): void {
    this.lastChainTimestampSec = chainTimestampSec;
    this.offsetMs = chainTimestampSec * 1000 - Date.now();
    this.lastSyncMs = Date.now();
    try {
      this.smoother.observe(chainTimestampSec * 1000);
    } catch {
      // The smoother is display-only; it must never break raw sync.
    }
    for (const listener of this.syncListeners) {
      try {
        listener();
      } catch (e) {
        console.error("[ChainClock] sync listener threw", e);
      }
    }
  }

  /**
   * Register work to run after every successful raw-clock sync (e.g.
   * flushing matured arrivals). Returns an unsubscribe function.
   */
  onSynced(listener: () => void): () => void {
    this.syncListeners.push(listener);
    return () => {
      const i = this.syncListeners.indexOf(listener);
      if (i >= 0) this.syncListeners.splice(i, 1);
    };
  }

  /**
   * Request a sync from a specific notified block (preferred — avoids
   * racing a possibly-stale/ahead "latest" tip on load-balanced RPCs).
   * Fire-and-forget: repeat/old notifications are ignored, bursts are
   * coalesced to the newest block, and completion is observable via
   * onSynced — deliberately NOT via a returned promise, which cannot be
   * made race-free over coalesced work.
   */
  requestSync(blockNumber: number): void {
    if (blockNumber <= this.lastSyncedBlockNumber) return;
    this.pendingBlockNumber = Math.max(
      this.pendingBlockNumber ?? 0,
      blockNumber
    );
    void this.drain();
  }

  /** Request a "latest" sync (e.g. on tab refocus). Fire-and-forget. */
  requestSyncLatest(): void {
    this.pendingLatest = true;
    void this.drain();
  }

  /**
   * Serialized worker: services pending requests, waiting out the
   * throttle between fetches, with per-target bounded retries. Restarts
   * itself if new work arrived during finalization.
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let currentTarget: number | undefined;
      let attempts = 0;
      let latestAttempts = 0;
      while (
        this.pendingLatest ||
        (this.pendingBlockNumber !== undefined &&
          this.pendingBlockNumber > this.lastSyncedBlockNumber)
      ) {
        const waitMs =
          ChainClock.MIN_SYNC_INTERVAL_MS - (Date.now() - this.lastSyncMs);
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        // "latest" first when pending: it is a rare, time-critical
        // one-shot (refocus) and is attempt-bounded, so it cannot starve
        // block targets — whereas a stream of failing block fetches with
        // ever-newer targets could starve it indefinitely. A successful
        // latest fetch usually satisfies pending block targets too.
        if (this.pendingLatest) {
          latestAttempts += 1;
          const syncMsBefore = this.lastSyncMs;
          await this.syncFromNode();
          const advanced = this.lastSyncMs !== syncMsBefore;
          if (advanced || latestAttempts >= 3) {
            if (!advanced) {
              console.warn(
                `[ChainClock] latest sync giving up after ` +
                  `${latestAttempts} attempts`
              );
            }
            this.pendingLatest = false;
            latestAttempts = 0;
          }
          continue;
        }
        const wantBlock = this.pendingBlockNumber;
        if (wantBlock !== undefined && wantBlock > this.lastSyncedBlockNumber) {
          if (currentTarget !== wantBlock) {
            currentTarget = wantBlock;
            attempts = 0;
          }
          attempts += 1;
          await this.syncFromNode(wantBlock);
          if (this.lastSyncedBlockNumber >= wantBlock) {
            if (this.pendingBlockNumber === wantBlock) {
              this.pendingBlockNumber = undefined;
            }
          } else if (attempts >= 3) {
            console.warn(
              `[ChainClock] sync giving up on block=${wantBlock} ` +
                `after ${attempts} attempts`
            );
            if (this.pendingBlockNumber === wantBlock) {
              this.pendingBlockNumber = undefined;
            }
          }
        }
      }
    } finally {
      this.draining = false;
      // Work that arrived between loop exit and here restarts the drain.
      if (
        this.pendingLatest ||
        (this.pendingBlockNumber !== undefined &&
          this.pendingBlockNumber > this.lastSyncedBlockNumber)
      ) {
        void this.drain();
      }
    }
  }

  /**
   * Fetch the given block's timestamp (or "latest") and sync. Direct
   * concurrent callers (boot path) piggyback on the in-flight fetch;
   * request sequencing/queuing is the drain loop's job (resync).
   */
  async syncFromNode(blockNumber?: number): Promise<void> {
    if (this.syncInFlight !== undefined) return this.syncInFlight;
    this.syncInFlight = this.doSyncFromNode(blockNumber);
    try {
      await this.syncInFlight;
    } finally {
      this.syncInFlight = undefined;
    }
  }

  private async doSyncFromNode(blockNumber?: number): Promise<void> {
    try {
      const block = await this.node.getBlock(
        blockNumber !== undefined ? BlockNumber(blockNumber) : "latest"
      );
      if (block) {
        const ts = Number(block.header.globalVariables.timestamp);
        if (ts > 0) {
          const fetchedNumber = Number(block.number);
          // A lagging replica answering "latest" with an older block than
          // one we already synced must not regress raw time (which feeds
          // transaction timestamps and arrival maturation).
          if (fetchedNumber < this.lastSyncedBlockNumber) {
            return;
          }
          this.lastSyncedBlockNumber = Math.max(
            this.lastSyncedBlockNumber,
            fetchedNumber
          );
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
   * Continuously-advancing estimate of chain time in ms, for DISPLAY ONLY
   * (voyage motion, countdowns). Extrapolates at wall rate between blocks
   * and converges smoothly on each sync; monotonic, never snaps backwards.
   * Returns 0 until the first sync. Never use for transaction timestamps —
   * use now()/nowSec()/lastBlockTimestamp() there (contracts assert
   * freshness against the sequencer's block time).
   */
  smoothedNowMs(): number {
    return this.smoother.now();
  }

  /**
   * Hint that the viewer wasn't watching (e.g. tab became visible again):
   * the smoothed display time jumps to its best estimate instead of
   * visibly fast-forwarding.
   */
  markDisplayDiscontinuity(): void {
    this.smoother.markDiscontinuity();
  }

  /** True when smoothed display time is frozen awaiting observations. */
  displayTimeIsStale(): boolean {
    return this.smoother.isStale();
  }

  /** Wall ms since the last successful sync; Infinity before the first. */
  msSinceLastSync(): number {
    return this.lastSyncMs > 0 ? Date.now() - this.lastSyncMs : Infinity;
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
}
