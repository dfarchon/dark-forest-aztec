/**
 * Move proof validation utilities.
 *
 * Computes move circuit outputs (source_hash, target_hash, perlin) using the same
 * logic as the client: Poseidon2(planetHashKey, x, y) and perlin for space type.
 * Use these to validate move args before submission and to prepare for contract
 * proof verification when ZK checks are enabled.
 *
 * Matches: contracts/circuits/src/circuits/move.nr move_proof()
 */

import { Fr } from "@aztec/aztec.js/fields";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import { perlin } from "@dfpunk/hashing";

export interface SnarkConfigLike {
  planethash_key: bigint | number;
  spacetype_key: bigint | number;
  perlin_length_scale: bigint | number;
  perlin_mirror_x: boolean;
  perlin_mirror_y: boolean;
}

export interface MoveProofInputs {
  r: bigint;
  distMax: bigint;
  planetHashKey: bigint;
  spaceTypeKey: bigint;
  scale: bigint;
  xMirror: boolean;
  yMirror: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MoveProofOutputs {
  sourceHash: bigint;
  targetHash: bigint;
  perlin: number;
}

function toFr(n: number | bigint): Fr {
  const v = typeof n === "bigint" ? n : BigInt(n);
  return new Fr(v < 0n ? v + Fr.MODULUS : v);
}

/**
 * Compute planet hash (location ID) at (x, y) using Poseidon2.
 * Order: [planetHashKey, x, y] - matches client poseidon2Hash([planetHashKey, x, y]).
 */
export async function computePlanetHash(
  planetHashKey: bigint,
  x: number,
  y: number
): Promise<bigint> {
  const result = await poseidon2Hash([new Fr(planetHashKey), toFr(x), toFr(y)]);
  const hexString = result.toString().replace(/^0x/, "");
  return BigInt("0x" + hexString);
}

/**
 * Compute perlin value at (x, y) for space type using Poseidon2 for gradient index.
 * Matches circuit multi_scale_perlin (poseidon2_hash for rand). Uses floor: true for u8.
 */
export function computeSpaceTypePerlin(
  x: number,
  y: number,
  spaceTypeKey: number,
  scale: number,
  mirrorX: boolean,
  mirrorY: boolean
): number {
  return perlin(
    { x, y },
    {
      key: spaceTypeKey,
      scale,
      mirrorX,
      mirrorY,
      floor: true,
    }
  );
}

/**
 * Compute move proof outputs (source_hash, target_hash, perlin) from coordinates.
 * These match what the Noir move_proof circuit returns.
 */
export async function computeMoveProofOutputs(
  inputs: MoveProofInputs
): Promise<MoveProofOutputs> {
  const sourceHash = await computePlanetHash(
    inputs.planetHashKey,
    inputs.x1,
    inputs.y1
  );
  const targetHash = await computePlanetHash(
    inputs.planetHashKey,
    inputs.x2,
    inputs.y2
  );
  const perlinVal = computeSpaceTypePerlin(
    inputs.x2,
    inputs.y2,
    Number(inputs.spaceTypeKey),
    Number(inputs.scale),
    inputs.xMirror,
    inputs.yMirror
  );
  return { sourceHash, targetHash, perlin: perlinVal };
}

// ============================================================================
// Single-location proof (init / reveal / safe_set_owner)
// ============================================================================

export interface LocationProofInputs {
  planetHashKey: bigint;
  spaceTypeKey: bigint;
  scale: bigint;
  xMirror: boolean;
  yMirror: boolean;
  x: number;
  y: number;
}

export interface LocationProofOutputs {
  locationHash: bigint;
  perlin: number;
}

/**
 * Build LocationProofInputs from SnarkConfig and coordinates.
 */
export function buildLocationProofInputs(
  snarkConfig: SnarkConfigLike,
  x: number,
  y: number
): LocationProofInputs {
  return {
    planetHashKey: BigInt(snarkConfig.planethash_key),
    spaceTypeKey: BigInt(snarkConfig.spacetype_key),
    scale: BigInt(snarkConfig.perlin_length_scale),
    xMirror: snarkConfig.perlin_mirror_x,
    yMirror: snarkConfig.perlin_mirror_y,
    x,
    y,
  };
}

/**
 * Compute single-location proof outputs (locationHash, perlin).
 * Matches init_proof / reveal_proof / safe_set_owner ZK checks in Noir.
 */
export async function computeLocationProofOutputs(
  inputs: LocationProofInputs
): Promise<LocationProofOutputs> {
  const locationHash = await computePlanetHash(
    inputs.planetHashKey,
    inputs.x,
    inputs.y
  );
  const perlinVal = computeSpaceTypePerlin(
    inputs.x,
    inputs.y,
    Number(inputs.spaceTypeKey),
    Number(inputs.scale),
    inputs.xMirror,
    inputs.yMirror
  );
  return { locationHash, perlin: perlinVal };
}

/**
 * Validate that computed location proof outputs match expected locationId and perlin.
 */
export function validateLocationProofOutputs(
  expectedLocationId: bigint,
  expectedPerlin: number,
  outputs: LocationProofOutputs
): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (outputs.locationHash !== expectedLocationId) {
    mismatches.push(
      `locationHash mismatch: expected ${expectedLocationId}, got ${outputs.locationHash}`
    );
  }
  const perlinExpected = Math.floor(expectedPerlin);
  const perlinGot = Math.floor(outputs.perlin);
  if (perlinGot !== perlinExpected) {
    mismatches.push(
      `perlin mismatch: expected ${perlinExpected}, got ${perlinGot} (raw: ${outputs.perlin})`
    );
  }
  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}

