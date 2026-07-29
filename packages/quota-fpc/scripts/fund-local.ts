/**
 * Funds a paymaster with fake fee juice on a local network.
 *
 *   QUOTA_FPC_ADDRESS=0x… pnpm --filter @dfpunk/quota-fpc run fund:local
 *
 * Local networks mint from an L1 faucet, so this costs nothing and is safe to
 * re-run. It refuses to touch anything that is not a local network, because the
 * same flow against mainnet would spend real money that cannot be recovered.
 */
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/stdlib/aztec-address";

const DEFAULT_AMOUNT = 10n ** 21n; // 1000 fee juice — plenty for a local session
const LOCAL_L1_CHAIN_ID = 31337; // anvil

async function main() {
  const target = process.env.QUOTA_FPC_ADDRESS?.trim();
  if (!target) {
    throw new Error("Set QUOTA_FPC_ADDRESS to the paymaster you want to fund.");
  }
  const nodeUrl = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
  const amount = process.env.QUOTA_FPC_FUND_WEI
    ? BigInt(process.env.QUOTA_FPC_FUND_WEI)
    : DEFAULT_AMOUNT;

  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node);
  const info = await node.getNodeInfo();

  // The guard that matters: this script mints from a faucet and bridges without
  // asking. Pointed at a real network it would move real value.
  if (info.l1ChainId !== LOCAL_L1_CHAIN_ID) {
    throw new Error(
      `Refusing to run: ${nodeUrl} reports L1 chain ${info.l1ChainId}, not a local network (${LOCAL_L1_CHAIN_ID}). ` +
        `Fund real deployments deliberately, in tranches, using the bridge.`,
    );
  }

  const { EmbeddedWallet } = await import("@aztec/wallets/embedded");
  const { registerInitialLocalNetworkAccountsInWallet } =
    await import("@aztec/wallets/testing");
  const { L1FeeJuicePortalManager } = await import("@aztec/aztec.js/ethereum");
  const { createEthereumChain } = await import("@aztec/ethereum/chain");
  const { createExtendedL1Client } = await import("@aztec/ethereum/client");
  const { FeeJuiceContract } = await import("@aztec/aztec.js/protocol");
  const { createLogger } = await import("@aztec/foundation/log");
  const { isL1ToL2MessageReady } = await import("@aztec/aztec.js/messaging");
  const { getFeeJuiceBalance } = await import("@aztec/aztec.js/utils");

  const wallet = await EmbeddedWallet.create(node, {
    pxe: { ephemeral: true },
  });
  const accounts = await registerInitialLocalNetworkAccountsInWallet(
    wallet as never,
  );
  const payer = accounts[0];
  const recipient = AztecAddress.fromStringUnsafe(target);

  const chain = createEthereumChain(
    [process.env.QUOTA_FPC_L1_URL ?? "http://localhost:8545"],
    info.l1ChainId,
  );
  const l1Client = createExtendedL1Client(
    chain.rpcUrls,
    // anvil's first default key — public knowledge, local only.
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    chain.chainInfo,
  );

  console.log(`Bridging ${amount} wei of fee juice to ${target} …`);
  const portal = await L1FeeJuicePortalManager.new(
    node,
    l1Client,
    createLogger("quota-fpc:fund"),
  );
  const claim = await portal.bridgeTokensPublic(recipient, amount, true);

  // A local network only builds blocks when transactions arrive, so an idle
  // chain never matures the L1->L2 message. Poking it therefore has to mean
  // actually sending transactions, not just waiting.
  const { FpcTestTargetContract } =
    await import("../../../contracts/target/FpcTestTarget.js");
  const poker = FpcTestTargetContract.deploy(wallet as never);
  await poker.send({ from: payer });
  const pokerContract = await poker.register();

  const anyContract = FeeJuiceContract.at(wallet as never);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await isL1ToL2MessageReady(node, claim.messageHash)) {
      ready = true;
      break;
    }
    process.stdout.write(".");
    await pokerContract.methods.ping().send({ from: payer });
  }
  process.stdout.write("\n");
  if (!ready) {
    throw new Error(
      "The bridged fee juice never became claimable. Is the local network still building blocks?",
    );
  }

  await anyContract.methods
    .claim(
      recipient,
      claim.claimAmount,
      claim.claimSecret,
      claim.messageLeafIndex,
    )
    .send({ from: payer });

  const balance = await getFeeJuiceBalance(recipient, node);
  console.log(`Done. Paymaster balance: ${balance} wei.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
