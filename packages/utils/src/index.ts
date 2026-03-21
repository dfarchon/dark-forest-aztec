/**
 * @dfpunk/utils - shared utilities for dfpunk-aztec
 */

export {
  buildLocationProofInputs,
  buildMoveProofInputs,
  computeLocationProofOutputs,
  computeMoveProofOutputs,
  computePlanetHash,
  computeSpaceTypePerlin,
  validateLocationProofOutputs,
  validateMoveProofOutputs,
} from "./moveProofValidation";
export type {
  LocationProofInputs,
  LocationProofOutputs,
  MoveProofInputs,
  MoveProofOutputs,
  SnarkConfigLike,
} from "./moveProofValidation";
export { unwrapSimulateResult } from "./simulate";
