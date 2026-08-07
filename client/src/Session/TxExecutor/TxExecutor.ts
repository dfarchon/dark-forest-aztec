/**
 * TxExecutor: strict port of darkforest-v0.6/packages/network/src/TxExecutor.ts
 * adapted for Aztec Network.
 *
 * Lifecycle: Init → Processing → Submit → Confirm/Fail/Cancel
 *
 * Key differences from v0.6:
 *   - No nonce/gas management (Aztec handles internally)
 *   - Uses FeeJuice paid by the user account
 *   - send({ wait: NO_WAIT }) → TxHash, then waitForTx() for receipt
 *   - StateResolver assembles full contract args from indexer state
 *   - ContractResolver maps methodName to Aztec contract + method
 */

import type { AztecAddress } from "@aztec/aztec.js/addresses";
import {
  type ContractMethod,
  NO_WAIT,
  type NoWait,
  type SendInteractionOptions,
} from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import type { AztecNode } from "@aztec/aztec.js/node";
import { waitForTx } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { type TxHash, type TxReceipt, TxStatus } from "@aztec/stdlib/tx";
import type {
  PersistedTransaction,
  Transaction,
  TransactionId,
  TxIntent,
} from "@dfpunk/types";
import { unwrapSimulateResult } from "@dfpunk/utils";

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import { getEffectiveUseSponsoredFpc } from "../../config/connection";
import {
  getAccountMinBalanceFjWei,
  getSponsoredFpcMinBalanceFjWei,
} from "../../config/env";
import { NotificationType } from "../../Frontend/Game/NotificationManager";
import { formatFeeJuiceWei } from "../../utils/feeJuiceUnits";
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

/**
 * True only for failures that cannot have left a transaction in flight.
 *
 * The dangerous case is a send that reached the sequencer while the response
 * was lost: rebuilding then replays the player's action under a new nonce.
 * So this allow-lists the reasons known to arise BEFORE broadcast — the
 * paymaster refusing to sponsor, and the allowance still syncing — rather than
 * trying to enumerate everything unsafe.
 */
function isProvablyPreBroadcast(err: unknown): boolean {
  if ((err as { name?: string })?.name === "QuotaUnavailableError") {
    // Raised by our own pre-flight, before anything is built or sent.
    return true;
  }
  const message = String((err as { message?: string })?.message ?? err ?? "");
  // Rejections raised while proving or by the node's admission checks — in
  // every one of these the transaction was refused, not accepted.
  //
  // `Existing nullifier` is deliberately NOT in this set, though it is tempting:
  // it is raised by the node, not by proving, and precisely BECAUSE some other
  // transaction got there first. That other transaction may be an earlier,
  // ambiguous attempt at THIS move — from a reload, a second device, or another
  // executor instance. A local send queue cannot rule any of that out, so the
  // conflict is not evidence that this move was never broadcast, and self-paying
  // after it could replay the move.
  // `Invalid tx: …` is the node's own rejection, raised by `isValidTx` BEFORE
  // the transaction reaches the pool — so it proves the transaction was never
  // admitted. It covers the two failures players actually hit: the paymaster
  // sitting below the sequencer's reserve, and gas settings the node refuses.
  //
  // This is only sound because the sponsored send goes through a NON-RETRYING
  // client (see WalletManager.sendOnce). With retries, this same string could
  // be the answer to a second attempt while the first sits accepted in the
  // mempool, and falling back would replay the player's move.
  if (/Invalid tx:/i.test(message)) {
    // …except a nullifier conflict, which reports only "some nullifier
    // exists", never which one. It may be someone else taking the same seat
    // (safe) or this player's own move already in flight (not safe), and the
    // message cannot tell them apart.
    return !/Existing nullifier/i.test(message);
  }

  return (
    /Gas settings exceed the sponsorship allowance/i.test(message) ||
    /Invalid expiration timestamp/i.test(message) ||
    /No sponsorship seats available/i.test(message) ||
    /seat no longer within capacity/i.test(message) ||
    /No sponsored transactions remaining/i.test(message) ||
    /account class is not sponsored/i.test(message) ||
    /non-allowlisted contract/i.test(message) ||
    /Sponsorship covers up to/i.test(message)
  );
}

