import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractMethod } from "@aztec/aztec.js/contracts";
import type { TxHash } from "@aztec/stdlib/tx";

import type { WalletManager } from "../WalletManager/WalletManager";

/** Thin game adapter; payload/proof/fee details live in @dfarchon/sponsored-fpc. */
export class SponsoredFpcSender {
  constructor(private readonly walletManager: WalletManager) {}

  async send(
    contract: { methods: Record<string, ContractMethod> },
    method: string,
    contractArgs: unknown[],
    fpcAddress: AztecAddress,
    player: AztecAddress
  ): Promise<TxHash | undefined> {
    const client = this.walletManager.getProjectSponsoredFpcClient();
    if (!client || !client.address.equals(fpcAddress)) return undefined;
    return client.sendMethod({
      contract,
      method,
      args: contractArgs,
      player,
    });
  }
}
