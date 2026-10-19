/**
 * Initialize a completed deployment. Safe to rerun after interruption.
 *
 *   pnpm bootstrap
 *   pnpm bootstrap --from <step-id|number>
 *   pnpm bootstrap --id <deployment-id>
 */
import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { openBootstrapContext, parseBootstrapTargetArgs } from './context.ts';
import { buildBootstrapSteps } from './runtime.ts';
import {
    BOOTSTRAP_STEP_META,
    decideStepAction,
    formatBootstrapUsage,
    parseBootstrapArgs,
    resolveStartIndex,
    TOTAL_BOOTSTRAP_STEPS,
} from './steps.ts';

function formatElapsed(ms: number): string {
    if (ms >= 60_000) {
        return `${Math.floor(ms / 60_000)}m ${((ms % 60_000) / 1000).toFixed(1)}s`;
    }
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function main(): Promise<void> {
    const target = parseBootstrapTargetArgs(process.argv.slice(2));
    const parsed = parseBootstrapArgs(target.rest);
    if (!parsed.ok) throw new Error(parsed.error);
    if (parsed.options.help) {
        console.log(formatBootstrapUsage());
        return;
    }
    const resolved = resolveStartIndex(parsed.options);
    if (!resolved.ok) throw new Error(resolved.error);
    const { startIndex, legacy } = resolved;
    if (legacy) {
        console.warn(
            `Legacy positional step detected. Prefer: pnpm bootstrap --from ${startIndex}`
        );
    }
    if (startIndex > 1) {
        const step = BOOTSTRAP_STEP_META[startIndex - 1]!;
        console.log(
            `Resuming from ${startIndex} (${step.id}); checking earlier dependencies.`
        );
    }

    const startedAt = Date.now();
    const context = await openBootstrapContext({
        id: target.id,
        commandHint: 'pnpm bootstrap',
    });
    const steps = buildBootstrapSteps(context);
    let executed = 0;
    let skippedComplete = 0;
    let skippedFrom = 0;

    console.log(`\nBootstrapping ${TOTAL_BOOTSTRAP_STEPS} steps...\n`);
    for (const step of steps) {
        const status = await step.check();
        const decision = decideStepAction({
            step: step.meta,
            status,
            startIndex,
        });
        const tag = `[${step.meta.index}/${TOTAL_BOOTSTRAP_STEPS}] ${step.meta.id}`;
        if (decision.action === 'abort') {
            throw new Error(decision.message);
        }
        if (decision.action === 'skip') {
            if (decision.reason === 'before_from') {
                skippedFrom += 1;
                console.log(`${tag} skipped (--from; on-chain: ${status})`);
            } else {
                skippedComplete += 1;
                console.log(`${tag} complete`);
            }
            continue;
        }
        console.log(`${tag} ${step.meta.label}`);
        const stepStartedAt = Date.now();
        await step.execute();
        executed += 1;
        console.log(
            `  executed in ${formatElapsed(Date.now() - stepStartedAt)}`
        );
    }

    console.log('\nBootstrap complete.');
    console.log(
        `executed=${executed} skipped_complete=${skippedComplete} skipped_from=${skippedFrom}`
    );
    console.log(`elapsed=${formatElapsed(Date.now() - startedAt)}`);
}

main().catch((err) => {
    if (exitIfAccountFundingRequired(err)) return;
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
