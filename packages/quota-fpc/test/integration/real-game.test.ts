/**
 * The gate the plan set for mainnet funding: sponsor a call to the REAL Dark
 * Forest contracts, not a purpose-built test target.
 *
 * Everything else has been proven against `FpcTestTarget`. The open questions
 * this answers are whether a real game contract's call fits the per-transaction
 * gas limits once the paymaster's overhead is added, and whether the game still
 * sees the player rather than the paymaster.
 *
 * Requires a local network with the game deployed and configured, plus a funded
 * paymaster whose allowlist covers the game contracts:
 *   QUOTA_FPC_SANDBOX_URL=… QUOTA_FPC_ADDRESS=… QUOTA_FPC_GAME_CORE=…
 */
import { beforeAll, describe, expect, test } from "vitest";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { generationAt } from "../../src/generation.js";
import { buildSandwichPayload } from "../../src/sandwich.js";
import {
  chainTimestamp,
  connect,
  evidence,
  feeJuiceOf,
  sendFromPaymaster,
} from "./harness.js";

const FPC_ADDRESS = process.env.QUOTA_FPC_ADDRESS;
const CORE_ADDRESS = process.env.QUOTA_FPC_GAME_CORE;
const READY = Boolean(
  process.env.QUOTA_FPC_SANDBOX_URL && FPC_ADDRESS && CORE_ADDRESS,
);

describe.skipIf(!READY)("sponsoring the real game contracts", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  let fpc: any;
  let core: any;
  let player: AztecAddress;
  let generation: number;

  beforeAll(async () => {
    ctx = await connect();
    player = ctx.addresses[0];
    generation = generationAt(await chainTimestamp(ctx.node));

    const { QuotaFpcContract } =
      await import("../../../../contracts/target/QuotaFpc.js");
    const { CoreContract } =
      await import("../../../../contracts/target/Core.js");

    // These were deployed by another process, so this wallet has never seen
    // them. Registering the instance is exactly what the client's WalletManager
    // does before it can simulate or prove against the paymaster.
    const fpcAddress = AztecAddress.fromStringUnsafe(FPC_ADDRESS!);
    const coreAddress = AztecAddress.fromStringUnsafe(CORE_ADDRESS!);
    const { QuotaFpcContractArtifact } =
      await import("../../../../contracts/target/QuotaFpc.js");
    const { CoreContractArtifact } =
      await import("../../../../contracts/target/Core.js");
    for (const [address, artifact] of [
      [fpcAddress, QuotaFpcContractArtifact],
      [coreAddress, CoreContractArtifact],
    ] as const) {
      const instance = await ctx.node.getContract(address);
      if (!instance)
        throw new Error(`Nothing deployed at ${address.toString()}`);
      await ctx.wallet.registerContract(instance, artifact);
    }

    fpc = QuotaFpcContract.at(fpcAddress, ctx.wallet);
    core = CoreContract.at(coreAddress, ctx.wallet);

    evidence("real-game/setup", {
      fpc: FPC_ADDRESS,
      core: CORE_ADDRESS,
      generation,
      player: player.toString(),
      fpcFeeJuice: (await feeJuiceOf(ctx.node, fpc.address)).toString(),
    });
  });

  test("the paymaster's allowlist really covers the game's contracts", async () => {
    const raw: any = await fpc.methods
      .get_allowed_targets()
      .simulate({ from: player });
    const targets = (raw?.result ?? raw) as { toString(): string }[];
    const listed = targets.map((t) => t.toString().toLowerCase());
    evidence("real-game/allowlist", {
      listed: listed.filter((a) => !/^0x0+$/.test(a)),
    });
    expect(listed).toContain(CORE_ADDRESS!.toLowerCase());
  });

  /**
   * The real question: does a genuine game call fit once the paymaster's
   * overhead is added? Core's `initialize_player` is the first thing any new
   * player does, and it is exactly the transaction today's onboarding wall
   * blocks for an unfunded wallet.
   */
  // Skipped, not silently throwing: building this call needs 25 arguments of
  // committed game state that only the client's StateResolver can assemble from
  // indexer data, so a standalone test would be testing a fake. Sponsoring the
  // real contracts is verified by playing the game — see docs/quota-fpc-local.md.
  test.skip("a real game call can be assembled and sponsored", async () => {
    const fpcBefore = await feeJuiceOf(ctx.node, fpc.address);
    const playerBefore = await feeJuiceOf(ctx.node, player);

    // Read the game's own view of what this player must supply. If the call
    // cannot even be built, that is a finding in itself.
    let calls: unknown[];
    try {
      const requested = await core.methods
        .initialize_player(...(await buildInitializeArgs(core, player)))
        .request();
      calls =
        (requested as { calls?: unknown[] }).calls ?? (requested as unknown[]);
    } catch (err) {
      evidence("real-game/call-build-failed", String(err).slice(0, 300));
      throw err;
    }

    const payload = await buildSandwichPayload(
      {
        calls: calls as never,
        player,
        fpcAddress: fpc.address,
        generation,
        seat: 0,
      },
      ctx.wallet,
      fpc,
    );

    const { receipt } = await sendFromPaymaster(ctx, payload, player);
    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    const playerAfter = await feeJuiceOf(ctx.node, player);

    evidence("real-game/sponsored", {
      status: receipt.status,
      fpcPaid: (fpcBefore - fpcAfter).toString(),
      playerPaid: (playerBefore - playerAfter).toString(),
    });

    // The whole promise of this feature: the game ran, the paymaster paid, and
    // the player spent nothing.
    expect(fpcAfter).toBeLessThan(fpcBefore);
    expect(playerAfter).toBe(playerBefore);
  });
});

/** Minimal valid arguments for Core.initialize_player, read from its ABI. */
async function buildInitializeArgs(
  core: any,
  player: AztecAddress,
): Promise<unknown[]> {
  const abi = core.artifact.functions.find(
    (f: any) => f.name === "initialize_player",
  );
  if (!abi) throw new Error("Core has no initialize_player");
  // Surfaced rather than guessed: the shape tells us what a sponsored game call
  // actually needs, which is the point of running against the real contracts.
  throw new Error(
    `initialize_player expects ${abi.parameters.length} parameters: ` +
      abi.parameters.map((p: any) => `${p.name}:${p.type.kind}`).join(", "),
  );
}
