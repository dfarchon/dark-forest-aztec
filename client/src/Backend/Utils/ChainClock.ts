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

export class ChainClock {
  private readonly node: AztecNode;

  /** Chain time minus client time, in milliseconds. */
  private offsetMs = 0;

  /** Raw chain timestamp (seconds) from the last successful sync. */
  private lastChainTimestampSec = 0;

  /** Wall-clock ms of the last successful sync (for throttling). */
  private lastSyncMs = 0;

  private static MIN_SYNC_INTERVAL_MS = 3000;

  /** Expected L2 block interval in seconds; used to cap extrapolated chain time. */
  private static BLOCK_INTERVAL_SEC = 36;

  constructor(node: AztecNode) {
    this.node = node;
  }

  /** Sync the clock from a known chain timestamp (seconds). */
  sync(chainTimestampSec: number): void {
    this.lastChainTimestampSec = chainTimestampSec;
    this.offsetMs = chainTimestampSec * 1000 - Date.now();
    this.lastSyncMs = Date.now();
  }

  /**
   * Re-sync by fetching the latest L2 block timestamp, throttled to avoid
   * excessive RPC calls when blocks arrive in quick succession (local devnet).
   */
  async resync(): Promise<void> {
    if (Date.now() - this.lastSyncMs < ChainClock.MIN_SYNC_INTERVAL_MS) return;
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
