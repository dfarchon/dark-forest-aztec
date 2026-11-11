import lodash from "lodash";
import type { DebouncedFunc } from "lodash";
import type { IBlockEventSource } from "../types.ts";
import type { CommittedChunk, IndexerStore } from "./IndexerStore.ts";

/** Caller-facing sync settings. BlockSyncer fills in source, store, and callbacks. */
export interface SyncOptions {
  /** Debounce delay in ms for processing new blocks. Default 1000. */
  debounceMs?: number;
  /** Poll interval for latest block when not using push. Default 2000. */
  pollIntervalMs?: number;
  /**
   * Max blocks per getBlockUpdates call when syncing from chain. Prevents a single
   * huge request (e.g. 1 to 50000). Default 100; tune to match node/RPC limits (e.g. 50–200).
   */
  maxBlocksPerRequest?: number;
  /** Max wait between background retries after failures; 0 = no backoff. Default 0. */
  maxBackoffMs?: number;
  /** Attempts for the initial sync in start(); 1 = no retry. Default 1. */
  initialSyncMaxRetries?: number;
  /**
   * Called before waiting to retry a failed initial sync. Not called on the
   * attempt that exhausts initialSyncMaxRetries and rejects start().
   */
  onInitialSyncRetry?: (
    attempt: number,
    waitMs: number,
    error: unknown,
  ) => void;
}

export interface BlockSyncerOptions {
  source: IBlockEventSource;
  store: IndexerStore;
  debounceMs: number;
  pollIntervalMs: number;
  maxBlocksPerRequest: number;
  maxBackoffMs: number;
  /** Attempts for catchUp(); 1 = no retry. Default 1. */
  initialSyncMaxRetries?: number;
  onInitialSyncRetry?: SyncOptions["onInitialSyncRetry"];
  /** Clock for backoff. Tests pass a fake; production uses Date.now. */
  now?: () => number;
  onChunk: (
    fromBlock: number,
    toBlock: number,
    committed: CommittedChunk,
  ) => void;
}

export interface SyncerStatus {
  latestKnownBlock: number;
  isSyncing: boolean;
  consecutiveFailures: number;
  lastError?: string;
  nextRetryAt: number;
}

/**
 * Pulls block ranges from the chain source into an IndexerStore.
 * Background polling and the debounced follow-up obey nextRetryAt.
 * catchUp and syncNow do not: they are explicit requests to sync now.
 */
export class BlockSyncer {
  private readonly source: IBlockEventSource;
  private readonly store: IndexerStore;
  private readonly pollIntervalMs: number;
  private readonly maxBlocksPerRequest: number;
  private readonly maxBackoffMs: number;
  private readonly initialSyncMaxRetries: number;
  private readonly onInitialSyncRetry?: SyncOptions["onInitialSyncRetry"];
  private readonly now: () => number;
  private readonly onChunk: BlockSyncerOptions["onChunk"];
  private readonly debouncedProcess: DebouncedFunc<() => void>;

  private stopped = false;
  private latestKnownBlock = 0;
  private isSyncing = false;
  private syncPromise: Promise<void> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private consecutiveFailures = 0;
  private nextRetryAt = 0;
  private lastError: string | undefined;

  constructor(options: BlockSyncerOptions) {
    this.source = options.source;
    this.store = options.store;
    this.pollIntervalMs = options.pollIntervalMs;
    this.maxBlocksPerRequest = options.maxBlocksPerRequest;
    this.maxBackoffMs = options.maxBackoffMs;
    this.initialSyncMaxRetries = Math.max(
      1,
      options.initialSyncMaxRetries ?? 1,
    );
    this.onInitialSyncRetry = options.onInitialSyncRetry;
    this.now = options.now ?? Date.now;
    this.onChunk = options.onChunk;

    // Background syncs are fire-and-forget: log failures here so a rejected
    // run never becomes an unhandled rejection. The next poll retries from
    // the last committed block, after the backoff if one is set.
    this.debouncedProcess = lodash.debounce(
      () => {
        if (this.stopped) return;
        if (this.now() < this.nextRetryAt) return;
        this.run()
          .then(() => this.clearFailure())
          .catch((err) => this.noteSyncFailure(err));
      },
      options.debounceMs,
      { leading: true, trailing: true },
    );
  }

  status(): SyncerStatus {
    return {
      latestKnownBlock: this.latestKnownBlock,
      isSyncing: this.isSyncing,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      nextRetryAt: this.nextRetryAt,
    };
  }

