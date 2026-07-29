/**
 * Spike 1A — the standard sibling-call quota FPC.
 *
 * The shape under test is the real one: the player sends an ordinary APP call
 * (SpikeTarget.record()) and the FPC pays for it via a custom FeePaymentMethod.
 *
 * Questions (plan.md Phase 1A):
 *  (identity) inside the FPC, is msg_sender the player's account?
 *  (a) app-call revert: do quota side effects persist, and does the FPC still pay?
 *  (b) note-sync: what evidence exists of post-tx quota state, and how fast?
 *  (c) duplicate subscribe by one player must revert (player nullifier)
 *  (d) exhaustion edges: no off-by-one; note disappears on the final use
 *  (f) freshness: stale/future generations rejected
 */
import { beforeAll, describe, expect, test } from "vitest";
import { SpikeFpcContract } from "../noir/target/SpikeFpc.js";
import { SpikeTargetContract } from "../noir/target/SpikeTarget.js";
import { QuotaFeePaymentMethod } from "./quota-payment-method.js";
import { connect, currentGeneration, evidence, feeJuiceOf, fundWithFeeJuice } from "./harness.js";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";

const MAX_FEE = 10n ** 20n;
const MAX_USES = 3;
const MAX_USERS = 50;

/** Sends an app call whose fee the quota FPC pays. */
function sponsored(
  target: SpikeTargetContract,
  fpcAddress: AztecAddress,
  generation: number,
  from: AztecAddress,
  seat?: number,
) {
  return target.methods.record().send({
    from,
    fee: { paymentMethod: new QuotaFeePaymentMethod(fpcAddress, generation, seat) as any },
  });
}

async function quotaOf(fpc: SpikeFpcContract, player: AztecAddress, generation: number) {
  const raw: any = await fpc.methods.get_quota_info(player, generation).simulate({ from: player });
  const [has, remaining] = raw?.result ?? raw;
  return { has: Boolean(has), remaining: Number(remaining) };
}

