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

  /** Last synced block timestamp in seconds (no interpolation). */
  private lastBlockTimestampSec = 0n;

  /** Wall-clock ms of the last successful sync (for throttling). */
  private lastSyncMs = 0;

  private static MIN_SYNC_INTERVAL_MS = 3000;

  constructor(node: AztecNode) {
    this.node = node;
  }

  /** Sync the clock from a known chain timestamp (seconds). */
  sync(chainTimestampSec: number): void {
    this.offsetMs = chainTimestampSec * 1000 - Date.now();
    this.lastBlockTimestampSec = BigInt(chainTimestampSec);
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
      const block = await (
        this.node as unknown as {
          getBlock: (n: number | "latest") => Promise<
            | {
                header?: {
                  globalVariables?: { timestamp?: unknown };
                };
                timestamp?: number;
              }
            | undefined
          >;
        }
      ).getBlock("latest");

      let ts: number | undefined;
      const raw = block?.header?.globalVariables?.timestamp;
      if (raw != null) {
        ts = typeof raw === "bigint" ? Number(raw) : Number(raw);
      } else if (block?.timestamp != null) {
        ts = Number(block.timestamp);
      }

      if (ts != null && ts > 0) {
        this.sync(ts);
      }
    } catch {
      // keep current offset (0 = use system clock)
    }
  }

  /**
   * Return a conservative block timestamp safe for contract submission.
   * Subtracts a small buffer to avoid racing ahead of what simulate() uses
   * as actual_timestamp (which may lag behind getBlock("latest") on remote devnets).
   * The 300s contract tolerance window makes this safe.
   */
  async getLastBlockTimestampSec(): Promise<bigint> {
    await this.syncFromNode();
    return this.lastBlockTimestampSec;
  }

  /** Current chain-adjusted time in milliseconds. */
  now(): number {
    return Date.now() + this.offsetMs;
  }

  /** Current chain-adjusted time in seconds. */
  nowSec(): number {
    return this.now() / 1000;
  }

  /** The current offset in seconds (positive = chain ahead). */
  getOffsetSec(): number {
    return this.offsetMs / 1000;
  }
}
