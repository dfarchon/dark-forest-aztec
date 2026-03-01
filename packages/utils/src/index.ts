/**
 * @dfpunk/utils - shared utilities for dfpunk-aztec
 */

export {
  buildLocationProofInputs,
  buildMoveProofInputs,
  computeBiomebasePerlin,
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
