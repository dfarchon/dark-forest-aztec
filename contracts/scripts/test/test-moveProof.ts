/**
 * Stub: the V52 move/location proof checks are not ported to gasMainRound2.
 *
 * V52 imported `../utils/moveProofValidation.ts`, which does not exist here.
 * This file is intentionally excluded from the fee-measure path.
 *
 * Related checks that exist on gasMainRound2:
 *   pnpm test:decay-match
 *   pnpm check:hash
 *   pnpm admin:zk-checks show
 */
console.error(
    'test-moveProof.ts is not ported to gasMainRound2 (V52-only module ../utils/moveProofValidation.ts).'
);
process.exit(1);
