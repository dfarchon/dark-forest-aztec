import { describe, expect, test } from "vitest";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import {
  assertValidMaxUsers,
  countAvailableSeats,
  findFreeSeat,
  type SeatProbeNode,
} from "../src/seat-picker.js";

const FPC = AztecAddress.fromStringUnsafe(
  "0x2f841a5811740dee2a0cb96fe9903312453e1fd5736b8e663105cb3fa95155c2",
);

/** A node where the given seat indexes are already claimed. */
function nodeWithTakenSeats(
  takenIndexes: number[],
  maxUsers: number,
): SeatProbeNode {
  return {
    async findLeavesIndexes(_block, _tree, leaves) {
      // Leaves arrive in seat order, chunked; map each back by position.
      return leaves.map((_, i) => (takenIndexes.includes(i) ? 1 : undefined));
    },
  };
}

describe("seat picker", () => {
  test("rejects an invalid maxUsers loudly", () => {
    // Guards the infinite-loop failure inherited from the reference implementation.
    expect(() => assertValidMaxUsers(undefined as unknown as number)).toThrow(
      RangeError,
    );
    expect(() => assertValidMaxUsers(0)).toThrow(RangeError);
    expect(() => assertValidMaxUsers(-5)).toThrow(RangeError);
    expect(() => assertValidMaxUsers(2.5)).toThrow(RangeError);
    expect(() => assertValidMaxUsers(50)).not.toThrow();
  });

  test("counts remaining seats", async () => {
    const query = {
      node: nodeWithTakenSeats([0, 1, 2], 10),
      fpcAddress: FPC,
      generation: 20_663,
      maxUsers: 10,
    };
    expect(await countAvailableSeats(query)).toBe(7);
  });

  test("returns null when the day is full rather than a bogus seat", async () => {
    const all = Array.from({ length: 4 }, (_, i) => i);
    const query = {
      node: nodeWithTakenSeats(all, 4),
      fpcAddress: FPC,
      generation: 20_663,
      maxUsers: 4,
    };
    expect(await findFreeSeat(query)).toBeNull();
  });

  test("only ever picks a free seat", async () => {
    const query = {
      node: nodeWithTakenSeats([0, 2, 4], 6),
      fpcAddress: FPC,
      generation: 20_663,
      maxUsers: 6,
    };
    // Sweep the random source across its whole range; every pick must be free.
    for (const r of [0, 0.34, 0.5, 0.99]) {
      const seat = await findFreeSeat(query, () => r);
      expect([1, 3, 5]).toContain(seat);
    }
  });

  test("picks randomly rather than always the lowest free seat", async () => {
    // Concurrent newcomers all taking seat 0 would collide by construction.
    const query = {
      node: nodeWithTakenSeats([], 10),
      fpcAddress: FPC,
      generation: 20_663,
      maxUsers: 10,
    };
    expect(await findFreeSeat(query, () => 0)).toBe(0);
    expect(await findFreeSeat(query, () => 0.95)).toBe(9);
  });
});
