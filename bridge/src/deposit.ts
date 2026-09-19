import { FeeJuicePortalAbi } from "@aztec/l1-artifacts/FeeJuicePortalAbi";
import { decodeEventLog, type Hex } from "viem";

import {
  ClaimStore,
  type PendingClaim,
  type PreparedDeposit,
} from "./claim-store.js";

type DepositReceipt = {
  status: string;
  transactionHash: string;
  from: string;
  logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[];
};

// Used both on normal completion and when recovering after an interrupted CLI.
export function claimFromReceipt(
  deposit: PreparedDeposit,
  receipt: DepositReceipt,
): PendingClaim {
  if (
    receipt.status !== "success" ||
    receipt.from.toLowerCase() !== deposit.l1Address.toLowerCase()
  ) {
    throw new Error(
      "Receipt is not a successful transaction from the prepared L1 wallet.",
    );
  }
  const matches = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== deposit.portalAddress.toLowerCase())
      return [];
    try {
      const event = decodeEventLog({
        abi: FeeJuicePortalAbi,
        eventName: "DepositToAztecPublic",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: true,
      });
      const args = event.args;
      return args.to.toLowerCase() === deposit.recipient.toLowerCase() &&
        args.secretHash.toLowerCase() ===
          deposit.claimSecretHash.toLowerCase() &&
        args.amount === BigInt(deposit.claimAmount)
        ? [args]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1)
    throw new Error(
      "Receipt must contain exactly one matching Fee Juice deposit.",
    );
  return {
    recipient: deposit.recipient,
    claimAmount: deposit.claimAmount,
    claimSecret: deposit.claimSecret,
    messageHash: matches[0].key,
    messageLeafIndex: matches[0].index.toString(),
    depositedAt: deposit.preparedAt,
    l1TransactionHash: receipt.transactionHash,
  };
}

export async function executeDeposit(
  store: ClaimStore,
  deposit: PreparedDeposit,
  submit: () => Promise<DepositReceipt>,
): Promise<void> {
  // Do not send even the approval until the secret has been flushed to disk.
  store.prepareDeposit(deposit);
  const receipt = await submit();
  store.completeDeposit(claimFromReceipt(deposit, receipt));
}
