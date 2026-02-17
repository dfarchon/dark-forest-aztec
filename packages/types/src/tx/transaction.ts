import type { SentTx } from "@aztec/aztec.js/contracts";
import type { TxHash, TxReceipt } from "@aztec/aztec.js/tx";
import type { ClientTxStatus, TxIntent } from "./transactions";

export interface TransactionCollection {
  addTransaction(tx: Transaction): void;
  removeTransaction(tx: Transaction): void;
  getTransactions<T extends TxIntent>(
    transactionPredicate: (u: Transaction) => u is Transaction<T>,
  ): Transaction<T>[];
  hasTransaction<T extends TxIntent>(
    transactionPredicate: (u: Transaction) => u is Transaction<T>,
  ): boolean;
}

export interface PersistedTransaction<T extends TxIntent | unknown = TxIntent> {
  intent: T;
  hash: TxHash;
}

/**
 * A unique incrementing number that identifies a transaction.
 */
export type TransactionId = number;

/**
 * Represents a transaction that the game would like to submit to the chain (Aztec).
 */
export interface Transaction<T extends TxIntent = TxIntent> {
  /** In-game representation of this transaction. */
  intent: T;
  /** Uniquely identifies this transaction for its entire lifecycle. */
  id: TransactionId;
  /** Timestamp of the last time this transaction's state was updated. */
  lastUpdatedAt: number;
  /** Set by executor once the transaction has been submitted (Aztec tx hash). */
  hash?: TxHash;
  /** Current state of this transaction (client/UI lifecycle). */
  state: ClientTxStatus;
  /** Called if there was an error submitting this transaction. */
  onSubmissionError: (e: Error | undefined) => void;
  /** Called if there was an error waiting for this transaction to complete. */
  onReceiptError: (e: Error | undefined) => void;
  /** Called when the transaction was successfully submitted to the mempool (Aztec: SentTx, analogue of TransactionResponse). */
  onTransactionResponse: (e: SentTx) => void;
  /** Called when the transaction successfully completes. */
  onReceipt: (receipt: TxReceipt) => void;
  /** Optional label for logging (e.g. gas setting). */
  autoGasPriceSetting?: string;
  /** Resolves with the tx hash when submitted, or rejects on submit failure. */
  submittedPromise: Promise<SentTx>;
  /** Resolves with the receipt when the transaction is mined, or rejects. */
  confirmedPromise: Promise<TxReceipt>;
}
