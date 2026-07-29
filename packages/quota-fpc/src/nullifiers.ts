/**
 * Nullifier computation, mirroring the contract exactly.
 *
 * Two nullifiers enforce the allowance:
 *  - PLAYER: one subscription per user per generation.
 *  - SEAT:   at most `maxUsers` distinct seats per generation.
 *
 * The client computes them to answer "has this user subscribed today?" and
 * "which seats are still free?" without sending a transaction. Any drift from
 * the Noir implementation silently breaks both, so the parity tests pin them.
 */
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";

/** Domain separators — must match the contract's globals exactly. */
export const SEAT_NULLIFIER_SEPARATOR = 0x53454154; // "SEAT"
export const PLAYER_NULLIFIER_SEPARATOR = 0x504c5952; // "PLYR"

function assertValidGeneration(generation: number): void {
  if (!Number.isInteger(generation) || generation < 0) {
    throw new RangeError(
      `Generation must be a non-negative integer, got ${generation}`,
    );
  }
}

/**
 * Unsiloed seat nullifier. The protocol silos it by contract address before it
 * reaches the tree, so this value alone cannot collide with another contract's.
 */
export async function computeSeatNullifier(
  generation: number,
  seat: number,
): Promise<Fr> {
  assertValidGeneration(generation);
  if (!Number.isInteger(seat) || seat < 0) {
    throw new RangeError(`Seat must be a non-negative integer, got ${seat}`);
  }
  return poseidon2HashWithSeparator(
    [new Fr(generation), new Fr(seat)],
    SEAT_NULLIFIER_SEPARATOR,
  );
}

/** Unsiloed per-user nullifier: proves whether a user subscribed this generation. */
export async function computePlayerNullifier(
  generation: number,
  player: AztecAddress,
): Promise<Fr> {
  assertValidGeneration(generation);
  return poseidon2HashWithSeparator(
    [new Fr(generation), player.toField()],
    PLAYER_NULLIFIER_SEPARATOR,
  );
}
