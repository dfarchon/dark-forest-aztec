/**
 * Seat selection.
 *
 * A generation has `maxUsers` seats; claiming one emits its nullifier, so the
 * protocol's own duplicate-nullifier rejection enforces capacity with no shared
 * counter and therefore no signup race. The client picks a free seat by probing
 * the nullifier tree.
 *
 * Adapted from aztec-kit's seat-picker, including its hard-won guard: an
 * invalid `maxUsers` (undefined slipping through a config) made the original
 * sampling loop spin forever with no thrown error, freezing the page.
 */
import type { AztecAddress } from "@aztec/stdlib/aztec-address";
import { computePlayerNullifier, computeSeatNullifier } from "./nullifiers.js";

/**
 * Nullifier-tree id, per @aztec/stdlib's `MerkleTreeId.NULLIFIER_TREE`.
 * Verified against the enum: it is 0, not 1. Querying the wrong tree makes every
 * claimed seat look free, so capacity is never detected and users collide.
 */
const NULLIFIER_TREE = 0;

/** Node methods this module needs — narrow on purpose, for testability. */
export interface SeatProbeNode {
  findLeavesIndexes(
    blockNumber: number | "latest",
    treeId: number,
    leaves: unknown[],
  ): Promise<(unknown | undefined)[]>;
}

export interface SeatQuery {
  node: SeatProbeNode;
  /** Address of the paymaster, used to silo nullifiers. */
  fpcAddress: AztecAddress;
  generation: number;
  maxUsers: number;
}

export function assertValidMaxUsers(maxUsers: number): void {
  if (!Number.isInteger(maxUsers) || maxUsers <= 0) {
    throw new RangeError(
      `maxUsers must be a positive integer, got ${maxUsers}. ` +
        `An invalid value here previously caused an infinite seat-sampling loop.`,
    );
  }
}

/** Silos a nullifier by contract address, matching the protocol's own scheme. */
async function siloedSeatNullifiers(
  fpcAddress: AztecAddress,
  generation: number,
  seats: number[],
): Promise<unknown[]> {
  const { siloNullifier } = await import("@aztec/stdlib/hash");
  return Promise.all(
    seats.map(async (seat) =>
      siloNullifier(fpcAddress, await computeSeatNullifier(generation, seat)),
    ),
  );
}

/** Which of the given seats are already claimed. */
export async function takenSeats(
  query: SeatQuery,
  seats: number[],
): Promise<Set<number>> {
  assertValidMaxUsers(query.maxUsers);
  if (seats.length === 0) return new Set();

  const nullifiers = await siloedSeatNullifiers(
    query.fpcAddress,
    query.generation,
    seats,
  );
  // The node caps leaves per call; chunk to stay under it.
  const CHUNK = 100;
  const taken = new Set<number>();
  for (let offset = 0; offset < nullifiers.length; offset += CHUNK) {
    const slice = nullifiers.slice(offset, offset + CHUNK);
    const found = await query.node.findLeavesIndexes(
      "latest",
      NULLIFIER_TREE,
      slice,
    );
    found.forEach((entry, i) => {
      if (entry !== undefined && entry !== null) taken.add(seats[offset + i]);
    });
  }
  return taken;
}

/** How many seats remain in this generation. */
export async function countAvailableSeats(query: SeatQuery): Promise<number> {
  assertValidMaxUsers(query.maxUsers);
  const all = Array.from({ length: query.maxUsers }, (_, i) => i);
  return query.maxUsers - (await takenSeats(query, all)).size;
}

/**
 * Picks a free seat, or null when the generation is full.
 *
 * Chooses randomly among free seats rather than taking the lowest: concurrent
 * newcomers would otherwise all pick seat 0 and all but one would fail.
 */
export async function findFreeSeat(
  query: SeatQuery,
  random: () => number = Math.random,
): Promise<number | null> {
  assertValidMaxUsers(query.maxUsers);
  const all = Array.from({ length: query.maxUsers }, (_, i) => i);
  const taken = await takenSeats(query, all);
  const free = all.filter((seat) => !taken.has(seat));
  if (free.length === 0) return null;
  return free[Math.floor(random() * free.length)];
}

/**
 * Whether a user has already claimed their allowance for a generation.
 *
 * This is the missing half of reading allowance state. The note alone cannot
 * tell you: once the last free transaction is used the note is gone, which is
 * indistinguishable from never having subscribed. The player nullifier persists,
 * so note-absent plus nullifier-present means *spent*, while note-absent plus
 * nullifier-absent means *untouched*. Confusing the two makes the client try to
 * subscribe again and fail.
 */
export async function hasSubscribed(query: {
  node: SeatProbeNode;
  fpcAddress: AztecAddress;
  generation: number;
  player: AztecAddress;
}): Promise<boolean> {
  const { siloNullifier } = await import("@aztec/stdlib/hash");
  const nullifier = siloNullifier(
    query.fpcAddress,
    await computePlayerNullifier(query.generation, query.player),
  );
  const found = await query.node.findLeavesIndexes("latest", NULLIFIER_TREE, [
    nullifier,
  ]);
  return found[0] !== undefined && found[0] !== null;
}
