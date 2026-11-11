import type { IBlockEventSource, IndexerSnapshot } from "../types.ts";
import { normalizeSnapshot } from "../utils/convert.ts";

/**
 * Initial state for start(). Later blocks continue from `source`.
 */
export interface BootstrapOptions {
  /** Chain source. Checks a snapshot hash, then supplies every later block. */
  source: IBlockEventSource;
  /**
   * Off-chain indexer. Only getSnapshot() is called. The indexer follows the
   * proven tip, so a returned snapshot is checked against `source`.
   * Absent: start from startBlock.
   */
  bootstrapSource?: IBlockEventSource;
  /**
   * When no bootstrap snapshot is used, start processing from this block (inclusive).
   * Ignored if bootstrapSource.getSnapshot() returns a snapshot. Default 0 (process from block 1).
   */
  startBlock?: number;
}

/**
 * Bootstrap inputs captured at construction. start() calls load();
 * the indexer does not keep the sources itself.
 */
export class InitialStateLoader {
  private readonly options: BootstrapOptions;

  constructor(options: BootstrapOptions) {
    this.options = options;
  }

  /** A usable snapshot, or undefined when start() should sync from startBlock. */
  load(): Promise<IndexerSnapshot | undefined> {
    return loadInitialState(this.options);
  }
}

/**
 * Load an optional bootstrap snapshot and decide whether it is usable.
 * A snapshot is installed only when getBlockHash(lastProcessedBlock) returns
 * the same string as lastProcessedBlockHash. Anything that cannot be checked
 * is discarded. This function does not write the store.
 */
export async function loadInitialState(
  options: BootstrapOptions,
): Promise<IndexerSnapshot | undefined> {
  if (!options.bootstrapSource?.getSnapshot) return undefined;

  let snap: IndexerSnapshot | null | undefined;
  try {
    snap = await options.bootstrapSource.getSnapshot();
    if (snap) normalizeSnapshot(snap);
  } catch (err) {
    console.warn(
      "[IndexerService] bootstrap snapshot rejected, falling back to full sync:",
      err,
    );
    return undefined;
  }
  if (!snap) return undefined;

  if (!(await snapshotHashMatches(options.source, snap))) return undefined;

  return snap;
}

/**
 * True only when the node returns the same block hash the snapshot recorded.
 * A missing hash, a missing block, or a failed request discards the snapshot.
 */
async function snapshotHashMatches(
  source: IBlockEventSource,
  snap: IndexerSnapshot,
): Promise<boolean> {
  const n = snap.lastProcessedBlock;
  const expected = snap.lastProcessedBlockHash;
  if (!expected || n <= 0 || !source.getBlockHash) {
    console.warn(
      `[IndexerService] snapshot at block ${n} has no verifiable hash; falling back to full sync`,
    );
    return false;
  }
  try {
    const actual = await source.getBlockHash(n);
    if (actual === expected) return true;
    if (actual === undefined) {
      console.warn(
        `[IndexerService] snapshot block ${n} not found on node; falling back to full sync`,
      );
    } else {
      console.error(
        `[IndexerService] snapshot hash mismatch at block ${n}: snapshot=${expected} node=${actual}; falling back to full sync`,
      );
    }
    return false;
  } catch (err) {
    console.warn(
      "[IndexerService] snapshot hash check failed; falling back to full sync:",
      err,
    );
    return false;
  }
}
