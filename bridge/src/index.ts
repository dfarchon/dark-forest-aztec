import { AztecAddress } from "@aztec/aztec.js/addresses";
import { generateClaimSecret } from "@aztec/aztec.js/ethereum";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import { createLogger } from "@aztec/aztec.js/log";
import { isL1ToL2MessageReady } from "@aztec/aztec.js/messaging";
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { ExecutionPayload, mergeExecutionPayloads } from "@aztec/aztec.js/tx";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import {
  createL1TxUtils,
  getL1TxUtilsConfigEnvVars,
} from "@aztec/ethereum/l1-tx-utils";
import { FeeJuicePortalAbi } from "@aztec/l1-artifacts/FeeJuicePortalAbi";
import { TestERC20Abi } from "@aztec/l1-artifacts/TestERC20Abi";
import { encodeFunctionData, type Hex } from "viem";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { ClaimStore } from "./claim-store.js";
import { claimsDir, loadConfig, pxeDataDir } from "./config.js";
import {
  claimFromReceipt,
  DepositNotSentError,
  executeDeposit,
} from "./deposit.js";
import {
  assertSufficientFunding,
  printFundingQuote,
  quoteFunding,
} from "./funding.js";
import { getOrCreateL1Wallet } from "./l1-wallet.js";
import { getOrCreateL2Account } from "./l2-wallet.js";

const claimStore = new ClaimStore(claimsDir);

function usage(): never {
  console.error(`Usage:
  pnpm quote --amount <decimal> [--recipient <aztec-address>]
  pnpm deposit --amount <decimal> [--recipient <aztec-address>]
  pnpm recover --tx-hash <l1-deposit-tx> [--recipient <aztec-address>]
  pnpm abandon --confirm-not-mined [--recipient <aztec-address>]
  pnpm status [--recipient <aztec-address>]
  pnpm claim [--recipient <aztec-address>]`);
  process.exit(1);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseRecipient(): AztecAddress {
  const value = option("--recipient") ?? loadConfig().aztecAccount?.address;
  if (!value) usage();
  return AztecAddress.fromStringUnsafe(value);
}

function parseAmount(): string {
  const value = option("--amount");
  if (!value) usage();
  return value;
}

async function quote(): Promise<void> {
  const recipient =
    option("--recipient") !== undefined
      ? AztecAddress.fromStringUnsafe(option("--recipient")!)
      : (await getOrCreateL2Account()).address;
  console.log(`Aztec L2 recipient: ${recipient.toString()}`);
  const fundingQuote = await quoteFunding(recipient.toString(), parseAmount());
  printFundingQuote(fundingQuote);
  console.log(
    "\nNo transaction was sent. After funding this L1 wallet, run the matching `pnpm deposit` command.",
  );
}

async function deposit(): Promise<void> {
  const recipient = parseRecipient();
  const amountText = parseAmount();
  const quote = await quoteFunding(recipient.toString(), amountText);
  assertSufficientFunding(quote);

  loadConfig({ requireL1Key: true });
  const wallet = getOrCreateL1Wallet();
  const txConfig = getL1TxUtilsConfigEnvVars();
  const txUtils = createL1TxUtils(
    wallet.extendedClient,
    {
      logger: createLogger("fee-juice-bridge"),
    },
    txConfig,
  );
  const [claimSecret, claimSecretHash] = await generateClaimSecret();
  await executeDeposit(
    claimStore,
    {
      recipient: recipient.toString(),
      claimAmount: quote.amount.toString(),
      claimSecret: claimSecret.toString(),
      claimSecretHash: claimSecretHash.toString(),
      l1ChainId: 1,
      portalAddress: quote.portalAddress,
      l1Address: wallet.address,
      preparedAt: new Date().toISOString(),
    },
    async () => {
      console.log("Claim secret saved. Submitting L1 Fee Juice deposit.");
      const args = [
        recipient.toString(),
        quote.amount,
        claimSecretHash.toString(),
      ] as const;
      try {
        if (quote.approvalNeeded) {
          await txUtils.sendAndMonitorTransaction({
            to: quote.tokenAddress,
            abi: TestERC20Abi,
            data: encodeFunctionData({
              abi: TestERC20Abi,
              functionName: "approve",
              args: [quote.portalAddress, quote.amount],
            }),
          });
        }
        await wallet.publicClient.simulateContract({
          account: wallet.address,
          address: quote.portalAddress,
          abi: FeeJuicePortalAbi,
          functionName: "depositToAztecPublic",
          args,
        });
      } catch (error) {
        // The deposit itself has not been broadcast yet, so its secret is unused.
        throw new DepositNotSentError(error);
      }
      const { receipt } = await txUtils.sendAndMonitorTransaction(
        {
          to: quote.portalAddress,
          abi: FeeJuicePortalAbi,
          data: encodeFunctionData({
            abi: FeeJuicePortalAbi,
            functionName: "depositToAztecPublic",
            args,
          }),
        },
        {
          // Match the SDK's buffer floor for variable-cost Inbox tree insertion.
          gasLimitBufferPercentage: Math.max(
            100,
            txConfig.gasLimitBufferPercentage ?? 0,
          ),
        },
      );
      return receipt;
    },
  );
  console.log(
    `Deposit confirmed. The pending claim is stored locally for ${recipient.toString()}.`,
  );
  console.log(
    "Wait for the L1→L2 message, then run `pnpm status` and `pnpm claim`.",
  );
}

async function recover(): Promise<void> {
  const recipient = parseRecipient().toString();
  const txHash = option("--tx-hash");
  if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash)) usage();
  const deposit = claimStore.loadDeposit(recipient);
  if (!deposit) throw new Error("No unresolved deposit to recover.");
  const wallet = getOrCreateL1Wallet();
  if ((await wallet.publicClient.getChainId()) !== deposit.l1ChainId) {
    throw new Error("Recovery RPC chain does not match the prepared deposit.");
  }
  const receipt = await wallet.publicClient.getTransactionReceipt({
    hash: txHash as Hex,
  });
  claimStore.completeDeposit(claimFromReceipt(deposit, receipt));
  console.log("Deposit recovered. Run `pnpm status` and then `pnpm claim`.");
}

