import type { Transaction, TransactionId, TxIntent } from "@dfpunk/types";

/**
 * Called before queueing a transaction. If it rejects, the transaction is not queued.
 * Runs outside try/catch so rejections bubble up directly.
 */
export type BeforeQueued = (
  id: TransactionId,
  intent: TxIntent
) => Promise<void>;

/**
 * Called before executing a transaction. If it rejects, the transaction is cancelled.
 */
export type BeforeTransaction = (tx: Transaction) => Promise<void>;

/**
 * Called after a transaction completes (success or failure) with performance metrics.
 */
export type AfterTransaction = (
  tx: Transaction,
  performanceMetrics: unknown
) => Promise<void>;

export interface ConcurrentQueueConfiguration {
  maxInvocationsPerIntervalMs: number;
  invocationIntervalMs: number;
  maxConcurrency?: number;
}

export interface DiagnosticUpdater {
  updateDiagnostics: (updateFn: (d: Diagnostics) => void) => void;
}

export interface Diagnostics {
  transactionsInQueue: number;
  totalTransactions: number;
  [key: string]: unknown;
}
