/**
 * Keeps a local network's clock fresh.
 *
 * Aztec's local network only builds a block when a transaction arrives, so an
 * idle chain's latest-block timestamp falls behind wall-clock time. Dark Forest
 * reads that timestamp and its contracts reject anything more than 300s stale
 * ("Timestamp too old"), which makes the game unplayable after a few minutes of
 * thinking time — nothing to do with sponsorship.
 *
 * `SEQ_MIN_TX_PER_BLOCK=0` does not help; the local-network preset overrides it.
 * So this sends one cheap transaction on an interval, which is enough to keep
 * block time within tolerance.
 *
 *   AZTEC_NODE_URL=… pnpm --filter @dfpunk/quota-fpc run heartbeat
 */
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";

const INTERVAL_MS = Number(process.env.QUOTA_FPC_HEARTBEAT_MS ?? 60_000);
const LOCAL_L1_CHAIN_ID = 31337;

async function main() {
  const nodeUrl = process.env.AZTEC_NODE_URL ?? "http://localhost:8590";
  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node);

  const info = await node.getNodeInfo();
  if (info.l1ChainId !== LOCAL_L1_CHAIN_ID) {
    throw new Error(
      `Refusing to run against ${nodeUrl} (L1 chain ${info.l1ChainId}): this only makes ` +
        `sense on a local network, and it would spend real fees anywhere else.`,
    );
  }

  const { EmbeddedWallet } = await import("@aztec/wallets/embedded");
  const { registerInitialLocalNetworkAccountsInWallet } =
    await import("@aztec/wallets/testing");
  const { FpcTestTargetContract } =
    await import("../../../contracts/target/FpcTestTarget.js");

  const wallet = await EmbeddedWallet.create(node, {
    pxe: { ephemeral: true },
  });
  const accounts = await registerInitialLocalNetworkAccountsInWallet(
    wallet as never,
  );
  const sender = accounts[0];

  const deploy = FpcTestTargetContract.deploy(wallet as never);
  await deploy.send({ from: sender });
  const ticker = await deploy.register();
  console.log(
    `Heartbeat every ${INTERVAL_MS}ms via ${ticker.address.toString()}`,
  );

  for (;;) {
    try {
      await ticker.methods.ping().send({ from: sender });
      const block = await node.getBlockData("latest");
      const ts = Number(block!.header.globalVariables.timestamp);
      const drift = Math.floor(Date.now() / 1000) - ts;
      console.log(`tick — block time ${ts}, drift ${drift}s`);
    } catch (err) {
      // Never exit: a transient failure should not silently stop the clock.
      console.warn("tick failed:", String(err).slice(0, 160));
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
