/**
 * Re-export move proof helpers from [client/src/utils/moveProofValidation.ts](client/src/utils/moveProofValidation.ts) (single source of truth).
 */

export type {
    LocationProofInputs,
    LocationProofOutputs,
    MoveProofInputs,
    MoveProofOutputs,
    SnarkConfigLike,
} from '../../../client/src/utils/moveProofValidation.ts';
export {
    buildLocationProofInputs,
    buildMoveProofInputs,
    computeLocationProofOutputs,
    computeMoveProofOutputs,
    computePlanetHash,
    computeSpaceTypePerlin,
    validateLocationProofOutputs,
    validateMoveProofOutputs,
} from '../../../client/src/utils/moveProofValidation.ts';
