import { beforeAll, describe, expect, test } from "vitest";
import { connect, currentGeneration, evidence, feeJuiceOf } from "./harness.js";

describe("sandbox smoke", () => {
  let ctx: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    ctx = await connect();
  });

  test("connects, has funded test accounts, and exposes chain time", async () => {
    const info = await ctx.node.getNodeInfo();
    evidence("node", { version: info.nodeVersion, chainId: info.l1ChainId });

    expect(ctx.addresses.length).toBeGreaterThan(0);
    const balance = await feeJuiceOf(ctx.node, ctx.addresses[0]);
    evidence("accounts", {
      count: ctx.addresses.length,
      first: ctx.addresses[0].toString(),
      feeJuice: balance.toString(),
    });
    expect(balance).toBeGreaterThan(0n);

    const generation = await currentGeneration(ctx.node);
    evidence("generation", { generation });
    expect(generation).toBeGreaterThan(0);
  });
});
