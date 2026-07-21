import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { FeeJuicePortalAbi } from "@aztec/l1-artifacts/FeeJuicePortalAbi";
import { TestERC20Abi } from "@aztec/l1-artifacts/TestERC20Abi";
import {
  formatEther,
  formatUnits,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { loadConfig } from "./config.js";
import { getOrCreateL1Wallet } from "./l1-wallet.js";

export type FundingQuote = {
  recipient: string;
  amount: bigint;
  decimals: number;
  tokenAddress: Address;
  portalAddress: Address;
  l1Address: Address;
  l1EthBalance: bigint;
  l1TokenBalance: bigint;
  allowance: bigint;
  approvalNeeded: boolean;
  approvalGas: bigint;
  depositGas: bigint;
  feePerGas: bigint;
  minimumEth: bigint;
  gasBufferPercent: bigint;
};

// Conservative upper bound for `depositToAztecPublic`, used only when the
// wallet is not yet funded and the deposit cannot be simulated on-chain.
const DEFAULT_DEPOSIT_GAS = 200_000n;

export function parseAmount(amount: string, decimals = 18): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error("--amount must be a positive decimal value.");
  }
  const parsed = parseUnits(amount, decimals);
  if (parsed <= 0n)
    throw new Error("--amount must be a positive decimal value.");
  return parsed;
}

export function calculateMinimumEth(
  approvalGas: bigint,
  depositGas: bigint,
  feePerGas: bigint,
  bufferPercent: bigint,
): bigint {
  return (
    ((approvalGas + depositGas) * feePerGas * (100n + bufferPercent)) / 100n
  );
}

export async function quoteFunding(
  recipient: string,
  amountText: string,
): Promise<FundingQuote> {
  const config = loadConfig();
  const node = createAztecNodeClient(config.aztecNodeUrl);
  const wallet = getOrCreateL1Wallet();
  const chainId = await wallet.publicClient.getChainId();
  if (chainId !== 1) {
    throw new Error(
      `Expected Ethereum mainnet (chain ID 1), received chain ID ${chainId}. Refusing to bridge.`,
    );
  }

  const info = await node.getNodeInfo();
  if (info.l1ChainId !== 1) {
    throw new Error(
      `Aztec node is connected to L1 chain ID ${info.l1ChainId}, not Ethereum mainnet.`,
    );
  }
  const tokenAddress =
    info.l1ContractAddresses.feeJuiceAddress.toString() as Address;
  const portalAddress =
    info.l1ContractAddresses.feeJuicePortalAddress.toString() as Address;
  if (
    info.l1ContractAddresses.feeJuiceAddress.isZero() ||
    info.l1ContractAddresses.feeJuicePortalAddress.isZero()
  ) {
    throw new Error(
      "The connected Aztec node does not advertise an L1 Fee Juice token and portal.",
    );
  }

  const decimals = Number(
    await wallet.publicClient.readContract({
      address: tokenAddress,
      abi: TestERC20Abi,
      functionName: "decimals",
    }),
  );
  const amount = parseAmount(amountText, decimals);
  const [l1EthBalance, l1TokenBalance, allowance, feeEstimate] =
    await Promise.all([
      wallet.publicClient.getBalance({ address: wallet.address }),
      wallet.publicClient.readContract({
        address: tokenAddress,
        abi: TestERC20Abi,
        functionName: "balanceOf",
        args: [wallet.address],
      }),
      wallet.publicClient.readContract({
        address: tokenAddress,
        abi: TestERC20Abi,
        functionName: "allowance",
        args: [wallet.address, portalAddress],
      }),
      wallet.publicClient.estimateFeesPerGas(),
    ]);

  const approvalNeeded = allowance < amount;
  // The portal rejects an all-zero secret hash; the value is only for gas estimation.
  const claimSecretHash = keccak256(
    stringToHex("dfpunk-fee-juice-bridge-estimate"),
  );
  const approvalGas = approvalNeeded
    ? await wallet.publicClient.estimateContractGas({
        account: wallet.address,
        address: tokenAddress,
        abi: TestERC20Abi,
        functionName: "approve",
        args: [portalAddress, amount],
      })
    : 0n;
  // The deposit simulation reverts until the wallet holds the tokens and the
  // portal allowance, so before funding we fall back to a conservative estimate.
  const canSimulateDeposit = !approvalNeeded && l1TokenBalance >= amount;
  const depositGas = canSimulateDeposit
    ? await wallet.publicClient.estimateContractGas({
        account: wallet.address,
        address: portalAddress,
        abi: FeeJuicePortalAbi,
        functionName: "depositToAztecPublic",
        args: [recipient as Hex, amount, claimSecretHash],
      })
    : DEFAULT_DEPOSIT_GAS;
  const feePerGas = feeEstimate.maxFeePerGas ?? feeEstimate.gasPrice;
  if (feePerGas === undefined)
    throw new Error("The Ethereum RPC did not return a usable gas price.");
  const minimumEth = calculateMinimumEth(
    approvalGas,
    depositGas,
    feePerGas,
    config.gasBufferPercent,
  );

  return {
    recipient,
    amount,
    decimals,
    tokenAddress,
    portalAddress,
    l1Address: wallet.address,
    l1EthBalance,
    l1TokenBalance,
    allowance,
    approvalNeeded,
    approvalGas,
    depositGas,
    feePerGas,
    minimumEth,
    gasBufferPercent: config.gasBufferPercent,
  };
}

export function printFundingQuote(quote: FundingQuote): void {
  console.log("\nL1 bridge wallet:", quote.l1Address);
  console.log("Aztec recipient:", quote.recipient);
  console.log("Fee Juice token:", quote.tokenAddress);
  console.log("Fee Juice portal:", quote.portalAddress);
  console.log(
    `\nTransfer at least ${formatUnits(quote.amount, quote.decimals)} $AZTEC to the L1 bridge wallet.`,
  );
  console.log(
    `Transfer at least ${formatEther(quote.minimumEth)} ETH for L1 gas (${quote.gasBufferPercent}% buffer).`,
  );
  console.log("\nCurrent L1 balances:");
  console.log(`  ETH:    ${formatEther(quote.l1EthBalance)}`);
  console.log(`  $AZTEC: ${formatUnits(quote.l1TokenBalance, quote.decimals)}`);
  console.log(
    `  Allowance: ${formatUnits(quote.allowance, quote.decimals)} (${quote.approvalNeeded ? "approve required" : "already sufficient"})`,
  );
  console.log("\nEstimated transactions:");
  if (quote.approvalNeeded)
    console.log(`  approve: ${quote.approvalGas.toString()} gas`);
  console.log(`  deposit: ${quote.depositGas.toString()} gas`);
}

export function assertSufficientFunding(quote: FundingQuote): void {
  const failures: string[] = [];
  if (quote.l1TokenBalance < quote.amount)
    failures.push("insufficient L1 $AZTEC");
  if (quote.l1EthBalance < quote.minimumEth)
    failures.push("insufficient L1 ETH");
  if (failures.length > 0) {
    throw new Error(
      `${failures.join(" and ")}. Run \`pnpm quote\` to view the funding requirements.`,
    );
  }
}
