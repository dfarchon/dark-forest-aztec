import type { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import type { ContractMethod } from "@aztec-labs/aztec.js/contracts";
import type { TxHash } from "@aztec-labs/stdlib/tx";

import type { WalletManager } from "../WalletManager/WalletManager";

/** Game adapter; all paymaster-specific proof and gas logic lives in the SDK. */
export class SponsoredFpcSender {
  constructor(private readonly walletManager: WalletManager) {}

  async send(
    contract: { methods: Record<string, ContractMethod> },
    method: string,
    contractArgs: unknown[],
    player: AztecAddress
  ): Promise<TxHash> {
    const client = this.walletManager.getSponsoredFpcClient();
    if (!client) throw new Error("Sponsored FPC is not configured");
    return client.sendMethod({
      contract,
      method,
      args: contractArgs,
      player,
    });
  }
}
