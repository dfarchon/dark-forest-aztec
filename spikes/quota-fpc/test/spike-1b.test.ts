/**
 * Spike 1B — the "sandwich": can an FPC be the transaction ORIGIN, bind the
 * payload to allowlisted app contracts, and still have the app see the PLAYER
 * as msg_sender by handing off to the player's own account entrypoint?
 *
 * Evidence required (plan.md Phase 1B):
 *  (i)   a node accepts an FPC-as-origin tx
 *  (ii)  the account entrypoint verifies the player's payload signature mid-stack
 *  (iii) the app sees the player's account as msg_sender  <-- the whole question
 *  (iv)  an out-of-scope payload (non-allowlisted target) is unprovable
 *  (v)   the client-integration delta (recorded in lessons/phase-1.md)
 */
import { beforeAll, describe, expect, test } from "vitest";
import { SandwichFpcContract } from "../noir/target/SandwichFpc.js";
import { SpikeTargetContract } from "../noir/target/SpikeTarget.js";
import { DefaultEntrypoint } from "@aztec/entrypoints/default";
import { EncodedAppEntrypointCalls } from "@aztec/entrypoints/encoding";
import { Fr } from "@aztec/foundation/curves/bn254";
import { ExecutionPayload } from "@aztec/stdlib/tx";
import { Gas, GasSettings } from "@aztec/stdlib/gas";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";
import { connect, currentGeneration, evidence, feeJuiceOf, fundWithFeeJuice } from "./harness.js";

describe("spike 1B — sandwich (FPC as tx origin, hand-off to the player's account)", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  let fpc: SandwichFpcContract;
  let target: SpikeTargetContract;
  let decoy: SpikeTargetContract;
  let player: AztecAddress;

  beforeAll(async () => {
    ctx = await connect();
    player = ctx.addresses[0];

    const targetDeploy = SpikeTargetContract.deploy(ctx.wallet as any);
    await targetDeploy.send({ from: player });
    target = await targetDeploy.register();

    // A second, NON-allowlisted contract: proves the binding actually bites.
    const decoyDeploy = SpikeTargetContract.deploy(ctx.wallet as any, { salt: Fr.random() } as any);
    await decoyDeploy.send({ from: player });
    decoy = await decoyDeploy.register();

    const fpcDeploy = SandwichFpcContract.deploy(ctx.wallet as any, target.address);
    await fpcDeploy.send({ from: player });
    fpc = await fpcDeploy.register();

    await fundWithFeeJuice(ctx.node, ctx.wallet, fpc.address, 10n ** 21n, player, () =>
      target.methods.ping().send({ from: player }),
    );

    evidence("1B/setup", {
      fpc: fpc.address.toString(),
      allowlistedTarget: target.address.toString(),
      decoy: decoy.address.toString(),
      player: player.toString(),
      fpcFeeJuice: (await feeJuiceOf(ctx.node, fpc.address)).toString(),
    });
  });

  /** Assembles + sends a sandwich tx: origin = FPC, payload signed by the player. */
  async function sendSandwich(appTarget: SpikeTargetContract) {
    const wallet: any = ctx.wallet;

    // 1. The app call the player wants sponsored.
    const appCall = await appTarget.methods.record().request();
    const calls = appCall.calls ?? appCall;

    // 2. Encode it exactly as an account entrypoint payload and have the PLAYER sign it.
    const encodedCalls = await EncodedAppEntrypointCalls.create(calls, Fr.random());
    const payloadHash = await encodedCalls.hash();
    const authWit = await wallet.createAuthWit(player, {
      consumer: player,
      innerHash: payloadHash,
    });

    // 3. The outer call: FPC.entrypoint(payload, player). EncodedAppEntrypointCalls
    //    exposes function_calls/tx_nonce getters, so it encodes as the Noir struct.
    const outer = await fpc.methods.entrypoint(encodedCalls as any, player).request();
    const outerCalls = outer.calls ?? outer;

    // 4. Single-call payload: the player's authwit + the inner calls' hashed args
    //    (so the account's circuit can resolve them), fee payer = the FPC.
    const execPayload = new ExecutionPayload(
      outerCalls,
      [authWit, ...(outer.authWitnesses ?? [])],
      [...(outer.capsules ?? [])],
      [...encodedCalls.hashedArguments, ...(outer.extraHashedArgs ?? [])],
      fpc.address,
    );

    // 5. FPC-as-origin assembly — no account entrypoint wrapping.
    const chainInfo = await wallet.getChainInfo();
    const minFees = await ctx.node.getCurrentMinFees();
    // Network caps per-tx gas (observed max l2Gas 6_540_000 on this local net).
    const gasSettings = GasSettings.fallback({
      gasLimits: new Gas(50_000, 6_000_000),
      teardownGasLimits: new Gas(5_000, 500_000),
      maxFeesPerGas: minFees,
    });
    const txRequest = await new DefaultEntrypoint().createTxExecutionRequest(
      execPayload,
      gasSettings,
      chainInfo,
    );

    const proven = await wallet.pxe.proveTx(txRequest, { scopes: [player] });
    const tx = await proven.toTx();
    await ctx.node.sendTx(tx);
    return tx.getTxHash();
  }

  test("(i,ii,iii) the node accepts an FPC-origin tx and the app sees the PLAYER", async () => {
    const fpcBefore = await feeJuiceOf(ctx.node, fpc.address);
    const playerBefore = await feeJuiceOf(ctx.node, player);

    const txHash = await sendSandwich(target);
    const { waitForTx } = await import("@aztec/aztec.js/node");
    const receipt = await waitForTx(ctx.node, txHash);
    evidence("1B/tx", { txHash: txHash.toString(), status: receipt.status });

    const seenRaw: any = await target.methods.get_last_caller().simulate({ from: player });
    const lastCaller = (seenRaw?.result ?? seenRaw).toString();
    evidence("1B/app-msg-sender", {
      observed: lastCaller,
      player: player.toString(),
      fpc: fpc.address.toString(),
      matchesPlayer: lastCaller === player.toString(),
    });
    expect(lastCaller).toBe(player.toString());

    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    const playerAfter = await feeJuiceOf(ctx.node, player);
    evidence("1B/who-paid", {
      fpcPaid: (fpcBefore - fpcAfter).toString(),
      playerPaid: (playerBefore - playerAfter).toString(),
    });
    expect(fpcAfter).toBeLessThan(fpcBefore);
    expect(playerAfter).toBe(playerBefore);
  });

  test("(iv) a payload targeting a non-allowlisted contract is unprovable", async () => {
    await expect(sendSandwich(decoy)).rejects.toThrow(/non-allowlisted/);
    evidence("1B/call-binding", "payload aimed at a non-allowlisted contract cannot be proven");
  });
});
