/**
 * Re-export move proof validation from shared package.
 * @see @dfpunk/utils
 */

export type {
    MoveProofInputs,
    MoveProofOutputs,
    SnarkConfigLike,
} from '@dfpunk/utils';
export {
    buildMoveProofInputs,
    computeMoveProofOutputs,
    computePlanetHash,
    computeSpaceTypePerlin,
    validateMoveProofOutputs,
} from '@dfpunk/utils';
