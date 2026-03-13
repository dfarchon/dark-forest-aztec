/**
 * TxExecutor: strict port of darkforest-v0.6/packages/network/src/TxExecutor.ts
 * adapted for Aztec Network.
 *
 * Lifecycle: Init → Processing → Submit → Confirm/Fail/Cancel
 *
 * Key differences from v0.6:
 *   - No nonce/gas management (Aztec handles internally)
 *   - Uses SponsoredFeePaymentMethod for fee-free transactions
 *   - send({ wait: NO_WAIT }) → TxHash, then waitForTx() for receipt
 *   - StateResolver assembles full contract args from indexer state
 *   - ContractResolver maps methodName to Aztec contract + method
 */

import { NO_WAIT } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { AztecNode } from "@aztec/aztec.js/node";
import { waitForTx } from "@aztec/aztec.js/node";
import type { TxHash, TxReceipt } from "@aztec/stdlib/tx";
import type {
  PersistedTransaction,
  Transaction,
  TransactionId,
  TxIntent,
} from "@dfpunk/types";

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { WalletManager } from "../WalletManager/WalletManager";
import { ConfigCache } from "./ConfigCache";
import { ContractResolver } from "./ContractResolver";
import { StateResolver, type StateResolverOptions } from "./StateResolver";
import { ThrottledConcurrentQueue } from "./ThrottledConcurrentQueue";
import type {
  AfterTransaction,
  BeforeQueued,
  BeforeTransaction,
  ConcurrentQueueConfiguration,
  DiagnosticUpdater,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Timeout wrapper — rejects if promise doesn't resolve within ms. */
function timeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const TX_SUBMIT_TIMEOUT = 120_000; // 2 minutes

const DEFAULT_QUEUE_CONFIG: ConcurrentQueueConfiguration = {
  invocationIntervalMs: 500,
  maxInvocationsPerIntervalMs: 1,
  maxConcurrency: 1,
};

// ---------------------------------------------------------------------------
// TxExecutor
// ---------------------------------------------------------------------------

export class TxExecutor {
  private readonly queue: ThrottledConcurrentQueue<Transaction>;
  private idSequence: TransactionId = 0;
  private diagnosticsUpdater?: DiagnosticUpdater;

  private readonly node: AztecNode;
  private readonly walletManager: WalletManager;
  private readonly contractResolver: ContractResolver;
  private readonly stateResolver: StateResolver;

  private readonly beforeQueued?: BeforeQueued;
  private readonly beforeTransaction?: BeforeTransaction;
  private readonly afterTransaction?: AfterTransaction;

  constructor(
    walletManager: WalletManager,
    indexer: IndexerConnection,
    node: AztecNode,
    configCache: ConfigCache,
    chainClock: ChainClock,
    beforeQueued?: BeforeQueued,
    beforeTransaction?: BeforeTransaction,
    afterTransaction?: AfterTransaction,
    queueConfiguration?: ConcurrentQueueConfiguration,
    stateResolverOptions?: StateResolverOptions
  ) {
    this.node = node;
    this.walletManager = walletManager;
    this.beforeQueued = beforeQueued;
    this.beforeTransaction = beforeTransaction;
    this.afterTransaction = afterTransaction;

    this.queue = new ThrottledConcurrentQueue(
      queueConfiguration ?? DEFAULT_QUEUE_CONFIG
    );

    const wallet = walletManager.getWallet();
    this.contractResolver = new ContractResolver(wallet);

    this.stateResolver = new StateResolver(
      indexer,
      configCache,
      chainClock,
      () => walletManager.getActiveAddress()!.toString(),
      wallet,
      stateResolverOptions
    );
  }

  // -------------------------------------------------------------------------
  // queueTransaction — v0.6 lines 212-277
  // -------------------------------------------------------------------------

  async queueTransaction<T extends TxIntent>(
    intent: T
  ): Promise<Transaction<T>> {
    this.diagnosticsUpdater?.updateDiagnostics((d) => {
      d.transactionsInQueue++;
    });

    const id = this.nextId();

    // beforeQueued runs OUTSIDE try/catch — rejection bubbles up, not marked as reverted
    if (this.beforeQueued) {
      await this.beforeQueued(id, intent);
    }

    const {
      promise: submittedPromise,
      reject: rejectTxResponse,
      resolve: txResponse,
    } = deferred<TxHash>();
    const {
      promise: confirmedPromise,
      reject: rejectTxReceipt,
      resolve: txReceipt,
    } = deferred<TxReceipt>();

    const tx: Transaction<T> = {
      id,
      lastUpdatedAt: Date.now(),
      state: "Init",
      intent,
      submittedPromise,
      confirmedPromise,
      onSubmissionError: rejectTxResponse,
      onReceiptError: rejectTxReceipt,
      onTransactionResponse: txResponse,
      onReceipt: txReceipt,
    };

    this.queue.add(() => {
      this.diagnosticsUpdater?.updateDiagnostics((d) => {
        d.transactionsInQueue--;
      });
      return this.execute(tx);
    }, tx);

    return tx;
  }

  // -------------------------------------------------------------------------
  // dequeueTransaction — v0.6 lines 279-282
  // -------------------------------------------------------------------------

  dequeueTransaction(tx: Transaction): void {
    this.queue.remove((queuedTx) => queuedTx?.id === tx.id);
    tx.state = "Cancel";
  }

  // -------------------------------------------------------------------------
  // prioritizeTransaction — v0.6 lines 284-287
  // -------------------------------------------------------------------------

  prioritizeTransaction(tx: Transaction): void {
    this.queue.prioritize((queuedTx) => queuedTx?.id === tx.id);
    tx.state = "Prioritized";
  }

  // -------------------------------------------------------------------------
  // waitForTransaction — v0.6 lines 172-207 (resume persisted tx)
  // -------------------------------------------------------------------------

  waitForTransaction<T extends TxIntent>(
    ser: PersistedTransaction<T>
  ): Transaction<T> {
    const {
      promise: submittedPromise,
      reject: rejectTxResponse,
      resolve: txResponse,
    } = deferred<TxHash>();
    const {
      promise: confirmedPromise,
      reject: rejectTxReceipt,
      resolve: txReceipt,
    } = deferred<TxReceipt>();

    const tx: Transaction<T> = {
      id: this.nextId(),
      lastUpdatedAt: Date.now(),
      state: "Init",
      intent: ser.intent,
      submittedPromise,
      confirmedPromise,
      onSubmissionError: rejectTxResponse,
      onReceiptError: rejectTxReceipt,
      onTransactionResponse: txResponse,
      onReceipt: txReceipt,
    };

    // Persisted tx was already submitted — resolve submittedPromise and set hash
    tx.hash = ser.hash;
    tx.onTransactionResponse(ser.hash);

    waitForTx(this.node, ser.hash, {
      timeout: 120,
      dontThrowOnRevert: true,
    })
      .then((receipt) => {
        if (receipt.hasExecutionSucceeded()) {
          tx.onReceipt(receipt);
        } else {
          tx.onReceiptError(new Error(receipt.error || "transaction reverted"));
        }
      })
      .catch((err: unknown) => {
        tx.onReceiptError(err instanceof Error ? err : new Error(String(err)));
      });

    return tx;
  }

  // -------------------------------------------------------------------------
  // execute — v0.6 lines 336-454 (core execution)
  // -------------------------------------------------------------------------

  private execute = async (tx: Transaction): Promise<void> => {
    let time_called: number | undefined;
    let error: Error | undefined;
    let time_submitted: number | undefined;
    let time_confirmed: number | undefined;
    let time_errored: number | undefined;
    let tx_hash: string | undefined;

    const time_exec_called = Date.now();
    const MAX_RETRIES = 1;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          console.warn(
            `[TxExecutor] retrying tx ${tx.id} after revert (attempt ${attempt + 1})`
          );
        }

        // 1. Processing
        tx.state = "Processing";

        if (this.beforeTransaction) {
          await this.beforeTransaction(tx);
        }

        // 2. Resolve full contract args from indexer state + config + timestamp
        const contractArgs = await this.stateResolver.resolve(tx.intent);

        // 3. Get contract + method
        const { contract, method } = this.contractResolver.resolve(
          tx.intent.methodName
        );

        time_called = Date.now();

        // 4. Build send options
        const sendOpts = {
          from: this.walletManager.getActiveAddress()!,
          fee: {
            paymentMethod: new SponsoredFeePaymentMethod(
              this.walletManager.getSponsoredFpcAddress()
            ),
          },
          wait: NO_WAIT,
        };

        // 5. Submit — send({ wait: NO_WAIT }) returns TxHash immediately
        //    v0.6 equivalent: tx.intent.contract[tx.intent.methodName](...args, opts)
        const methodFn = (
          contract.methods as Record<
            string,
            (...a: unknown[]) => {
              send: (o: unknown) => Promise<TxHash>;
              simulate: (o: unknown) => Promise<unknown>;
            }
          >
        )[method];
        const invocation = methodFn(...contractArgs);

        if (
          tx.intent.methodName === "initializePlayer" ||
          tx.intent.methodName === "revealLocation" ||
          tx.intent.methodName === "move"
        ) {
          try {
            console.debug(
              `[TxExecutor] simulating ${tx.intent.methodName} (tx ${tx.id})...`
            );
            console.debug(
              `[TxExecutor] contractArgs (${contractArgs.length}):`,
              contractArgs
            );
            const simResult = await invocation.simulate(sendOpts);
            console.debug(
              `[TxExecutor] simulate ${tx.intent.methodName} OK, result:`,
              simResult
            );

            console.log(simResult);
          } catch (simErr) {
            console.error(
              `[TxExecutor] simulate ${tx.intent.methodName} FAILED:`,
              simErr
            );
            if (simErr instanceof Error) {
              console.error(`[TxExecutor] error message:`, simErr.message);
              console.error(`[TxExecutor] error stack:`, simErr.stack);
              if ("cause" in simErr) {
                console.error(`[TxExecutor] error cause:`, simErr.cause);
              }
            }
            throw simErr;
          }
        }

        const submitted: TxHash = await timeout(
          invocation.send(sendOpts),
          TX_SUBMIT_TIMEOUT,
          `tx request ${tx.id} failed to submit: timed out`
        );

        // 6. Submit state — v0.6 lines 376-383
        tx.state = "Submit";
        tx.hash = submitted;
        time_submitted = Date.now();
        tx.lastUpdatedAt = time_submitted;
        tx_hash = submitted.toString();
        tx.onTransactionResponse(submitted);

        // 7. Wait for confirmation — v0.6 line 385
        //    Aztec equivalent of ethConnection.waitForTransaction(hash)
        const receipt = await waitForTx(this.node, submitted, {
          timeout: 120,
          dontThrowOnRevert: true,
        });

        // 8. Check result — v0.6 lines 386-397
        if (receipt.hasExecutionReverted() || receipt.isDropped()) {
          time_errored = Date.now();
          tx.lastUpdatedAt = time_errored;
          tx.state = "Fail";
          const reason = receipt.error || "transaction reverted";
          console.error(
            `[TxExecutor] tx ${tx.id} (${tx.intent.methodName}) reverted:`,
            reason
          );
          console.error(
            "[TxExecutor] receipt:",
            JSON.stringify({
              blockNumber: receipt.blockNumber,
              error: receipt.error,
              status: receipt.status,
            })
          );
          if (attempt < MAX_RETRIES) {
            const latestBlock = receipt.blockNumber ?? 0;
            if (latestBlock > 0) {
              this.stateResolver.setLastConfirmedBlock(latestBlock);
            }
            continue;
          }
          throw new Error(reason);
        }

        tx.state = "Confirm";
        time_confirmed = Date.now();
        tx.lastUpdatedAt = time_confirmed;
        if (receipt.blockNumber != null) {
          this.stateResolver.setLastConfirmedBlock(receipt.blockNumber);
        }
        tx.onReceipt(receipt);
        break;
      }
    } catch (e) {
      // 9. Error handling — v0.6 lines 398-415
      console.error(e);
      tx.state = "Fail";
      error = e as Error;

      if (!time_submitted) {
        // Error before submission
        time_errored = Date.now();
        tx.onSubmissionError(error);
      } else {
        // Error after submission (receipt error)
        if (!time_errored) {
          time_errored = Date.now();
        }
        tx.lastUpdatedAt = time_errored;
        tx.onReceiptError(error);
      }
    } finally {
      this.diagnosticsUpdater?.updateDiagnostics((d) => {
        d.totalTransactions++;
      });
    }

    // 10. Metrics — v0.6 lines 422-453
    const logEvent = {
      tx_type: tx.intent.methodName,
      time_exec_called,
      tx_hash,
      wait_submit:
        time_called && time_submitted
          ? time_submitted - time_called
          : undefined,
      wait_confirm:
        time_called && time_confirmed
          ? time_confirmed - time_called
          : undefined,
      wait_error:
        error && time_errored ? time_errored - time_exec_called : undefined,
      error: error?.message,
    };

    this.afterTransaction?.(tx, logEvent);
  };

  // -------------------------------------------------------------------------
  // Utility — v0.6 lines 328-330, 456-458
  // -------------------------------------------------------------------------

  private nextId(): TransactionId {
    return ++this.idSequence;
  }

  setDiagnosticUpdater(updater?: DiagnosticUpdater): void {
    this.diagnosticsUpdater = updater;
  }

  getQueueSize(): number {
    return this.queue.size();
  }

  destroy(): void {
    this.queue.destroy();
  }
}
