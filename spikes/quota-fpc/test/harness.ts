import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { registerInitialLocalNetworkAccountsInWallet } from "@aztec/wallets/testing";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";

export const NODE_URL = process.env.QUOTA_FPC_SANDBOX_URL ?? "http://localhost:8590";

/** Seconds-per-day generation index, matching the contracts' arithmetic. */
export const SECONDS_PER_DAY = 86_400n;

export async function connect() {
  const node = createAztecNodeClient(NODE_URL);
  await waitForNode(node);
  const wallet = await EmbeddedWallet.create(node, { pxe: { ephemeral: true } });
  const addresses = await registerInitialLocalNetworkAccountsInWallet(wallet as any);
  return { node, wallet, addresses };
}

/** The chain's own notion of "now", which is what the contracts validate against. */
export async function chainTimestamp(node: any): Promise<bigint> {
  const block = await node.getBlockData("latest");
  return BigInt(block.header.globalVariables.timestamp);
}

export async function currentGeneration(node: any): Promise<number> {
  return Number((await chainTimestamp(node)) / SECONDS_PER_DAY);
}

export async function feeJuiceOf(node: any, address: AztecAddress): Promise<bigint> {
  return await getFeeJuiceBalance(address, node);
}

/** Structured evidence lines: the spike's actual deliverable. */
export function evidence(tag: string, detail: unknown) {
  console.log(`EVIDENCE[${tag}] ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

/**
 * Funds any L2 address (contract or account) with fee juice by bridging from the
 * local network's L1 and claiming on L2 — the same path a real FPC deployment uses.
 */
export async function fundWithFeeJuice(
  node: any,
  wallet: any,
  recipient: AztecAddress,
  amount: bigint,
  claimFrom: AztecAddress,
  /** Produces an L2 block (this local network only builds blocks when txs arrive). */
  poke?: () => Promise<unknown>,
) {
  const { L1FeeJuicePortalManager } = await import("@aztec/aztec.js/ethereum");
  const { createEthereumChain } = await import("@aztec/ethereum/chain");
  const { createExtendedL1Client } = await import("@aztec/ethereum/client");
  const { FeeJuiceContract } = await import("@aztec/aztec.js/protocol");
  const { createLogger } = await import("@aztec/foundation/log");

  const info = await node.getNodeInfo();
  const l1RpcUrl = process.env.QUOTA_FPC_L1_URL ?? "http://localhost:8545";
  const chain = createEthereumChain([l1RpcUrl], info.l1ChainId);
  // anvil's first default test key (local network only).
  const l1Key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const l1Client = createExtendedL1Client(chain.rpcUrls, l1Key, chain.chainInfo);
  const portal = await L1FeeJuicePortalManager.new(node, l1Client, createLogger("spike:bridge"));

  const claim = await portal.bridgeTokensPublic(recipient, amount, true);

  // The L1->L2 message only becomes claimable once further L2 blocks are built,
  // and this local network builds blocks only when txs arrive — so we poke it.
  const { isL1ToL2MessageReady } = await import("@aztec/aztec.js/messaging");
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isL1ToL2MessageReady(node, claim.messageHash)) {
      evidence("harness/l1-to-l2-ready", { ms: Date.now() - startedAt, pokes: attempt });
      break;
    }
    if (poke) await poke();
    await new Promise((r) => setTimeout(r, 1500));
  }

  const feeJuice = FeeJuiceContract.at(wallet);
  await feeJuice.methods
    .claim(recipient, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from: claimFrom });
  return claim;
}
