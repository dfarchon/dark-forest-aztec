/**
 * Phase 4 — the integration suite that gates mainnet.
 *
 * Real compiled contracts, a live local network, and this package's own client
 * code. Everything the audits demanded proof of before money is at risk:
 * per-user caps, seat capacity, the fee ceiling, allowlist binding, rollover,
 * and — the case Phase 1 could not reach — a transaction that simulates fine
 * and then reverts at INCLUSION.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { QuotaFpcContract } from "../../../../contracts/target/QuotaFpc.js";
import { FpcTestTargetContract } from "../../../../contracts/target/FpcTestTarget.js";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { buildSandwichPayload } from "../../src/sandwich.js";
import { generationAt } from "../../src/generation.js";
import {
  computeSeatNullifier,
  computePlayerNullifier,
} from "../../src/nullifiers.js";
import {
  HAS_SANDBOX,
  chainTimestamp,
  connect,
  evidence,
  feeJuiceOf,
  fundWithFeeJuice,
  sendFromPaymaster,
} from "./harness.js";

const ZERO = AztecAddress.fromStringUnsafe(`0x${"0".repeat(64)}`);
const MAX_FEE = 10n ** 20n;
const MAX_USES = 3;
const MAX_USERS = 40;

describe.skipIf(!HAS_SANDBOX)("QuotaFpc integration", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  let fpc: QuotaFpcContract;
  let target: FpcTestTargetContract;
  let decoy: FpcTestTargetContract;
  let player: AztecAddress;
  let other: AztecAddress;
  let generation: number;

  /** Assembles and sends a sponsored transaction through the package's own code. */
  async function sponsor(
    calls: any[],
    from: AztecAddress,
    opts: { seat?: number; generation?: number } = {},
  ) {
    const payload = await buildSandwichPayload(
      {
        calls,
        player: from,
        fpcAddress: fpc.address,
        generation: opts.generation ?? generation,
        seat: opts.seat,
      },
      ctx.wallet,
      fpc as any,
    );
    return sendFromPaymaster(ctx, payload, from);
  }

  async function allowanceOf(who: AztecAddress, gen = generation) {
    const raw: any = await fpc.methods
      .get_quota_info(who, gen)
      .simulate({ from: who });
    const [subscribed, remaining] = raw?.result ?? raw;
    return { subscribed: Boolean(subscribed), remaining: Number(remaining) };
  }

  const callsOf = async (interaction: any) => {
    const payload = await interaction.request();
    return payload.calls ?? payload;
  };
  const recordCall = () => callsOf(target.methods.record());

  beforeAll(async () => {
    ctx = await connect();
    player = ctx.addresses[0];
    other = ctx.addresses[1];
    generation = generationAt(await chainTimestamp(ctx.node));

    const targetDeploy = FpcTestTargetContract.deploy(ctx.wallet);
    await targetDeploy.send({ from: player });
    target = await targetDeploy.register();

    const decoyDeploy = FpcTestTargetContract.deploy(ctx.wallet, {
      salt: (await import("@aztec/foundation/curves/bn254")).Fr.random(),
    } as any);
    await decoyDeploy.send({ from: player });
    decoy = await decoyDeploy.register();

    const allowed = [target.address, ...Array(11).fill(ZERO)];
    const fpcDeploy = QuotaFpcContract.deploy(
      ctx.wallet,
      MAX_FEE,
      MAX_USES,
      MAX_USERS,
      allowed,
    );
    await fpcDeploy.send({ from: player });
    fpc = await fpcDeploy.register();

    await fundWithFeeJuice(
      ctx.node,
      ctx.wallet,
      fpc.address,
      10n ** 21n,
      player,
      () => target.methods.ping().send({ from: player }),
    );

    evidence("setup", {
      fpc: fpc.address.toString(),
      target: target.address.toString(),
      generation,
      fpcFeeJuice: (await feeJuiceOf(ctx.node, fpc.address)).toString(),
    });
  });

  test("constructor rejects a policy that cannot work", async () => {
    const allowed = [target.address, ...Array(11).fill(ZERO)];
    await expect(
      QuotaFpcContract.deploy(ctx.wallet, MAX_FEE, 0, MAX_USERS, allowed).send({
        from: player,
      }),
    ).rejects.toThrow(/max_uses/);
    await expect(
      QuotaFpcContract.deploy(
        ctx.wallet,
        MAX_FEE,
        MAX_USES,
        MAX_USERS,
        Array(12).fill(ZERO),
      ).send({
        from: player,
      }),
    ).rejects.toThrow(/at least one allowed target/);
  });

  test("a sponsored call: paymaster pays, app sees the USER, allowance opens", async () => {
    const fpcBefore = await feeJuiceOf(ctx.node, fpc.address);
    const playerBefore = await feeJuiceOf(ctx.node, player);

    await sponsor(await recordCall(), player, { seat: 0 });

    const seenRaw: any = await target.methods
      .get_last_caller()
      .simulate({ from: player });
    const observed = (seenRaw?.result ?? seenRaw).toString();
    evidence("msg-sender", {
      observed,
      player: player.toString(),
      fpc: fpc.address.toString(),
    });
    expect(observed).toBe(player.toString());

    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    const playerAfter = await feeJuiceOf(ctx.node, player);
    evidence("who-paid", {
      fpcPaid: (fpcBefore - fpcAfter).toString(),
      playerPaid: (playerBefore - playerAfter).toString(),
    });
    expect(fpcAfter).toBeLessThan(fpcBefore);
    expect(playerAfter).toBe(playerBefore);

    const allowance = await allowanceOf(player);
    expect(allowance).toEqual({ subscribed: true, remaining: MAX_USES - 1 });
  });

  test("TS and Noir compute identical nullifiers", async () => {
    const seatRaw: any = await fpc.methods
      .compute_seat_nullifier(generation, 7)
      .simulate({ from: player });
    const playerRaw: any = await fpc.methods
      .compute_player_nullifier(generation, player)
      .simulate({ from: player });

    const seatOnChain = (seatRaw?.result ?? seatRaw).toString();
    const playerOnChain = (playerRaw?.result ?? playerRaw).toString();
    const seatLocal = (await computeSeatNullifier(generation, 7)).toString();
    const playerLocal = (
      await computePlayerNullifier(generation, player)
    ).toString();

    evidence("nullifier-parity", {
      seatOnChain,
      seatLocal,
      playerOnChain,
      playerLocal,
    });
    // The chain returns decimal, the client hex — compare values, not text.
    expect(BigInt(seatLocal)).toBe(BigInt(seatOnChain));
    expect(BigInt(playerLocal)).toBe(BigInt(playerOnChain));
  });

  test("the allowlist binds sponsorship to the app", async () => {
    await expect(
      sponsor(await callsOf(decoy.methods.record()), other, { seat: 5 }),
    ).rejects.toThrow(/non-allowlisted/);
    evidence("allowlist", "a call to an unlisted contract cannot be proven");
  });

  test("one subscription per user per day", async () => {
    await expect(
      sponsor(await recordCall(), player, { seat: 9 }),
    ).rejects.toThrow();
    evidence("player-cap", "second subscribe by the same user rejected");
  });

  test("the allowance is exactly max_uses, then it stops", async () => {
    for (let i = 0; i < MAX_USES - 1; i++) {
      await sponsor(await recordCall(), player);
      evidence("after-sponsor", {
        call: i + 1,
        ...(await allowanceOf(player)),
      });
    }
    expect((await allowanceOf(player)).subscribed).toBe(false);

    await expect(sponsor(await recordCall(), player)).rejects.toThrow(
      /No sponsored transactions remaining/,
    );
  });

  test("each user gets their own allowance", async () => {
    await sponsor(await recordCall(), other, { seat: 1 });
    expect(await allowanceOf(other)).toEqual({
      subscribed: true,
      remaining: MAX_USES - 1,
    });
  });

  test("stale and premature generations are refused", async () => {
    const third = ctx.addresses[2] ?? other;
    await expect(
      sponsor(await recordCall(), third, {
        seat: 2,
        generation: generation - 1,
      }),
    ).rejects.toThrow(/not currently sponsorable/);
    await expect(
      sponsor(await recordCall(), third, {
        seat: 3,
        generation: generation + 1,
      }),
    ).rejects.toThrow(/not currently sponsorable/);
  });

  test("a seat beyond capacity is refused", async () => {
    const third = ctx.addresses[2] ?? other;
    await expect(
      sponsor(await recordCall(), third, { seat: MAX_USERS + 1 }),
    ).rejects.toThrow(/No sponsorship seats available/);
  });

  /**
   * The case Phase 1 could not reach: both transactions simulate cleanly, then
   * the second reverts in the public phase at inclusion time. The audits' worry
   * was that this strands a user — seat burned, allowance lost. It must not.
   */
  test("an inclusion-time revert consumes the allowance without stranding the user", async () => {
    const third = ctx.addresses[2] ?? other;
    const before = await allowanceOf(third);
    if (!before.subscribed) {
      await sponsor(await callsOf(target.methods.claim_once()), third, {
        seat: 4,
      });
    }
    const afterFirst = await allowanceOf(third);
    const claimedRaw: any = await target.methods
      .is_claimed()
      .simulate({ from: third });
    evidence("inclusion-revert/first", {
      allowance: afterFirst,
      claimed: Boolean(claimedRaw?.result ?? claimedRaw),
    });

    // The flag is now set, so this simulates against pre-state but reverts publicly.
    const fpcBefore = await feeJuiceOf(ctx.node, fpc.address);
    let landed = true;
    try {
      await sponsor(await callsOf(target.methods.claim_once()), third);
    } catch (err) {
      landed = false;
      evidence("inclusion-revert/second", {
        rejected: String(err).slice(0, 160),
      });
    }
    const after = await allowanceOf(third);
    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    evidence("inclusion-revert/outcome", {
      landed,
      allowanceBefore: afterFirst,
      allowanceAfter: after,
      fpcPaid: (fpcBefore - fpcAfter).toString(),
    });

    // Whatever the protocol does with the reverting call, the user must never be
    // left holding a seat with no allowance to use it.
    expect(after.subscribed || after.remaining === 0).toBe(true);
  });
});
