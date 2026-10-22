import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractMethod } from "@aztec/aztec.js/contracts";
import type { AztecNode } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import type { TxHash } from "@aztec/stdlib/tx";

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import type { WalletManager } from "../WalletManager/WalletManager";

export interface QuotaAttempt {
  player: string;
  subscribed: boolean;
  remaining: number;
  reason?: string;
  chainSeconds: bigint;
}

function debug(event: string, detail?: unknown): void {
  if (import.meta.env?.VITE_QUOTA_DEBUG)
    console.log(`[quota] ${event}`, detail ?? "");
}

/** Owns all QuotaFpc-specific payload construction and submission details. */
export class QuotaPaymasterSender {
  private lastAttempt?: QuotaAttempt;

  constructor(
    private readonly walletManager: WalletManager,
    private readonly node: AztecNode,
    private readonly chainClock: ChainClock
  ) {}

  getLastAttempt(): QuotaAttempt | undefined {
    return this.lastAttempt;
  }

  async send(
    contract: { methods: Record<string, ContractMethod> },
    method: string,
    contractArgs: unknown[],
    quotaFpcAddress: AztecAddress,
    player: AztecAddress
  ): Promise<TxHash | undefined> {
    const [{ buildSandwichPayload, generationAt, resolveFeeSource }, quotaFpc] =
      await Promise.all([
        import("@alejoamiras/quota-paymaster"),
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
    const { publishQuotaStatus, quotaStatusFromAllowance } =
      await import("../QuotaStatus");
    publishQuotaStatus(quotaStatusFromAllowance(state, chainSeconds));

    const source = await resolveFeeSource({
      state,
      chainTimestampSeconds: chainSeconds,
      onSyncing: "wait",
      findFreeSeat: () =>
        this.walletManager.findQuotaSeat(quotaFpc, generation),
      ownBalance: 0n,
      minSelfPayBalance: 1n,
      paymasterBalance: await getFeeJuiceBalance(quotaFpcAddress, this.node),
      minPaymasterBalance: 1n,
    });
    debug("allowance read", { generation, state, decision: source.kind });
    this.lastAttempt = {
      player: String(player),
      subscribed: state.subscribed,
      remaining: state.remaining,
      reason: source.kind === "blocked" ? source.reason : undefined,
      chainSeconds,
    };

    if (source.kind !== "sponsored" && source.kind !== "sponsored-first") {
      const { QuotaUnavailableError } =
        await import("@alejoamiras/quota-paymaster");
      const reason =
        source.kind === "blocked" ? source.reason : "paymaster-empty";
      throw new QuotaUnavailableError(
        reason,
        `Sponsorship unavailable: ${reason}`,
        reason === "sync-pending"
      );
    }

    const requested = await contract.methods[method](
      ...(contractArgs as never[])
    ).request();
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
    const txHash = await this.walletManager.sendFromQuotaPaymaster(
      payload,
      player
    );

    if (source.kind === "sponsored" && state.subscribed) {
      void this.refreshAllowance(quotaFpc, player, generation, state.remaining);
    }
    return txHash;
  }

  private async refreshAllowance(
    quotaFpc: unknown,
    player: AztecAddress,
    generation: number,
    previousRemaining: number
  ): Promise<void> {
    try {
      const { awaitAllowanceTransition } =
        await import("@alejoamiras/quota-paymaster");
      const observed = await awaitAllowanceTransition({
        generation,
        readState: async () => {
          const state = await this.walletManager.readQuotaAllowance(
            quotaFpc,
            player,
            generation
          );
          return { subscribed: state.subscribed, remaining: state.remaining };
        },
        expectedRemaining: Math.max(0, previousRemaining - 1),
        observedSubscribedBefore: true,
      });
      const { publishQuotaStatus, quotaStatusFromAllowance } =
        await import("../QuotaStatus");
      publishQuotaStatus(
        quotaStatusFromAllowance(observed, BigInt(this.chainClock.nowSec()))
      );
    } catch {
      // Status refresh is advisory and must not affect an included transaction.
    }
  }
}
