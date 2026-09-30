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
  to?: string | null;
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

// Thrown by a submitter only when the deposit transaction was never broadcast,
// so the prepared secret can be archived instead of blocking later deposits.
export class DepositNotSentError extends Error {
  constructor(cause: unknown) {
    super(
      `Deposit was not sent: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "DepositNotSentError";
  }
}

function isRevertedDeposit(
  deposit: PreparedDeposit,
  receipt: DepositReceipt,
): boolean {
  return (
    receipt.status === "reverted" &&
    receipt.from.toLowerCase() === deposit.l1Address.toLowerCase() &&
    receipt.to?.toLowerCase() === deposit.portalAddress.toLowerCase()
  );
}

export async function executeDeposit(
  store: ClaimStore,
  deposit: PreparedDeposit,
  submit: () => Promise<DepositReceipt>,
): Promise<void> {
  // Do not send even the approval until the secret has been flushed to disk.
  store.prepareDeposit(deposit);
  let receipt: DepositReceipt;
  try {
    receipt = await submit();
  } catch (error) {
    if (error instanceof DepositNotSentError) store.discardDeposit(deposit);
    throw error;
  }
  // A mined revert of the deposit itself is final; anything else stays pending.
  if (isRevertedDeposit(deposit, receipt)) {
    store.discardDeposit(deposit);
    throw new Error(
      `Deposit transaction ${receipt.transactionHash} reverted. No Fee Juice was bridged.`,
    );
  }
  store.completeDeposit(claimFromReceipt(deposit, receipt));
}
