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
import { appendFileSync, writeFileSync } from "node:fs";
import {
  HAS_SANDBOX,
  chainTimestamp,
  warpChainBy,
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

/**
 * The harness accounts are schnorr_initializerless — the same class the
 * embedded wallet deploys in production — so allowlisting it here proves the
 * REAL positive path. Computed from the installed artifact rather than
 * hardcoded, exactly as the deploy script does, so an @aztec/accounts bump
 * cannot silently break the suite.
 */
async function initializerlessClassId(): Promise<bigint> {
  const { getContractClassFromArtifact } =
    await import("@aztec/aztec.js/contracts");
  const { SchnorrInitializerlessAccountContractArtifact } =
    await import("@aztec/accounts/schnorr");
  const { id } = await getContractClassFromArtifact(
    SchnorrInitializerlessAccountContractArtifact,
  );
  return id.toBigInt();
}

/** Reads the live bundle and returns it with the named fields overridden. */
async function bundleFrom(
  fpc: any,
  overrides: {
    maxFeeWei?: bigint;
    maxUses?: number;
    maxUsers?: number;
    targets?: AztecAddress[];
  },
): Promise<any> {
  const unwrap = (raw: any) => raw?.result ?? raw;
  const from = fpc.address;
  const policy = unwrap(await fpc.methods.get_policy().simulate({ from }));
  const targets = unwrap(
    await fpc.methods.get_allowed_targets().simulate({ from }),
  );
  const pad = (list: AztecAddress[]) => [
    ...list,
    ...Array(12 - list.length).fill(ZERO),
  ];
  return {
    max_fee: overrides.maxFeeWei ?? BigInt(policy.max_fee ?? policy[0]),
    max_uses: overrides.maxUses ?? Number(policy.max_uses ?? policy[1]),
    max_users: overrides.maxUsers ?? Number(policy.max_users ?? policy[2]),
    allowed_targets: overrides.targets ? pad(overrides.targets) : targets,
  };
}

async function currentRevision(fpc: any, from: AztecAddress): Promise<bigint> {
  const raw: any = await fpc.methods
    .get_scheduled_settings()
    .simulate({ from });
  const [, , revision] = raw?.result ?? raw;
  return BigInt(revision);
}

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
    const result = await sendFromPaymaster(ctx, payload, from);
    recordMeasurement(
      opts.seat !== undefined ? "first-of-day" : "subsequent",
      result.receipt,
    );
    return result;
  }

  /**
   * Real fees paid, written out for the calibration script. Without evidence
   * the paymaster's ceiling would be a guess, and it cannot be changed after
   * deployment.
   */
  const measurements: { label: string; feeWei: string }[] = [];
  function recordMeasurement(label: string, receipt: any) {
    const fee = receipt?.transactionFee;
    if (process.env.QUOTA_FPC_MEASURE && typeof fee === "bigint") {
      measurements.push({ label, feeWei: fee.toString() });
    }
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

  /**
   * A paymaster of this test's own, for cases that warp the chain. Warping is
   * global and irreversible, so it must not run against the shared instance
   * the other tests' generations and anchors depend on.
   */
  async function deployOwnFpc(): Promise<QuotaFpcContract> {
    const deploy = QuotaFpcContract.deploy(
      ctx.wallet,
      player,
      MAX_FEE,
      MAX_USES,
      MAX_USERS,
      [target.address, ...Array(11).fill(ZERO)],
      [await initializerlessClassId(), 0n, 0n, 0n],
      true,
    );
    await deploy.send({ from: player });
    const instance = await deploy.register();
    // Its PublicImmutables must be anchored before a private call can read them.
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await instance.methods.get_policy().simulate({ from: player });
        return instance;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }

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
    const allowedClasses = [await initializerlessClassId(), 0n, 0n, 0n];
    const fpcDeploy = QuotaFpcContract.deploy(
      ctx.wallet,
      player, // admin
      MAX_FEE,
      MAX_USES,
      MAX_USERS,
      allowed,
      allowedClasses,
      true,
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
    const classes = [await initializerlessClassId(), 0n, 0n, 0n];
    await expect(
      QuotaFpcContract.deploy(
        ctx.wallet,
        player,
        MAX_FEE,
        0,
        MAX_USERS,
        allowed,
        classes,
        true,
      ).send({
        from: player,
      }),
    ).rejects.toThrow(/max_uses/);
    await expect(
      QuotaFpcContract.deploy(
        ctx.wallet,
        player,
        MAX_FEE,
        MAX_USES,
        MAX_USERS,
        Array(12).fill(ZERO),
        classes,
        true,
      ).send({
        from: player,
      }),
    ).rejects.toThrow(/at least one allowed target/);
    // All-zero account classes would sponsor no account at all — same
    // deploy-a-brick mistake as an empty target allowlist.
    await expect(
      QuotaFpcContract.deploy(
        ctx.wallet,
        player,
        MAX_FEE,
        MAX_USES,
        MAX_USERS,
        allowed,
        [0n, 0n, 0n, 0n],
        true,
      ).send({
        from: player,
      }),
    ).rejects.toThrow(/at least one allowed account class/);
  });

  /**
   * The bootstrap trap. `DelayedPublicMutable` routes every write through the
   * current delay, including the constructor's — so if the delay were declared
   * as 12h, the paymaster would read an all-zero policy (silently, not as an
   * error) and sponsor nothing for its first 12 hours.
   *
   * `beforeAll` already sponsored a transaction against a just-deployed
   * instance, which is the real proof. This pins the mechanism directly.
   */
  test("settings are live at the first post-deploy anchor, not 12h later", async () => {
    const raw: any = await fpc.methods.get_policy().simulate({ from: player });
    const policy = raw?.result ?? raw;
    expect(Number(policy.max_uses ?? policy[1])).toBe(MAX_USES);
    expect(Number(policy.max_users ?? policy[2])).toBe(MAX_USERS);
    expect(BigInt(policy.max_fee ?? policy[0])).toBe(MAX_FEE);

    const targets: any = await fpc.methods
      .get_allowed_targets()
      .simulate({ from: player });
    const live = (targets?.result ?? targets)
      .map((t: any) => t.toString())
      .filter((t: string) => !/^0x0+$/.test(t));
    expect(live).toContain(target.address.toString());
  });

  test("only the admin can schedule a change", async () => {
    const bundle = await bundleFrom(fpc, { maxUses: MAX_USES });
    await expect(
      fpc.methods.schedule_settings(bundle, 0n).send({ from: other }),
    ).rejects.toThrow(/caller is not admin/i);
  });

  test("the setter re-asserts the constructor's invariants", async () => {
    // A zero bundle is fail-closed but would brick sponsorship for 12h with no
    // shortcut, so the guards live in the contract, not only in the tooling.
    const zeroUses = await bundleFrom(fpc, { maxUses: 0 });
    await expect(
      fpc.methods.schedule_settings(zeroUses, 0n).send({ from: player }),
    ).rejects.toThrow(/max_uses/i);

    const noTargets = await bundleFrom(fpc, { targets: [] });
    await expect(
      fpc.methods.schedule_settings(noTargets, 0n).send({ from: player }),
    ).rejects.toThrow(/at least one allowed target/i);
  });

  test("a stale expected_revision is rejected, a correct one replaces", async () => {
    const rev = await currentRevision(fpc, player);
    await fpc.methods
      .schedule_settings(await bundleFrom(fpc, { maxUses: 2 }), rev)
      .send({ from: player });

    // Same revision again: this is the two-operators race, and it must lose.
    await expect(
      fpc.methods
        .schedule_settings(await bundleFrom(fpc, { maxUses: 4 }), rev)
        .send({ from: player }),
    ).rejects.toThrow(/changed since you last read/i);

    // With the new revision it replaces the pending change (no queue).
    await fpc.methods
      .schedule_settings(await bundleFrom(fpc, { maxUses: MAX_USES }), rev + 1n)
      .send({ from: player });
    expect(await currentRevision(fpc, player)).toBe(rev + 2n);
  });

  test("a player whose account class is not allowlisted cannot be sponsored", async () => {
    // A paymaster that allowlists some OTHER class: the harness player's real
    // initializerless account is then exactly the attacker shape C1 described —
    // an account class the operator never blessed. The transaction must not
    // even prove. (No funding needed: the assert fires in private setup.)
    const strangerClasses = [0x1234n, 0n, 0n, 0n];
    const wrongClassDeploy = QuotaFpcContract.deploy(
      ctx.wallet,
      player,
      MAX_FEE,
      MAX_USES,
      MAX_USERS,
      [target.address, ...Array(11).fill(ZERO)],
      strangerClasses,
      true,
    );
    await wrongClassDeploy.send({ from: player });
    const wrongClassFpc = await wrongClassDeploy.register();

    // The sponsorship proof reads PublicImmutables against an anchor block, so
    // wait until this brand-new instance's initialization is actually visible —
    // otherwise the send fails on "uninitialized PublicImmutable" before ever
    // reaching the assert under test.
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await wrongClassFpc.methods.get_policy().simulate({ from: player });
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }

    const payload = await buildSandwichPayload(
      {
        calls: await recordCall(),
        player,
        fpcAddress: wrongClassFpc.address,
        generation,
        seat: 0,
      },
      ctx.wallet,
      wrongClassFpc as any,
    );
    await expect(sendFromPaymaster(ctx, payload, player)).rejects.toThrow(
      /account class is not sponsored/i,
    );
    evidence(
      "account-class-binding",
      "an account class outside the allowlist cannot be proven",
    );
  });

  /**
   * The upgrade bypass, closed. An account whose class IS allowlisted must
   * still be refused when it is PUBLISHED, because only a published account
   * can call `ContractInstanceRegistry::update` and swap itself for hostile
   * code that the paymaster would then sponsor (the paymaster can only see the
   * original class). Publishing is the precondition for that attack, so it is
   * what this rejects — no 24h upgrade delay needed to prove the property.
   */
  test("a published account is refused even with an allowlisted class", async () => {
    const { publishInstance, publishContractClass } =
      await import("@aztec/aztec.js/deployment");
    const { Fr, Fq } = await import("@aztec/foundation/curves/bn254");
    const { SchnorrInitializerlessAccountContractArtifact } =
      await import("@aztec/accounts/schnorr");

    // Publishing an instance requires its class to be publicly registered.
    // Embedded-wallet accounts normally are neither — which is exactly why
    // they stay eligible for sponsorship. Publication is permanent, so this is
    // conditional: a re-run against the same chain must not fail on a class
    // an earlier run already published.
    const classId = await initializerlessClassId();
    const { isContractClassPubliclyRegistered } =
      await ctx.wallet.getContractClassMetadata(new Fr(classId));
    if (!isContractClassPubliclyRegistered) {
      await (
        await publishContractClass(
          ctx.wallet,
          SchnorrInitializerlessAccountContractArtifact,
        )
      ).send({ from: player });
    }

    // A REAL account of the blessed class, deliberately published. Publishing
    // is what unlocks `ContractInstanceRegistry::update`, so this is precisely
    // the shape that could upgrade itself to hostile code — and the one the
    // paymaster must refuse even though its class is allowlisted.
    // A dedicated account, not one the other tests sponsor: publishing is
    // permanent, so borrowing a shared address would make this test's effects
    // leak into them depending on run order.
    const victimAccount = await ctx.wallet.createSchnorrInitializerlessAccount(
      Fr.random(),
      Fr.random(),
      Fq.random(),
    );
    const victim = victimAccount.address;
    const { instance: victimInstance } =
      await ctx.wallet.getContractMetadata(victim);
    // The metadata returns the address PREIMAGE, which carries only the
    // original class; publishInstance reads `currentContractClassId`. They are
    // the same thing for an account that has never been updated — which this
    // one, being unpublished until now, necessarily has not.
    await publishInstance(ctx.wallet, {
      ...(victimInstance as any),
      currentContractClassId: (victimInstance as any).originalContractClassId,
    } as any).send({ from: player });

    // Assert it really is published; an unlanded publish would make the
    // rejection below prove nothing at all.
    const publishedDeadline = Date.now() + 120_000;
    for (;;) {
      const { isContractPublished } =
        await ctx.wallet.getContractMetadata(victim);
      if (isContractPublished) break;
      if (Date.now() > publishedDeadline) {
        throw new Error(
          `${victim} was never published; the test cannot prove anything`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const publishedAddress = victim;
    const publishedFpcDeploy = QuotaFpcContract.deploy(
      ctx.wallet,
      player,
      MAX_FEE,
      MAX_USES,
      MAX_USERS,
      [target.address, ...Array(11).fill(ZERO)],
      // Its class IS the blessed one, so only the unpublished requirement
      // can reject it — exactly the property under test.
      [await initializerlessClassId(), 0n, 0n, 0n],
      true,
    );
    await publishedFpcDeploy.send({ from: player });
    const publishedFpc = await publishedFpcDeploy.register();

    // Fund it. An unfunded paymaster is rejected by the NODE for fee-payer
    // balance — which would mask whether the private assert fired at all, and
    // would let this test pass even if the binding were broken.
    await fundWithFeeJuice(
      ctx.node,
      ctx.wallet,
      publishedFpc.address,
      10n ** 21n,
      player,
      () => target.methods.ping().send({ from: player }),
    );

    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        await publishedFpc.methods.get_policy().simulate({ from: player });
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }

    const payload = await buildSandwichPayload(
      {
        calls: await recordCall(),
        player: publishedAddress,
        fpcAddress: publishedFpc.address,
        generation,
        seat: 0,
      },
      ctx.wallet,
      publishedFpc as any,
    );
    // The class matches, so only the unpublished requirement can reject this —
    // assert on ITS failure (the non-inclusion proof), not merely that
    // something threw, or an unrelated error would score as a pass.
    await expect(
      sendFromPaymaster(ctx, payload, publishedAddress),
    ).rejects.toThrow(/nullifier non-inclusion/i);
    evidence(
      "upgrade-bypass-closed",
      "a published (therefore upgradeable) account is refused despite an allowlisted class",
    );
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
    // The last pop's nullifier reaches the viewer one sync behind the
    // transaction itself (the same lag the in-game badge has), so tolerate a
    // short delay before asserting exhaustion.
    const deadline = Date.now() + 30_000;
    while ((await allowanceOf(player)).subscribed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
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
    // A transaction that is INCLUDED and then reverts still throws here — the
    // wait rejects on a reverted receipt. Telling that apart from a failure
    // before submission is the whole point, so classify on the error itself
    // rather than on the fact that one was raised.
    let includedAndReverted = false;
    try {
      await sponsor(await callsOf(target.methods.claim_once()), third);
    } catch (err) {
      const message = String(err);
      includedAndReverted = /reverted/i.test(message);
      evidence("inclusion-revert/second", {
        includedAndReverted,
        rejected: message.slice(0, 160),
      });
    }
    const after = await allowanceOf(third);
    const fpcAfter = await feeJuiceOf(ctx.node, fpc.address);
    evidence("inclusion-revert/outcome", {
      includedAndReverted,
      allowanceBefore: afterFirst,
      allowanceAfter: after,
      fpcPaid: (fpcBefore - fpcAfter).toString(),
    });

    // The audit caught the previous assertion here being tautologically true
    // (absence returns (false, 0), so `subscribed || remaining === 0` always
    // held). Assert the two things that actually matter instead: the revert
    // consumed exactly one use, and the paymaster really paid for it.
    if (includedAndReverted) {
      // Landed and failed in the public phase: it consumed exactly one use and
      // the paymaster really paid, while the player keeps their seat and the
      // rest of the allowance.
      expect(after.remaining).toBe(afterFirst.remaining - 1);
      expect(after.subscribed).toBe(true);
      expect(fpcBefore - fpcAfter).toBeGreaterThan(0n);
    } else {
      // Rejected before submission: nothing spent at all.
      expect(after.remaining).toBe(afterFirst.remaining);
      expect(fpcBefore - fpcAfter).toBe(0n);
    }
  });
  /**
   * The point of the whole phase: a scheduled change is NOT in effect before
   * its activation time, and IS after. Runs on its own instance because
   * warping the chain 12h forward invalidates every generation and anchor the
   * shared tests depend on.
   */
  test("a change is inert before its activation time and binds after", async () => {
    const own = await deployOwnFpc();
    const rev = await currentRevision(own, player);

    await own.methods
      .schedule_settings(await bundleFrom(own, { maxUsers: 7 }), rev)
      .send({ from: player });

    const before: any = await own.methods
      .get_policy()
      .simulate({ from: player });
    expect(Number((before?.result ?? before).max_users)).toBe(MAX_USERS);

    // 12h + a minute, then a transaction so a block carries the new time.
    await warpChainBy(ctx.node, 43_260, () =>
      target.methods.ping().send({ from: player }),
    );

    const after: any = await own.methods
      .get_policy()
      .simulate({ from: player });
    expect(Number((after?.result ?? after).max_users)).toBe(7);
    evidence("activation", "inert before the delay elapsed, in force after");
  });

  /**
   * Clamping. A player holding an allowance issued under a larger policy must
   * be bound by the reduction at activation — otherwise old cohorts keep
   * spending under a later, higher fee ceiling and the loss bound is false.
   */
  test("a reduction clamps allowances already issued", async () => {
    const own = await deployOwnFpc();
    await fundWithFeeJuice(
      ctx.node,
      ctx.wallet,
      own.address,
      10n ** 21n,
      player,
      () => target.methods.ping().send({ from: player }),
    );

    const gen = generationAt(await chainTimestamp(ctx.node));
    const claimant = ctx.addresses[2] ?? other;
    const payload = await buildSandwichPayload(
      {
        calls: await recordCall(),
        player: claimant,
        fpcAddress: own.address,
        generation: gen,
        seat: 0,
      },
      ctx.wallet,
      own as any,
    );
    await sendFromPaymaster(ctx, payload, claimant);

    const held: any = await own.methods
      .get_quota_info(claimant, gen)
      .simulate({ from: claimant });
    const [, heldRemaining] = held?.result ?? held;
    expect(Number(heldRemaining)).toBe(MAX_USES - 1);

    // Cut the per-player allowance to exactly what they have already spent.
    const rev = await currentRevision(own, player);
    await own.methods
      .schedule_settings(await bundleFrom(own, { maxUses: 1 }), rev)
      .send({ from: player });
    await warpChainBy(ctx.node, 43_260, () =>
      target.methods.ping().send({ from: player }),
    );

    // Their allowance is gone, not merely smaller: they spent 1, the cap is 1.
    const now: any = await own.methods
      .get_quota_info(claimant, gen)
      .simulate({ from: claimant });
    const [stillOn, nowRemaining] = now?.result ?? now;
    expect(Boolean(stillOn)).toBe(false);
    expect(Number(nowRemaining)).toBe(0);
    evidence(
      "clamp",
      "a reduction bound an allowance issued under the old policy",
    );
  });

  // Runs last on purpose: it reports what the earlier tests actually paid.
  test("measurements are captured for calibration when asked", async () => {
    if (!process.env.QUOTA_FPC_MEASURE) return;
    // Written even if empty so a silent miss is visible rather than assumed.
    const out = process.env.QUOTA_FPC_MEASURE;
    writeFileSync(out, `${JSON.stringify(measurements, null, 2)}\n`);
    evidence("measurements", { file: out, count: measurements.length });
  });
});
