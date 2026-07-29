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
    async findLeavesIndexes(_block, tree, leaves) {
      // Asserting the tree id here is the point: the mock previously ignored it,
      // which hid the client querying the wrong tree entirely.
      if (tree !== 0) {
        throw new Error(`expected the nullifier tree (0), got ${tree}`);
      }
      // Leaves must be resolved values. An unawaited promise reaches the real
      // RPC layer as an opaque object and fails schema validation with a
      // message that points nowhere near the cause.
      for (const leaf of leaves) {
        if (
          leaf instanceof Promise ||
          typeof (leaf as { then?: unknown })?.then === "function"
        ) {
          throw new Error("leaf value is a promise — it was not awaited");
        }
      }
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

describe("hasSubscribed", () => {
  test("passes resolved leaf values to the node, never promises", async () => {
    const { hasSubscribed } = await import("../src/seat-picker.js");
    const seen: unknown[] = [];
    const node: SeatProbeNode = {
      async findLeavesIndexes(_block, tree, leaves) {
        expect(tree).toBe(0);
        seen.push(...leaves);
        return leaves.map(() => undefined);
      },
    };

    const player = AztecAddress.fromStringUnsafe(
      "0x201d3ae7ed4e9a8c15b29bc5b7c07d660c150b29d86f6317d4cc101885f722b8",
    );
    const subscribed = await hasSubscribed({
      node,
      fpcAddress: FPC,
      generation: 20_663,
      player,
    });

    expect(subscribed).toBe(false);
    expect(seen).toHaveLength(1);
    // The regression this pins: an unawaited siloNullifier promise here made
    // every allowance read fail, which silently disabled sponsorship.
    expect(typeof (seen[0] as { then?: unknown })?.then).not.toBe("function");
    expect(String(seen[0])).toMatch(/^0x[0-9a-f]+$/i);
  });

  test("reports a claimed allowance when the nullifier is present", async () => {
    const { hasSubscribed } = await import("../src/seat-picker.js");
    const node: SeatProbeNode = {
      async findLeavesIndexes(_block, _tree, leaves) {
        return leaves.map(() => 7);
      },
    };
    const player = AztecAddress.fromStringUnsafe(
      "0x201d3ae7ed4e9a8c15b29bc5b7c07d660c150b29d86f6317d4cc101885f722b8",
    );
    expect(
      await hasSubscribed({
        node,
        fpcAddress: FPC,
        generation: 20_663,
        player,
      }),
    ).toBe(true);
  });
});
