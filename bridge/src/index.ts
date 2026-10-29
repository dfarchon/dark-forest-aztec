import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { L1FeeJuicePortalManager } from "@aztec-labs/aztec.js/ethereum";
import { FeeJuicePaymentMethodWithClaim } from "@aztec-labs/aztec.js/fee";
import { Fq, Fr } from "@aztec-labs/aztec.js/fields";
import { createLogger } from "@aztec-labs/aztec.js/log";
import { isL1ToL2MessageReady } from "@aztec-labs/aztec.js/messaging";
import { createAztecNodeClient, type AztecNode } from "@aztec-labs/aztec.js/node";
import { ExecutionPayload, mergeExecutionPayloads } from "@aztec-labs/aztec.js/tx";
import { EmbeddedWallet } from "@aztec-labs/wallets/embedded";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  loadClaims,
  markClaimed,
  saveClaim,
  selectClaim,
  type ClaimRecord,
} from "./claim-store.js";
import { loadConfig, pxeDataDir } from "./config.js";
import {
  assertSufficientFunding,
  printFundingQuote,
  quoteFunding,
} from "./funding.js";
import { getOrCreateL1Wallet } from "./l1-wallet.js";
import { getOrCreateL2Account } from "./l2-wallet.js";

function usage(): never {
  console.error(`Usage:
  pnpm quote --amount <decimal> [--recipient <aztec-address>]
  pnpm deposit --amount <decimal> [--recipient <aztec-address>]
  pnpm status [--recipient <aztec-address>]
  pnpm history [--recipient <aztec-address>]
  pnpm claim [<number>] [--recipient <aztec-address>]`);
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

function parseMessageHash(): string | undefined {
  const index = process.argv.indexOf("--message-hash");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(
      "--message-hash requires a message hash. Run `pnpm status` and pass its number to `pnpm claim`.",
    );
  }
  return value;
}

function parseClaimSelector(): { messageHash?: string; index?: number } {
  const messageHash = parseMessageHash();
  const args = process.argv.slice(3);
  const skip = new Set<number>();
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--message-hash" || args[index] === "--recipient") {
      skip.add(index);
      skip.add(index + 1);
    }
  }
  const positional = args.filter(
    (arg, index) => !skip.has(index) && !arg.startsWith("--"),
  );
  if (positional.length > 1) {
    throw new Error(
      "Pass one claim number from `pnpm status`, for example `pnpm claim 1`.",
    );
  }
  if (positional.length === 0) return { messageHash };
  if (!/^[1-9]\d*$/.test(positional[0])) {
    throw new Error(
      `Claim number must be a positive integer from \`pnpm status\`. Received ${positional[0]}.`,
    );
  }
  if (messageHash) {
    throw new Error("Pass either a claim number or --message-hash, not both.");
  }
  return { index: Number(positional[0]) };
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

  const config = loadConfig({ requireL1Key: true });
  const node = createAztecNodeClient(config.aztecNodeUrl);
  const wallet = getOrCreateL1Wallet();
  const manager = await L1FeeJuicePortalManager.new(
    node,
    wallet.extendedClient,
    createLogger("fee-juice-bridge"),
  );
  console.log(
    "Submitting L1 Fee Juice deposit. This sends approve only if the allowance is insufficient.",
  );
  const claim = await manager.bridgeTokensPublic(
    recipient,
    quote.amount,
    false,
  );
  const messageHash = claim.messageHash.toString();
  saveClaim({
    recipient: recipient.toString(),
    claimAmount: claim.claimAmount.toString(),
    claimSecret: claim.claimSecret.toString(),
    messageLeafIndex: claim.messageLeafIndex.toString(),
    messageHash,
    depositedAt: new Date().toISOString(),
  });
  console.log(
    `Deposit confirmed. Pending claim ${messageHash} is stored locally for ${recipient.toString()}.`,
  );
  console.log(
    "Wait for the L1→L2 message, then run `pnpm status` and `pnpm claim <number>`.",
  );
}

async function printClaim(
  claim: ClaimRecord,
  label: string,
  ready: boolean | undefined,
): Promise<void> {
  console.log(`\n[${label}] ${claim.messageHash}`);
  console.log(`Amount: ${claim.claimAmount} wei`);
  console.log(`Deposited: ${claim.depositedAt}`);
  if (ready !== undefined) {
    console.log(
      `L1→L2 message: ${ready ? "ready to claim" : "waiting for inclusion"}`,
    );
  }
  if (claim.claimedAt) {
    console.log(`Claim: claimed at ${claim.claimedAt}`);
    if (claim.l2TransactionHash) {
      console.log(`L2 transaction: ${claim.l2TransactionHash}`);
    }
    return;
  }
  console.log("Claim: pending");
}

async function listClaims(onlyPending: boolean): Promise<void> {
  const recipient = parseRecipient();
  const config = loadConfig();
  const file = loadClaims(recipient.toString());
  const node = createAztecNodeClient(config.aztecNodeUrl);
  console.log(`Recipient: ${file.recipient}`);
  if (file.claims.length === 0) {
    console.log("No claims are stored.");
    return;
  }

  let pendingNumber = 0;
  for (const claim of file.claims) {
    if (claim.claimedAt) {
      if (!onlyPending) await printClaim(claim, "claimed", undefined);
      continue;
    }
    pendingNumber += 1;
    const ready = await isL1ToL2MessageReady(
      node,
      Fr.fromHexString(claim.messageHash),
    );
    await printClaim(claim, String(pendingNumber), ready);
  }

  if (pendingNumber === 0) {
    console.log(
      onlyPending
        ? "\nNo pending claims. Run `pnpm history` to see completed claims."
        : "\nNo pending claims.",
    );
    return;
  }
  if (onlyPending && pendingNumber > 1) {
    console.log("\nPass a number to `pnpm claim`, for example `pnpm claim 1`.");
  }
}

async function status(): Promise<void> {
  return listClaims(true);
}

async function history(): Promise<void> {
  return listClaims(false);
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
  const config = loadConfig({ requireAztecAccount: true });
  const accountConfig = config.aztecAccount!;
  const node = createAztecNodeClient(config.aztecNodeUrl);
  const claimData = selectClaim(
    loadClaims(recipient.toString()),
    parseClaimSelector(),
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
  markClaimed(
    recipient.toString(),
    claimData.messageHash,
    result.receipt.txHash.toString(),
  );
  console.log(
    `Fee Juice claim succeeded in L2 transaction ${result.receipt.txHash.toString()}.`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "quote") return quote();
  if (command === "deposit") return deposit();
  if (command === "status") return status();
  if (command === "history") return history();
  if (command === "claim") return claim();
  usage();
}

main().catch((error) => {
  console.error(
    `Bridge failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
