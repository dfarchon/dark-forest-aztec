import type { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import type { Aliased, Wallet } from "@aztec-labs/aztec.js/wallet";

import { resolveExternalWalletCapabilities } from "./capabilityValidation";

export async function requestGrantedAccounts(
  wallet: Wallet
): Promise<Aliased<AztecAddress>[]> {
  const { accounts } = await resolveExternalWalletCapabilities(wallet);
  return accounts;
}
