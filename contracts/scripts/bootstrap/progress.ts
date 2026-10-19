/**
 * Read-only bootstrap progress report.
 *
 *   pnpm bootstrap:steps
 *   pnpm bootstrap:steps --id <deployment-id>
 */
import { openBootstrapContext, parseBootstrapTargetArgs } from './context.ts';
import { buildBootstrapSteps } from './runtime.ts';
import { TOTAL_BOOTSTRAP_STEPS } from './steps.ts';

async function main(): Promise<void> {
    const target = parseBootstrapTargetArgs(process.argv.slice(2));
    if (target.rest.filter((arg) => arg !== '--').length > 0) {
        throw new Error('Usage: pnpm bootstrap:steps [--id <deployment-id>]');
    }
    const context = await openBootstrapContext({
        id: target.id,
        commandHint: 'pnpm bootstrap:steps',
        readonly: true,
    });
    const steps = buildBootstrapSteps(context);
    let complete = 0;
    let needed = 0;
    let conflict = 0;
    let firstNeeded: (typeof steps)[number] | undefined;

    console.log(`\nBootstrap progress (${TOTAL_BOOTSTRAP_STEPS} steps)\n`);
    for (const step of steps) {
        const status = await step.check();
        if (status === 'complete') complete += 1;
        if (status === 'needed') {
            needed += 1;
            firstNeeded ??= step;
        }
        if (status === 'conflict') conflict += 1;
        console.log(
            `[${String(step.meta.index).padStart(2)}/${TOTAL_BOOTSTRAP_STEPS}] ${status.padEnd(8)} ${step.meta.id}`
        );
    }

    console.log(`\ncomplete=${complete} needed=${needed} conflict=${conflict}`);
    if (conflict > 0) {
        console.log('Resolve conflicts before resuming bootstrap.');
        process.exitCode = 1;
    } else if (firstNeeded) {
        console.log(
            `Resume with: pnpm bootstrap --from ${firstNeeded.meta.index}` +
                (target.id ? ` --id ${target.id}` : '')
        );
    } else {
        console.log('Bootstrap is complete.');
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
