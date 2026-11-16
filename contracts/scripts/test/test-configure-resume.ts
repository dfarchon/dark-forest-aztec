/**
 * Stub: the V52 configure-resume checks are not ported to gasMainRound2.
 *
 * V52 imported `../deploy/configureResume.ts`, which does not exist here. The same
 * logic now lives in `scripts/bootstrap/` (classify.ts, steps.ts). Use:
 *   pnpm bootstrap:steps    - list bootstrap steps
 *   pnpm bootstrap:status   - classify on-chain state per step
 *
 * This file is intentionally excluded from the fee-measure path.
 */
console.error(
    'test-configure-resume.ts is not ported to gasMainRound2 (V52-only module ../deploy/configureResume.ts).\n' +
        'Use `pnpm bootstrap:status` / `pnpm bootstrap:steps` instead.'
);
process.exit(1);