async function abandon(): Promise<void> {
  const recipient = parseRecipient().toString();
  if (!process.argv.includes("--confirm-not-mined")) usage();
  const deposit = claimStore.loadDeposit(recipient);
  if (!deposit) throw new Error("No unresolved deposit to abandon.");
  claimStore.discardDeposit(deposit);
  console.log(
    "Prepared deposit archived in claims/ as *.discarded.json. You can deposit again.",
  );
}

async function status(): Promise<void> {
  const recipient = parseRecipient();
  if (claimStore.loadDeposit(recipient.toString())) {
    console.log(
      "An unresolved deposit is saved locally. Recover it with `pnpm recover --tx-hash <l1-deposit-tx>`, or run `pnpm abandon --confirm-not-mined` only after confirming it was never mined.",
    );
    return;
  }
  const config = loadConfig();
  const claim = claimStore.loadClaim(recipient.toString());
  const node = createAztecNodeClient(config.aztecNodeUrl);
  const ready = await isL1ToL2MessageReady(
    node,
    Fr.fromHexString(claim.messageHash),
  );
  console.log(`Recipient: ${claim.recipient}`);
  console.log(`Amount: ${claim.claimAmount} wei`);
  console.log(`Deposited: ${claim.depositedAt}`);
  console.log(
    `L1→L2 message: ${ready ? "ready to claim" : "waiting for inclusion"}`,
  );
  console.log(
    `Claim: ${claim.claimedAt ? `claimed at ${claim.claimedAt}` : "pending"}`,
  );
}

function signingKeyFromHex(value: string): Fq {
  return Fq.fromBuffer(
    Buffer.from(value.startsWith("0x") ? value.slice(2) : value, "hex"),
  );
}