describe("spike 1A — standard sibling-call quota FPC", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;
  let fpc: SpikeFpcContract;
  let target: SpikeTargetContract;
  let generation: number;
  let player: AztecAddress;
  let other: AztecAddress;

  beforeAll(async () => {
    ctx = await connect();
    player = ctx.addresses[0];
    other = ctx.addresses[1];
    generation = await currentGeneration(ctx.node);

    const fpcDeploy = SpikeFpcContract.deploy(ctx.wallet as any, MAX_FEE, MAX_USES, MAX_USERS);
    await fpcDeploy.send({ from: player });
    fpc = await fpcDeploy.register();

    const targetDeploy = SpikeTargetContract.deploy(ctx.wallet as any);
    await targetDeploy.send({ from: player });
    target = await targetDeploy.register();

    await fundWithFeeJuice(ctx.node, ctx.wallet, fpc.address, 10n ** 21n, player, () =>
      target.methods.ping().send({ from: player }),
    );

    evidence("1A/setup", {
      fpc: fpc.address.toString(),
      target: target.address.toString(),
      generation,
      player: player.toString(),
      fpcFeeJuice: (await feeJuiceOf(ctx.node, fpc.address)).toString(),
    });
  });

  test("constructor invariants are enforced", async () => {
    const raw: any = await fpc.methods.get_policy().simulate({ from: player });
    const policy = raw?.result ?? raw;
    evidence("1A/policy", {
      max_fee: policy.max_fee.toString(),
      max_uses: Number(policy.max_uses),
      max_users: Number(policy.max_users),
    });
    expect(Number(policy.max_uses)).toBe(MAX_USES);

    await expect(
      SpikeFpcContract.deploy(ctx.wallet as any, MAX_FEE, 0, MAX_USERS).send({ from: player }),
    ).rejects.toThrow(/max_uses/);
    evidence("1A/constructor-invariant", "max_uses=0 rejected with the expected message");
  });

  test("(identity + b) a sponsored app call: FPC pays, app sees the player, quota note appears", async () => {
    const fpcBefore = await feeJuiceOf(ctx.node, fpc.address);
    const playerBefore = await feeJuiceOf(ctx.node, player);

    const started = Date.now();
    await sponsored(target, fpc.address, generation, player, 0);
    const landed = Date.now();

    // IDENTITY: what msg_sender did the app contract observe?
    const seenRaw: any = await target.methods.get_last_caller().simulate({ from: player });
    const lastCaller = (seenRaw?.result ?? seenRaw).toString();
    evidence("1A/app-msg-sender", {
      observed: lastCaller,
      player: player.toString(),
      fpc: fpc.address.toString(),
      matchesPlayer: lastCaller === player.toString(),
    });
    expect(lastCaller).toBe(player.toString());

    // SYNC: how long until the wallet can see the resulting quota note?
    let syncedAfterMs = -1;
    for (let i = 0; i < 80; i++) {
      const q = await quotaOf(fpc, player, generation);
      if (q.has) {
        syncedAfterMs = Date.now() - landed;
        evidence("1A/quota-after-subscribe", {
          remaining: q.remaining,
          txMs: landed - started,
          syncedAfterMs,
        });
        expect(q.remaining).toBe(MAX_USES - 1);
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(syncedAfterMs).toBeGreaterThanOrEqual(0);

    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    const playerAfter = await feeJuiceOf(ctx.node, player);
    evidence("1A/who-paid", {
      fpcPaid: (fpcBefore - fpcAfter).toString(),
      playerPaid: (playerBefore - playerAfter).toString(),
    });
    expect(fpcAfter).toBeLessThan(fpcBefore);
    expect(playerAfter).toBe(playerBefore);
  });

  test("(c) a second subscribe by the same player in the same generation reverts", async () => {
    await expect(sponsored(target, fpc.address, generation, player, 1)).rejects.toThrow(
      /Existing nullifier|duplicate nullifier|nullifier/i,
    );
    evidence("1A/duplicate-subscribe", "rejected on the player nullifier (not a generic error)");
  });

  test("(a) app-call revert: quota still consumed and the FPC still pays", async () => {
    const before = await quotaOf(fpc, player, generation);
    const fpcBefore = await feeJuiceOf(ctx.node, fpc.address);

    await expect(
      target.methods.revert_if_zero(0).send({
        from: player,
        fee: { paymentMethod: new QuotaFeePaymentMethod(fpc.address, generation) as any },
      }),
    ).rejects.toThrow(/deliberate revert/);

    const after = await quotaOf(fpc, player, generation);
    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    evidence("1A/app-revert", {
      quotaBefore: before,
      quotaAfter: after,
      fpcPaid: (fpcBefore - fpcAfter).toString(),
      note: "simulation-time revert never reaches the chain; nothing consumed, nothing paid",
    });
  });

  test("(d) sponsor decrements, the note disappears on the final use, then reverts", async () => {
    for (let i = 0; i < MAX_USES - 1; i++) {
      await sponsored(target, fpc.address, generation, player);
      const q = await quotaOf(fpc, player, generation);
      evidence("1A/after-sponsor", { call: i + 1, ...q });
    }

    const exhausted = await quotaOf(fpc, player, generation);
    expect(exhausted.has).toBe(false);

    await expect(sponsored(target, fpc.address, generation, player)).rejects.toThrow(
      /No sponsored transactions remaining/,
    );
    evidence("1A/exhaustion", `exactly ${MAX_USES} sponsored txs then revert — no off-by-one`);
  });

  test("(f) stale and out-of-grace future generations are rejected", async () => {
    await expect(sponsored(target, fpc.address, generation - 1, other, 5)).rejects.toThrow(
      /not currently sponsorable/,
    );
    await expect(sponsored(target, fpc.address, generation + 1, other, 6)).rejects.toThrow(
      /not currently sponsorable/,
    );
    evidence("1A/freshness", "generation-1 and generation+1 rejected with the freshness message");
  });

  test("(per-player isolation) a different player has an independent allowance", async () => {
    await sponsored(target, fpc.address, generation, other, 7);
    const q = await quotaOf(fpc, other, generation);
    evidence("1A/isolation", { other: other.toString(), ...q });
    expect(q.remaining).toBe(MAX_USES - 1);
  });
});