// ============================================================================
// Move proof
// ============================================================================

/**
 * Build MoveProofInputs from SnarkConfig and move parameters.
 */
export function buildMoveProofInputs(
  snarkConfig: SnarkConfigLike,
  r: bigint,
  distMax: bigint,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): MoveProofInputs {
  return {
    r,
    distMax,
    planetHashKey: BigInt(snarkConfig.planethash_key),
    spaceTypeKey: BigInt(snarkConfig.spacetype_key),
    scale: BigInt(snarkConfig.perlin_length_scale),
    xMirror: snarkConfig.perlin_mirror_x,
    yMirror: snarkConfig.perlin_mirror_y,
    x1,
    y1,
    x2,
    y2,
  };
}

/**
 * Validate that computed proof outputs match expected sourceLoc, targetLoc, targetPerlin.
 * Returns true if all match.
 */
export function validateMoveProofOutputs(
  sourceLoc: bigint,
  targetLoc: bigint,
  targetPerlin: number,
  outputs: MoveProofOutputs
): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  if (outputs.sourceHash !== sourceLoc) {
    mismatches.push(
      `sourceHash mismatch: expected ${sourceLoc}, got ${outputs.sourceHash}`
    );
  }
  if (outputs.targetHash !== targetLoc) {
    mismatches.push(
      `targetHash mismatch: expected ${targetLoc}, got ${outputs.targetHash}`
    );
  }
  const perlinExpected = Math.floor(targetPerlin);
  const perlinGot = Math.floor(outputs.perlin);
  if (perlinGot !== perlinExpected) {
    mismatches.push(
      `perlin mismatch: expected ${perlinExpected}, got ${perlinGot} (raw: ${outputs.perlin})`
    );
  }
  if (
    mismatches.length > 0 &&
    typeof console !== "undefined" &&
    console.debug
  ) {
    console.debug("[validateMoveProofOutputs] expected:", {
      sourceLoc: sourceLoc.toString(),
      targetLoc: targetLoc.toString(),
      targetPerlin: perlinExpected,
    });
    console.debug("[validateMoveProofOutputs] got:", {
      sourceHash: outputs.sourceHash.toString(),
      targetHash: outputs.targetHash.toString(),
      perlin: perlinGot,
      perlinRaw: outputs.perlin,
    });
  }
  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}
