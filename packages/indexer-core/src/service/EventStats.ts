import type {
  PublicEventBatchCounts,
  PublicEventName,
  PublicEventStats,
} from "../types.ts";
import { PUBLIC_EVENT_NAMES } from "../types.ts";

function emptyCounts(): Record<PublicEventName, number> {
  return Object.fromEntries(
    PUBLIC_EVENT_NAMES.map((eventName) => [eventName, 0]),
  ) as Record<PublicEventName, number>;
}

/**
 * Cumulative public-event counts for blocks this indexer has applied.
 * A bootstrap snapshot skips history, so those counts are marked incomplete
 * and only events after the snapshot are accumulated.
 */
export class EventStats {
  private fromBlock: number;
  private toBlock: number;
  private counts = emptyCounts();
  private complete = true;

  constructor(startBlock: number) {
    this.fromBlock = Math.max(1, startBlock);
    this.toBlock = this.fromBlock - 1;
  }

  /** Count events for a committed chunk. Call only after the chunk's rows convert. */
  add(batch: PublicEventBatchCounts | undefined, toBlock: number): void {
    for (const eventName of PUBLIC_EVENT_NAMES) {
      this.counts[eventName] += batch?.[eventName] ?? 0;
    }
    this.toBlock = toBlock;
  }

  /** A loaded snapshot replaced history. Later chunks count from the next block. */
  resetAfterSnapshot(block: number): void {
    this.counts = emptyCounts();
    this.fromBlock = block + 1;
    this.toBlock = block;
    this.complete = false;
  }

  /**
   * A snapshot was discarded and sync will start from `fromBlock`.
   * Counts and `toBlock` are left as they are: a following chunk overwrites
   * `toBlock`, and a discarded snapshot has already zeroed the counts.
   */
  markComplete(fromBlock: number): void {
    this.fromBlock = fromBlock;
    this.complete = true;
  }

  get(): PublicEventStats {
    const counts = { ...this.counts };
    return {
      fromBlock: this.fromBlock,
      toBlock: this.toBlock,
      counts,
      total: PUBLIC_EVENT_NAMES.reduce(
        (sum, eventName) => sum + counts[eventName],
        0,
      ),
      complete: this.complete,
    };
  }
}