  /** Replace the known latest block. Used when an accepted bootstrap snapshot sets it. */
  setLatestKnownBlock(block: number): void {
    this.latestKnownBlock = block;
  }

  /**
   * Initial catch-up. Retries with its own sleep, and does not consult the
   * background backoff clock.
   */
  async catchUp(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        this.latestKnownBlock = await this.source.getLatestBlockNumber();
        await this.run();
        if (this.store.processedBlock < this.latestKnownBlock) {
          // The node may have been behind the previously observed latest block. Refresh once.
          this.latestKnownBlock = await this.source.getLatestBlockNumber();
          await this.run();
        }
        if (this.store.processedBlock < this.latestKnownBlock) {
          console.warn(
            `[IndexerService] initial sync incomplete: processed up to block ` +
              `${this.store.processedBlock}, expected ${this.latestKnownBlock}. ` +
              `Will continue from the next poll.`,
          );
        }
        this.clearFailure();
        return;
      } catch (err) {
        this.consecutiveFailures = attempt;
        this.lastError = err instanceof Error ? err.message : String(err);
        if (attempt >= this.initialSyncMaxRetries) throw err;
        const wait = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
        this.onInitialSyncRetry?.(attempt, wait, err);
        console.warn(
          `[IndexerService] initial sync failed (attempt ${attempt}), retry in ${wait}ms:`,
          err,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  /** Begin the poll interval. The caller has already moved to the live phase. */
  startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  /** One poll tick. Skipped entirely while a background backoff is in effect. */
  async pollOnce(): Promise<void> {
    if (this.stopped) return;
    if (this.now() < this.nextRetryAt) return;
    try {
      const next = await this.source.getLatestBlockNumber();
      this.latestKnownBlock = Math.max(this.latestKnownBlock, next);
      this.debouncedProcess();
    } catch (err) {
      this.noteSyncFailure(err);
    }
  }

  stop(): void {
    this.stopped = true;
    this.debouncedProcess.cancel();
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Fetch the latest known block and apply any missing blocks immediately,
   * even during a background backoff. Concurrent callers share the in-flight run.
   */
  async syncNow(): Promise<void> {
    const latest = await this.source.getLatestBlockNumber();
    this.latestKnownBlock = Math.max(this.latestKnownBlock, latest);
    await this.run();
    if (this.store.processedBlock < this.latestKnownBlock) {
      await this.run();
    }
    this.clearFailure();
  }

  private async run(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;

    const syncPromise = this.runPending();
    this.syncPromise = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (this.syncPromise === syncPromise) {
        this.syncPromise = undefined;
      }
    }
  }

  private async runPending(): Promise<void> {
    if (this.stopped) return;

    let fromBlock = this.store.processedBlock + 1;
    const toBlock = this.latestKnownBlock;
    if (fromBlock > toBlock) return;

    this.isSyncing = true;
    try {
      while (fromBlock <= toBlock) {
        if (this.stopped) return;
        const chunkEnd = Math.min(
          fromBlock + this.maxBlocksPerRequest - 1,
          toBlock,
        );
        const updates = await this.source.getBlockUpdates(fromBlock, chunkEnd);
        if (this.stopped) return;
        const committedTo = updates.toBlock;
        if (committedTo < fromBlock) break; // node behind; retry next poll
        const committed = this.store.commit(updates);
        this.onChunk(fromBlock, committed.toBlock, committed);
        if (committedTo < chunkEnd) break;
        fromBlock = committedTo + 1;
      }
    } finally {
      // Errors propagate to the caller. Fully committed chunks are kept;
      // the next run resumes from the last processed block + 1.
      this.isSyncing = false;
    }
  }

  private backoffMs(): number {
    if (this.maxBackoffMs <= 0) return 0;
    // 2s, 4s, 8s, ... capped at maxBackoffMs
    return Math.min(
      this.maxBackoffMs,
      2_000 * 2 ** Math.max(0, this.consecutiveFailures - 1),
    );
  }

  private noteSyncFailure(err: unknown): void {
    this.consecutiveFailures += 1;
    this.lastError = err instanceof Error ? err.message : String(err);
    const wait = this.backoffMs();
    this.nextRetryAt = this.now() + wait;
    console.warn(
      `[IndexerService] sync failed (${this.consecutiveFailures}x), retry in ${wait}ms:`,
      err,
    );
  }

  private clearFailure(): void {
    this.consecutiveFailures = 0;
    this.lastError = undefined;
    this.nextRetryAt = 0;
  }
}
