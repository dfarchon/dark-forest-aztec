import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractMethod } from "@aztec/aztec.js/contracts";
import { Fr } from "@aztec/aztec.js/fields";
import { EncodedAppEntrypointCalls } from "@aztec/entrypoints/encoding";
import { ExecutionPayload, type TxHash } from "@aztec/stdlib/tx";

import type { WalletManager } from "../WalletManager/WalletManager";

const ACCOUNT_MAX_CALLS = 5;

/** Builds and submits the payload understood by the in-repo SponsoredFpc. */
export class SponsoredFpcSender {
  constructor(private readonly walletManager: WalletManager) {}

  async send(
    contract: { methods: Record<string, ContractMethod> },
    method: string,
    contractArgs: unknown[],
    fpcAddress: AztecAddress,
    player: AztecAddress
  ): Promise<TxHash | undefined> {
    const fpc = await this.walletManager.getProjectSponsoredFpcContract();
    if (!fpc) return undefined;

    const requested = await contract.methods[method](
      ...(contractArgs as never[])
    ).request();
    const calls = ((requested as { calls?: unknown[] }).calls ??
      requested) as never[];
    if (calls.length === 0 || calls.length > ACCOUNT_MAX_CALLS) {
      throw new Error(
        `A sponsored transaction needs 1-${ACCOUNT_MAX_CALLS} calls; got ${calls.length}`
      );
    }
    const encodedCalls = await EncodedAppEntrypointCalls.create(
      calls,
      Fr.random()
    );
    const authWitness = await this.walletManager
      .getWallet()
      .createAuthWit(player, {
        consumer: player,
        innerHash: await encodedCalls.hash(),
      });
    const interaction = (
      fpc as {
        methods: {
          sponsor_and_execute: (
            payload: unknown,
            account: AztecAddress
          ) => { request(): Promise<ExecutionPayload> };
        };
      }
    ).methods.sponsor_and_execute(encodedCalls, player);
    const outer = await interaction.request();
    const payload = new ExecutionPayload(
      outer.calls,
      [authWitness, ...outer.authWitnesses],
      [...outer.capsules],
      [...encodedCalls.hashedArguments, ...outer.extraHashedArgs],
      fpcAddress
    );
    return this.walletManager.sendFromSponsoredFpc(payload, player);
  }
}
