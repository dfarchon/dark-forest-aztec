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
 * A snapshot is always checked against the chain source. Only a present hash
 * that differs discards it; a missing hash or a failed hash request accepts it.
 * This function does not write the store. A rejected snapshot is not returned.
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
 * Missing hash, a missing block, or a failed request accepts the snapshot.
 * A present hash that differs discards it.
 */
async function snapshotHashMatches(
  source: IBlockEventSource,
  snap: IndexerSnapshot,
): Promise<boolean> {
  const n = snap.lastProcessedBlock;
  const expected = snap.lastProcessedBlockHash;
  if (!expected || n <= 0 || !source.getBlockHash) return true;
  try {
    const actual = await source.getBlockHash(n);
    if (actual === undefined) {
      console.warn(
        `[IndexerService] snapshot block ${n} not found on node yet; accepting snapshot`,
      );
      return true;
    }
    if (actual === expected) return true;
    console.error(
      `[IndexerService] snapshot hash mismatch at block ${n}: snapshot=${expected} node=${actual}; falling back to full sync`,
    );
    return false;
  } catch (err) {
    console.warn(
      "[IndexerService] snapshot hash check failed; accepting snapshot:",
      err,
    );
    return true;
  }
}
