/**
 * Type shim for @alejoamiras/tee-rex.
 * The published package has broken "types" field (points to dist/index.d.ts
 * instead of dist/src/index.d.ts). Re-export from the correct path.
 */
declare module "@alejoamiras/tee-rex" {
  export {
    AttestationError,
    AttestationErrorCode,
    type AttestationVerifyOptions,
    type NitroAttestationDocument,
    verifyNitroAttestation,
  } from "@alejoamiras/tee-rex/dist/src/lib/attestation.js";
  export {
    type AcceleratorStatus,
    type ProverPhase,
    type ProverPhaseData,
    ProvingMode,
    type TeeRexAcceleratorConfig,
    type TeeRexAttestationConfig,
    TeeRexProver,
  } from "@alejoamiras/tee-rex/dist/src/lib/tee-rex-prover.js";
}
