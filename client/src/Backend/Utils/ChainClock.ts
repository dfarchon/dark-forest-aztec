/**
 * ChainClock: provides chain-adjusted time for game logic.
 *
 * The Aztec L2 block timestamp may differ from the client's system clock
 * (e.g. local devnet time drift). All game-time calculations (energy growth,
 * arrival ETAs, etc.) must use chain time, not Date.now().
 *
 * Usage:
 *   const clock = new ChainClock();
 *   await clock.syncFromNode(node);   // or clock.sync(chainTimestampSec)
 *   const nowMs = clock.now();        // chain-adjusted milliseconds
 *   const nowSec = clock.nowSec();    // chain-adjusted seconds
 */

import type { AztecNode } from "@aztec/aztec.js/node";

export class ChainClock {
  /** Chain time minus client time, in milliseconds. */
  private offsetMs = 0;

  /** Wall-clock ms of the last successful sync (for throttling). */
  private lastSyncMs = 0;

  private static MIN_SYNC_INTERVAL_MS = 3000;

  /** Sync the clock from a known chain timestamp (seconds). */
  sync(chainTimestampSec: number): void {
    this.offsetMs = chainTimestampSec * 1000 - Date.now();
    this.lastSyncMs = Date.now();
  }

  /**
   * Re-sync from an async timestamp source, throttled to avoid excessive
   * RPC calls when blocks arrive in quick succession (local devnet).
   */
  async resync(getTimestamp: () => Promise<number>): Promise<void> {
    if (Date.now() - this.lastSyncMs < ChainClock.MIN_SYNC_INTERVAL_MS) return;
    try {
      const ts = await getTimestamp();
      if (ts > 0) {
        this.sync(ts);
      }
    } catch {
      // keep current offset
    }
  }

  /** Fetch the latest L2 block timestamp and sync. */
  async syncFromNode(node: AztecNode): Promise<void> {
    try {
      const block = await (
        node as unknown as {
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
