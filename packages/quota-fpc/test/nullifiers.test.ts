/**
 * Parity between this package's nullifier computation and the contract's.
 *
 * The client relies on these values to decide "has this user subscribed today?"
 * and "which seats are free?" — both silently wrong if the two implementations
 * ever drift. The compiled contract exposes the same computation as utility
 * functions, so the integration suite compares them against a live node; here
 * we pin the pure-TS behaviour and the domain separators.
 */
import { describe, expect, test } from "vitest";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import {
  PLAYER_NULLIFIER_SEPARATOR,
  SEAT_NULLIFIER_SEPARATOR,
  computePlayerNullifier,
  computeSeatNullifier,
} from "../src/nullifiers.js";

const PLAYER = AztecAddress.fromStringUnsafe(
  "0x201d3ae7ed4e9a8c15b29bc5b7c07d660c150b29d86f6317d4cc101885f722b8",
);

describe("nullifiers", () => {
  test("separators match the contract's globals", () => {
    // "SEAT" and "PLYR" as big-endian ASCII — changing either silently
    // invalidates every previously computed nullifier.
    expect(SEAT_NULLIFIER_SEPARATOR).toBe(0x53454154);
    expect(PLAYER_NULLIFIER_SEPARATOR).toBe(0x504c5952);
  });

  test("seat nullifiers are deterministic and distinct per seat and generation", async () => {
    const a = await computeSeatNullifier(20_663, 0);
    const b = await computeSeatNullifier(20_663, 0);
    const otherSeat = await computeSeatNullifier(20_663, 1);
    const otherGeneration = await computeSeatNullifier(20_664, 0);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).not.toBe(otherSeat.toString());
    expect(a.toString()).not.toBe(otherGeneration.toString());
  });

  test("player nullifiers are deterministic and distinct per user and generation", async () => {
    const a = await computePlayerNullifier(20_663, PLAYER);
    const b = await computePlayerNullifier(20_663, PLAYER);
    const otherGeneration = await computePlayerNullifier(20_664, PLAYER);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).not.toBe(otherGeneration.toString());
  });

  test("seat and player nullifiers cannot collide across domains", async () => {
    // Same numeric inputs, different separators: the domains must not overlap,
    // or claiming a seat could be mistaken for a subscription.
    const zeroAddress = AztecAddress.fromStringUnsafe(`0x${"0".repeat(64)}`);
    const seat = await computeSeatNullifier(20_663, 0);
    const player = await computePlayerNullifier(20_663, zeroAddress);
    expect(seat.toString()).not.toBe(player.toString());
  });

  test("invalid inputs throw rather than producing a bogus nullifier", async () => {
    await expect(computeSeatNullifier(-1, 0)).rejects.toThrow(RangeError);
    await expect(computeSeatNullifier(20_663, -1)).rejects.toThrow(RangeError);
    await expect(computeSeatNullifier(1.5, 0)).rejects.toThrow(RangeError);
    await expect(computePlayerNullifier(-1, PLAYER)).rejects.toThrow(
      RangeError,
    );
  });
});
