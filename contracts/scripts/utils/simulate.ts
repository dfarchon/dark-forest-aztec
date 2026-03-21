/**
 * Aztec.js `simulate()` may return `{ result, offchainEffects, offchainMessages }`.
 * Unwrap so struct fields / Fr values match what the rest of the app expects.
 */
export function unwrapSimulateResult(v: unknown): unknown {
    if (v !== null && typeof v === 'object' && 'result' in v) {
        return (v as { result: unknown }).result;
    }
    return v;
}
