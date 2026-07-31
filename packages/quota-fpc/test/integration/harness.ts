/**
 * Integration harness: a live local Aztec network, the real compiled contracts,
 * and this package's own client code. Nothing is mocked.
 *
 * Gated on QUOTA_FPC_SANDBOX_URL so the unit suite still runs anywhere.
 */
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { DefaultEntrypoint } from "@aztec/entrypoints/default";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";
import { Gas, GasSettings } from "@aztec/stdlib/gas";
import type { ExecutionPayload } from "@aztec/stdlib/tx";

export const SANDBOX_URL = process.env.QUOTA_FPC_SANDBOX_URL;
export const HAS_SANDBOX = Boolean(SANDBOX_URL);

/**
 * Per-transaction gas ceilings this network enforces. The data-gas cap is far
 * tighter than the L2 cap and is easy to blow past accidentally.
 */
export const GAS_LIMITS = new Gas(50_000, 6_000_000);
export const TEARDOWN_GAS_LIMITS = new Gas(5_000, 500_000);

export async function connect() {
  const { EmbeddedWallet } = await import("@aztec/wallets/embedded");
  const { registerInitialLocalNetworkAccountsInWallet } =
    await import("@aztec/wallets/testing");

  const node = createAztecNodeClient(SANDBOX_URL!);
  await waitForNode(node);
  const wallet = await EmbeddedWallet.create(node, {
    pxe: { ephemeral: true },
  });
  const addresses = await registerInitialLocalNetworkAccountsInWallet(
    wallet as any,
  );
  return { node, wallet: wallet as any, addresses };
}

export async function chainTimestamp(node: any): Promise<bigint> {
  const block = await node.getBlockData("latest");
  return BigInt(block.header.globalVariables.timestamp);
}

/**
 * Moves the chain to just after the next UTC midnight.
 *
 * Allowance notes are keyed to a generation (a UTC day), so a test that warps
 * +12h can land in the NEXT generation depending on the time of day — and then
 * a sponsored send fails with "not currently sponsorable" instead of whatever
 * the test meant to prove. Starting a day gives 12h of headroom either way,
 * making such tests deterministic rather than clock-dependent.
 */
export async function warpChainToDayStart(
  node: any,
  poke?: () => Promise<unknown>,
): Promise<bigint> {
  const DAY = 86_400n;
  const now = await chainTimestamp(node);
  const target = (now / DAY + 1n) * DAY + 60n;
  const { createAztecNodeDebugClient } =
    await import("@aztec/stdlib/interfaces/client");
  const debug: any = createAztecNodeDebugClient(SANDBOX_URL!);
  await debug.warpL2TimeAtLeastTo(Number(target));
  if (poke) await poke();
  return chainTimestamp(node);
}

/**
 * Fast-forwards the local chain by a fixed amount.
 *
 * Policy changes take 12 hours to activate, so without this the tests that
 * prove "not in effect before, in effect after" would take 12 hours.
 *
 * Anything derived from chain time before the warp (a generation index, an
 * anchor) is stale afterwards and must be re-read.
 */
export async function warpChainBy(
  node: any,
  seconds: number,
  poke?: () => Promise<unknown>,
): Promise<bigint> {
  const before = await chainTimestamp(node);
  // Time control lives on a SEPARATE debug client, not the ordinary node
  // client — the regular API deliberately has no way to move the clock.
  const { createAztecNodeDebugClient } =
    await import("@aztec/stdlib/interfaces/client");
  const debug: any = createAztecNodeDebugClient(SANDBOX_URL!);
  if (typeof debug.warpL2TimeAtLeastBy !== "function") {
    throw new Error(
      "This node exposes no warpL2TimeAtLeastBy; the activation tests need a local network.",
    );
  }
  await debug.warpL2TimeAtLeastBy(seconds);
  // The warp moves the clock, but a block still has to be built for the new
  // time to be observable — an idle local chain produces none on its own.
  if (poke) await poke();
  const after = await chainTimestamp(node);
  if (after < before + BigInt(seconds)) {
    throw new Error(
      `Warp did not take: ${before} -> ${after}, expected at least +${seconds}s`,
    );
  }
  return after;
}

export async function feeJuiceOf(
  node: any,
  address: AztecAddress,
): Promise<bigint> {
  return getFeeJuiceBalance(address, node);
}

export function evidence(tag: string, detail: unknown) {
  console.log(
    `EVIDENCE[${tag}] ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
  );
}

/**
 * Sends a payload whose origin is the paymaster rather than an account.
 * This is the step the standard wallet flow cannot do for us.
 */
export async function sendFromPaymaster(
  ctx: { node: any; wallet: any },
  payload: ExecutionPayload,
  /** Whose notes the PXE must be able to decrypt — the sponsored USER, not the
   * paymaster: the allowance note is delivered to them. */
  scope: AztecAddress,
) {
  const chainInfo = await ctx.wallet.getChainInfo();
  const gasSettings = GasSettings.fallback({
    gasLimits: GAS_LIMITS,
    teardownGasLimits: TEARDOWN_GAS_LIMITS,
    maxFeesPerGas: await ctx.node.getCurrentMinFees(),
  });
  const txRequest = await new DefaultEntrypoint().createTxExecutionRequest(
    payload,
    gasSettings,
    chainInfo,
  );
  const proven = await ctx.wallet.pxe.proveTx(txRequest, { scopes: [scope] });
  const tx = await proven.toTx();
  await ctx.node.sendTx(tx);

  // Wait for inclusion before returning: callers assert on resulting state, and
  // reading it before the block lands produces confusing phantom failures.
  const { waitForTx } = await import("@aztec/aztec.js/node");
  const txHash = tx.getTxHash();
  const receipt = await waitForTx(ctx.node, txHash);
  return { txHash, receipt };
}

/** Bridges fee juice from L1 and claims it on L2 — the real funding path. */
export async function fundWithFeeJuice(
  node: any,
  wallet: any,
  recipient: AztecAddress,
  amount: bigint,
  claimFrom: AztecAddress,
  poke?: () => Promise<unknown>,
) {
  const { L1FeeJuicePortalManager } = await import("@aztec/aztec.js/ethereum");
  const { createEthereumChain } = await import("@aztec/ethereum/chain");
  const { createExtendedL1Client } = await import("@aztec/ethereum/client");
  const { FeeJuiceContract } = await import("@aztec/aztec.js/protocol");
  const { createLogger } = await import("@aztec/foundation/log");
  const { isL1ToL2MessageReady } = await import("@aztec/aztec.js/messaging");

  const info = await node.getNodeInfo();
  const chain = createEthereumChain(
    [process.env.QUOTA_FPC_L1_URL ?? "http://localhost:8545"],
    info.l1ChainId,
  );
  const l1Client = createExtendedL1Client(
    chain.rpcUrls,
    // anvil's first default key; local networks only.
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    chain.chainInfo,
  );
  const portal = await L1FeeJuicePortalManager.new(
    node,
    l1Client,
    createLogger("quota-fpc:bridge"),
  );
  const claim = await portal.bridgeTokensPublic(recipient, amount, true);

  // This network only builds blocks when transactions arrive, so an idle chain
  // never matures the L1->L2 message; poke it until the message is ready.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isL1ToL2MessageReady(node, claim.messageHash)) break;
    if (poke) await poke();
    await new Promise((r) => setTimeout(r, 1500));
  }

  await FeeJuiceContract.at(wallet)
    .methods.claim(
      recipient,
      claim.claimAmount,
      claim.claimSecret,
      claim.messageLeafIndex,
    )
    .send({ from: claimFrom });
}

export const randomNonce = () => Fr.random();
