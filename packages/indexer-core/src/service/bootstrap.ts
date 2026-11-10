import type { IBlockEventSource, IndexerSnapshot } from "../types.ts";
import { normalizeSnapshot } from "../utils/convert.ts";

/**
 * Optional initial state. Used only by start(); later blocks come from the chain source.
 */
export interface BootstrapOptions {
  /**
   * Used only at start() to load initial state up to block X.
   * Only getSnapshot() is called; never used for getLatestBlockNumber or getBlockUpdates.
   * Typical: off-chain indexer API (e.g. OffChainBlockSource).
   */
  source?: IBlockEventSource;
  /**
   * When no bootstrap snapshot is used, start processing from this block (inclusive).
   * Ignored if source.getSnapshot() returns a snapshot. Default 0 (process from block 1).
   */
  startBlock?: number;
  /**
   * Before using a bootstrap snapshot, check its last block hash on the chain source;
   * discard it on mismatch. Default false.
   */
  verifySnapshot?: boolean;
}

export interface LoadInitialStateOptions {
  bootstrapSource?: IBlockEventSource;
  source: IBlockEventSource;
  /** Check the snapshot's last block hash against `source` before accepting it. */
  verify: boolean;
}

/**
 * What start() should do to the store. This function does not write the store:
 * a rejected snapshot is described, not applied.
 */
export interface InitialState {
  /** Normalized snapshot to install. Absent means keep or clear existing tables. */
  snapshot?: IndexerSnapshot;
  /** Drop current tables. Set when bootstrap throws or the hash does not match. */
  clear: boolean;
  /**
   * Block of a snapshot that was rejected after its event history would have
   * been marked incomplete. The caller resets stats to this block, then the
   * empty-cursor path may mark them complete again.
   */
  statsResetBlock?: number;
  /** Hash mismatch: the known tip from the rejected snapshot must not stick. */
  resetTip: boolean;
}

/**
 * Bootstrap inputs captured at construction. start() calls load();
 * the indexer does not keep the sources or the verify flag itself.
 */
export class InitialStateLoader {
  private readonly options: LoadInitialStateOptions;

  constructor(options: LoadInitialStateOptions) {
    this.options = options;
  }

  load(): Promise<InitialState> {
    return loadInitialState(this.options);
  }
}

/**
 * Load an optional bootstrap snapshot and decide whether it is usable.
 * Hash check, missing hash, and a failed hash request follow the same rules
 * as before: only a present hash that differs discards the snapshot.
 */
export async function loadInitialState(
  options: LoadInitialStateOptions,
): Promise<InitialState> {
  const none: InitialState = { clear: false, resetTip: false };
  if (!options.bootstrapSource?.getSnapshot) return none;

  let snap: IndexerSnapshot | null | undefined;
  try {
    snap = await options.bootstrapSource.getSnapshot();
    if (snap) normalizeSnapshot(snap);
  } catch (err) {
    console.warn(
      "[IndexerService] bootstrap snapshot rejected, falling back to full sync:",
      err,
    );
    return { clear: true, resetTip: false };
  }
  if (!snap) return none;

  if (options.verify && !(await snapshotHashMatches(options.source, snap))) {
    return {
      clear: true,
      resetTip: true,
      statsResetBlock: snap.lastProcessedBlock,
    };
  }

  return { snapshot: snap, clear: false, resetTip: false };
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
