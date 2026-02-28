/**
 * Re-export proof validation from shared package.
 * @see @dfpunk/utils
 */

export type {
    LocationProofInputs,
    LocationProofOutputs,
    MoveProofInputs,
    MoveProofOutputs,
    SnarkConfigLike,
} from '@dfpunk/utils';
export {
    buildLocationProofInputs,
    buildMoveProofInputs,
    computeLocationProofOutputs,
    computeMoveProofOutputs,
    computePlanetHash,
    computeSpaceTypePerlin,
    validateLocationProofOutputs,
    validateMoveProofOutputs,
} from '@dfpunk/utils';