/**
 * Whether re-attempting is both SAFE and USEFUL.
 *
 * Safety is `isProvablyPreBroadcast` — anything else may already be in flight,
 * and rebuilding would replay the player's move. Usefulness is narrower still:
 * only a wallet that was mid-sync has any prospect of succeeding second time.
 */
function isRetryableBeforeBroadcast(err: unknown): boolean {
  if (!isProvablyPreBroadcast(err)) return false;
  if ((err as { name?: string })?.name === "QuotaUnavailableError") {
    return Boolean((err as { retryable?: boolean }).retryable);
  }
  return /Invalid expiration timestamp/i.test(
    String((err as { message?: string })?.message ?? err ?? "")
  );
}

/**
 * Verbose sponsorship diagnostics, off unless VITE_QUOTA_DEBUG is set.
 *
 * Exists for capture sessions against a real network: the interesting facts —
 * which path a transaction took, what the paymaster's allowance said, what the
 * fee actually was — are otherwise invisible, and a screen recording of the
 * game shows none of them.
 */
function quotaLog(event: string, detail?: unknown): void {
  try {
    if (!import.meta.env?.VITE_QUOTA_DEBUG) return;

    console.log(
      `%c[quota] ${event}`,
      "color:#e0a642;font-weight:bold",
      detail ?? ""
    );
  } catch {
    /* diagnostics must never affect the transaction path */
  }
}