// dRPC's Aztec gateway cannot represent the empty JSON-RPC result that
// `node_getContract` returns for addresses without a public deployment (such
// as this initializerless account) and answers with "Temporary internal
// error" code 19 instead. PXE handles an undefined instance by falling back
// to its locally registered contract, so map that gateway error back to the
// undefined the node actually produced.
function tolerateMissingContracts(node: AztecNode): AztecNode {
  return new Proxy(node, {
    get(target, property, receiver) {
      if (property !== "getContract")
        return Reflect.get(target, property, receiver);
      return async (...args: Parameters<AztecNode["getContract"]>) => {
        try {
          return await target.getContract(...args);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Temporary internal error")
          ) {
            return undefined;
          }
          throw error;
        }
      };
    },
  });
}

async function claim(): Promise<void> {
  const recipient = parseRecipient();
  if (claimStore.loadDeposit(recipient.toString())) {
    throw new Error("Recover the unresolved deposit before claiming.");
  }
  const config = loadConfig({ requireAztecAccount: true });
  const accountConfig = config.aztecAccount!;
  const node = createAztecNodeClient(config.aztecNodeUrl);
  const claimData = claimStore.loadClaim(recipient.toString());
  if (claimData.claimedAt)
    throw new Error(
      `Claim for ${recipient.toString()} is already marked as completed.`,
    );
  if (
    !(await isL1ToL2MessageReady(node, Fr.fromHexString(claimData.messageHash)))
  ) {
    throw new Error(
      "The L1→L2 message is not ready yet. Run `pnpm status` and retry after it is included.",
    );
  }

  mkdirSync(pxeDataDir, { recursive: true, mode: 0o700 });
  const wallet = await EmbeddedWallet.create(tolerateMissingContracts(node), {
    pxe: {
      dataDirectory: path.join(pxeDataDir, recipient.toString()),
      proverEnabled: true,
      dataStoreMapSizeKb: 1e6,
    },
  });
  const accountManager = await wallet.createSchnorrInitializerlessAccount(
    Fr.fromString(accountConfig.secretKey),
    Fr.fromString(accountConfig.salt),
    signingKeyFromHex(accountConfig.signingKey),
  );
  if (!accountManager.address.equals(recipient)) {
    throw new Error(
      `Recipient does not match AZTEC_ACCOUNT_* keys. Derived ${accountManager.address.toString()}.`,
    );
  }
  if (
    accountConfig.address &&
    !AztecAddress.fromStringUnsafe(accountConfig.address).equals(recipient)
  ) {
    throw new Error("AZTEC_ACCOUNT_ADDRESS does not match --recipient.");
  }

  const paymentMethod = new FeeJuicePaymentMethodWithClaim(recipient, {
    claimAmount: BigInt(claimData.claimAmount),
    claimSecret: Fr.fromString(claimData.claimSecret),
    messageLeafIndex: BigInt(claimData.messageLeafIndex),
  });
  // The payment method contributes the private claim call in the non-revertible setup phase.
  // The empty application payload makes this a claim-only bootstrap transaction.
  const payload = mergeExecutionPayloads([
    await paymentMethod.getExecutionPayload(),
    new ExecutionPayload([], [], [], []),
  ]);
  const result = await wallet.sendTx(payload, {
    from: recipient,
    wait: {},
  });
  if (!result.receipt.hasExecutionSucceeded()) {
    throw new Error(`Claim transaction failed: ${result.receipt.toString()}`);
  }
  claimStore.markClaimed(claimData);
  console.log(
    `Fee Juice claim succeeded in L2 transaction ${result.receipt.txHash.toString()}.`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "quote") return quote();
  if (command === "deposit") return deposit();
  if (command === "recover") return recover();
  if (command === "abandon") return abandon();
  if (command === "status") return status();
  if (command === "claim") return claim();
  usage();
}

main().catch((error) => {
  console.error(
    `Bridge failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