const TX_SUBMIT_TIMEOUT = 300_000; // 5 minutes (includes ClientIVC proof generation)

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

  private readonly chainClock: ChainClock;
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
    this.chainClock = chainClock;
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
      waitForStatus: TxStatus.PROPOSED,
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

        // 4. Build send options (explicit SendInteractionOptions<NoWait> so send() resolves to TxSendResultImmediate)
        //
        // Quota mode note: when a QuotaFpc paymaster is configured, sponsored
        // transactions do not go through this path at all — they are assembled
        // with the paymaster as the transaction origin so the game still sees
        // the player as msg_sender (see @dfpunk/quota-fpc). That assembly lands
        // with the UI work; until then a configured paymaster is registered with
        // the wallet but transactions continue to use the paths below, so the
        // game behaves exactly as it does today.
        //
        // Sponsored path: when a paymaster is configured and the player still
        // has allowance, the transaction is assembled with the PAYMASTER as its
        // origin (see @dfpunk/quota-fpc). Any failure here falls through to the
        // normal paths below rather than blocking the move — a player who can
        // pay their own way must never be stopped because sponsorship lapsed.
        let sponsoredSubmission: TxHash | undefined;
        const quotaFpcAddress = this.walletManager.getQuotaFpcAddress();
        const activeAddress = this.walletManager.getActiveAddress();
        if (quotaFpcAddress && activeAddress) {
          try {
            const sponsoredHash = await this.trySponsoredSend(
              contract,
              method,
              contractArgs,
              quotaFpcAddress,
              activeAddress
            );
            sponsoredSubmission = sponsoredHash;
            quotaLog("SPONSORED ✓ submitted", {
              txHash: String(sponsoredHash),
              method,
              paymaster: quotaFpcAddress,
              player: String(activeAddress),
            });
            // The fee the PAYMASTER actually paid — the number that matters
            // for budgeting, and only knowable after inclusion.
            void waitForTx(this.node, sponsoredHash as never)
              .then((r) => {
                const fee = (r as { transactionFee?: bigint })?.transactionFee;
                quotaLog("SPONSORED ✓ settled", {
                  txHash: String(sponsoredHash),
                  feeWei: fee?.toString(),
                  feeJuice: fee ? Number(fee) / 1e18 : undefined,
                  status: (r as { status?: string })?.status,
                });
              })
              .catch(() => undefined);
          } catch (err) {
            // Retry ONLY when the failure provably happened before anything
            // was broadcast. A blanket retry is unsafe: if sendTx reached the
            // node but its response was lost, rebuilding produces a second
            // transaction with a fresh nonce — replaying the player's move and
            // burning a second allowance. Losing sponsorship is recoverable;
            // moving twice is not.
            if (isRetryableBeforeBroadcast(err)) {
              try {
                sponsoredSubmission = await this.trySponsoredSend(
                  contract,
                  method,
                  contractArgs,
                  quotaFpcAddress,
                  activeAddress
                );
              } catch (retryErr) {
                // The retry itself may now be ambiguous. Same rule applies.
                if (!isProvablyPreBroadcast(retryErr)) {
                  throw new Error(
                    "Sponsored transaction status unknown — not retrying or " +
                      "self-paying, because it may already have been submitted. " +
                      "Check your recent moves before trying again.",
                    { cause: retryErr }
                  );
                }
                await this.notifySponsorshipFallback(retryErr ?? err);
              }
            } else if (!isProvablyPreBroadcast(err)) {
              // Could not prove nothing was sent. Falling through to the
              // ordinary self-paid send would replay the move — sponsored
              // first, then paid for again. Failing loudly is the safe answer.
              throw new Error(
                "Sponsored transaction status unknown — not self-paying, " +
                  "because the move may already have been submitted. " +
                  "Check your recent moves before trying again.",
                { cause: err }
              );
            } else {
              // Falling back means the PLAYER pays. That must never be silent:
              // before this, the only trace was a console.debug.
              await this.notifySponsorshipFallback(err);
            }
          }
        }
        // Legacy SponsoredFPC path — now user-toggleable via Connection
        // settings (origin/main). Irrelevant when the quota paymaster already
        // broadcast: that transaction is out and paid for, and the balance
        // checks below would reject it for a balance it never needed.
        const useSponsoredFpc = sponsoredSubmission
          ? false
          : getEffectiveUseSponsoredFpc();
        const sponsoredFpcAddress = useSponsoredFpc
          ? this.walletManager.getSponsoredFpcAddress()
          : undefined;
        if (sponsoredSubmission) {
          // fall through to the shared submit/confirm handling
        } else if (useSponsoredFpc) {
          if (!sponsoredFpcAddress) {
            throw new Error(
              "[TxExecutor] SponsoredFPC payment is selected, but no SponsoredFPC is registered. Check Connection settings and refresh the page."
            );
          }
          const sponsorFjBal =
            await this.walletManager.getSponsoredFpcFeeJuiceBalance();
          const minWei = getSponsoredFpcMinBalanceFjWei();
          if (sponsorFjBal === undefined || sponsorFjBal < minWei) {
            throw new Error(
              `[TxExecutor] SponsoredFPC at ${sponsoredFpcAddress.toString()} FeeJuice balance is below minimum (${minWei.toString()} wei units). Fund SponsoredFPC or change SponsoredFPC address in Connection settings and refresh the page.`
            );
          }
        } else {
          const activeAddr = this.walletManager.getActiveAddress();
          const minAccountFj = getAccountMinBalanceFjWei();
          if (activeAddr) {
            let bal: bigint;
            try {
              bal = await getFeeJuiceBalance(activeAddr, this.node);
            } catch (e) {
              throw new Error(
                `[TxExecutor] Could not verify account FeeJuice balance: ${
                  e instanceof Error ? e.message : String(e)
                }`
              );
            }

            if (bal < minAccountFj) {
              throw new Error(
                `[TxExecutor] Account FeeJuice balance (${formatFeeJuiceWei(bal)}) is below minimum (${formatFeeJuiceWei(minAccountFj)}). Bridge FeeJuice before sending transactions.`
              );
            }
          }
        }
        const sendOptsNoWait = useSponsoredFpc
          ? ({
              from: this.walletManager.getActiveAddress()!,
              fee: {
                paymentMethod: new SponsoredFeePaymentMethod(
                  sponsoredFpcAddress!
                ),
              },
              wait: NO_WAIT,
            } satisfies SendInteractionOptions<NoWait>)
          : ({
              from: this.walletManager.getActiveAddress()!,
              wait: NO_WAIT,
            } satisfies SendInteractionOptions<NoWait>);
        const simulateOpts = {
          from: sendOptsNoWait.from,
          fee: sendOptsNoWait.fee,
        };

        // 5. Submit — send({ wait: NO_WAIT }) returns TxSendResultImmediate (txHash + offchain output)
        //    v0.6 equivalent: tx.intent.contract[tx.intent.methodName](...args, opts)
        const methodFn = contract.methods[method] as ContractMethod | undefined;
        if (methodFn === undefined) {
          throw new Error(`[TxExecutor] unknown contract method: ${method}`);
        }
        const invocation = methodFn(...contractArgs);

        // A sponsored transaction has already been assembled, proven and sent
        // by the paymaster path above; simulating or sending it again here
        // would duplicate the work and the transaction.
        if (!sponsoredSubmission) {
          try {
            console.debug(
              `[TxExecutor] simulating ${tx.intent.methodName} (tx ${tx.id})...`
            );
            console.debug(
              `[TxExecutor] contractArgs (${contractArgs.length}):`,
              contractArgs
            );
            const simResult = unwrapSimulateResult(
              await invocation.simulate(simulateOpts)
            );
            console.debug(
              `[TxExecutor] simulate ${tx.intent.methodName} OK, result:`,
              simResult
            );
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

        const submitted: TxHash =
          sponsoredSubmission ??
          (
            (await timeout(
              invocation.send(sendOptsNoWait),
              TX_SUBMIT_TIMEOUT,
              `tx request ${tx.id} failed to submit: timed out`
            )) as unknown as { txHash: TxHash }
          ).txHash;

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
          waitForStatus: TxStatus.PROPOSED,
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
          // A sponsored transaction that was INCLUDED and then reverted has
          // already charged the paymaster and consumed one of the player's free
          // transactions. Retrying would burn a second one, and would leave the
          // submitted/confirmed promises naming different transactions.
          if (attempt < MAX_RETRIES && !sponsoredSubmission) {
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
      error = e instanceof Error ? e : new Error(String(e));

      if (!time_submitted) {
        // Error before submission (resolve/simulate/send setup) — reject both
        // promises so callers awaiting only confirmedPromise still get the error.
        time_errored = Date.now();
        tx.onSubmissionError(error);
        tx.onReceiptError(error);
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

  /**
   * Attempts to send `method` sponsored by the paymaster, returning the tx hash
   * on success or `undefined` when sponsorship is not available right now.
   *
   * Returning `undefined` rather than throwing is the point: an exhausted
   * allowance, a busy network, or a missing paymaster are all ordinary states
   * that should quietly fall back to the player paying, not errors that stop a
   * move.
   */
  /**
   * Tells the player, in plain language, that this transaction is coming out
   * of their own gas rather than being sponsored.
   *
   * Sponsorship can stop for several reasons the player cannot see — their
   * daily allowance ran out, the operator narrowed the policy, network fees
   * outran the paymaster's ceiling. Whatever the cause, being charged without
   * being told is the one outcome that is never acceptable, so this is
   * best-effort but unconditional: it never rethrows, because failing to show
   * a notice must not also fail the transaction.
   */
  private async notifySponsorshipFallback(err: unknown): Promise<void> {
    try {
      const message = String(
        (err as { message?: string })?.message ?? err ?? ""
      );
      const [{ reasonFromRevert, describeQuotaUnavailable }, NotificationMod] =
        await Promise.all([
          import("@dfpunk/quota-fpc"),
          import("../../Frontend/Game/NotificationManager"),
        ]);
      // NotificationType is a `const enum`: it is erased at compile time, so
      // it must come from the STATIC import above — reading it off the dynamic
      // module object yields undefined at runtime.
      const reason = reasonFromRevert(message);
      const copy = reason
        ? describeQuotaUnavailable(reason, {})
        : {
            headline:
              "This move wasn't sponsored, so it's coming out of your own gas.",
            detail: undefined,
          };
      quotaLog("NOT sponsored — player pays", {
        reason: reason ?? "unknown",
        message: message.slice(0, 200),
      });
      const NotificationManager = NotificationMod.default;
      NotificationManager.getInstance().notify(
        NotificationType.TxInitError,
        `${copy.headline}${copy.detail ? ` ${copy.detail}` : ""}`
      );
      console.debug("[TxExecutor] sponsorship unavailable:", message);
    } catch (notifyErr) {
      // Never let the notice itself break the transaction path.
      console.debug(
        "[TxExecutor] could not surface fallback notice:",
        notifyErr
      );
    }
  }

  private async trySponsoredSend(
    contract: { methods: Record<string, ContractMethod> },
    method: string,
    contractArgs: unknown[],
    quotaFpcAddress: AztecAddress,
    player: AztecAddress
  ): Promise<TxHash | undefined> {
    const [{ buildSandwichPayload, generationAt, resolveFeeSource }, quotaFpc] =
      await Promise.all([
        import("@dfpunk/quota-fpc"),
        this.walletManager.getQuotaFpcContract(),
      ]);
    if (!quotaFpc) return undefined;

    const chainSeconds = BigInt(this.chainClock.nowSec());
    const generation = generationAt(chainSeconds);
    const state = await this.walletManager.readQuotaAllowance(
      quotaFpc,
      player,
      generation
    );

    // Surface it so the top bar shows what this transaction actually saw.
    const { publishQuotaStatus, quotaStatusFromAllowance } =
      await import("../QuotaStatus");
    publishQuotaStatus(quotaStatusFromAllowance(state, chainSeconds));

    const source = await resolveFeeSource({
      state,
      chainTimestampSeconds: chainSeconds,
      findFreeSeat: () =>
        this.walletManager.findQuotaSeat(quotaFpc, generation),
      ownBalance: 0n,
      // Self-pay is handled by the caller's existing paths, so this decision is
      // only ever "sponsored or not".
      minSelfPayBalance: 1n,
      paymasterBalance: await getFeeJuiceBalance(quotaFpcAddress, this.node),
      minPaymasterBalance: 1n,
    });

    quotaLog("allowance read", {
      generation,
      state,
      decision: source.kind,
    });

    if (source.kind !== "sponsored" && source.kind !== "sponsored-first") {
      // The COMMON case — allowance spent, no seats left, paymaster empty,
      // mid-rollover, wallet still syncing. Returning undefined here used to
      // skip the fallback notice entirely, so the very situation players hit
      // most often was the one that charged them without a word. Throw the
      // typed reason instead, so the caller can explain it.
      const { QuotaUnavailableError } = await import("@dfpunk/quota-fpc");
      // The reason lives on the `blocked` variant, not on `kind` — comparing
      // `kind` against reason names silently collapsed every cause into one
      // and meant a still-syncing wallet was never retried.
      const reason =
        source.kind === "blocked" ? source.reason : "paymaster-empty";
      throw new QuotaUnavailableError(
        reason,
        `Sponsorship unavailable: ${reason}`,
        // Only a wallet still catching up is worth retrying; the rest are
        // settled facts a fresh anchor will not change.
        reason === "sync-pending"
      );
    }

    const methodFn = contract.methods[method];
    const requested = await methodFn(...(contractArgs as never[])).request();
    const calls = (requested as { calls?: unknown[] }).calls ?? requested;

    const payload = await buildSandwichPayload(
      {
        calls: calls as never,
        player,
        fpcAddress: quotaFpcAddress,
        generation,
        seat: source.kind === "sponsored-first" ? source.seat : undefined,
      },
      this.walletManager.getWallet() as never,
      quotaFpc as never
    );

    return await this.walletManager.sendFromQuotaPaymaster(payload, player);
  }

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
