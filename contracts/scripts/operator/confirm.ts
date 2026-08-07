/**
 * CLI confirmation gate for the package's ActionPlan protocol.
 *
 * Every state-changing operator flow in @alejoamiras/quota-paymaster asks a
 * ConfirmAction before broadcasting: it hands over an immutable, sha256-digested
 * plan of exactly what will happen. This adapter prints that plan and consents
 * only when the operator passed `--yes` — so the digest the human saw is the
 * digest that executes, and a script run without `--yes` is always a dry run.
 */
import type {
    ActionPlan,
    ConfirmAction,
} from '@alejoamiras/quota-paymaster/operator';

export function confirmFromFlags(flags: {
    yes: boolean;
    dryRun?: boolean;
}): ConfirmAction {
    return (plan: ActionPlan) => {
        console.log(`\nACTION  ${plan.kind}`);
        for (const [k, v] of Object.entries(plan.details)) {
            console.log(`  ${k.padEnd(26)} ${v}`);
        }
        console.log(`  digest ${plan.digest}`);
        if (flags.dryRun) {
            console.log('\nDry run: nothing was sent.');
            return false;
        }
        if (!flags.yes) {
            console.error(
                '\nRefusing: this changes on-chain state. Re-run with --yes once the plan above is correct.'
            );
            return false;
        }
        return true;
    };
}

/** Standard argv helpers shared by the thin operator CLIs. */
export function argvOf(): string[] {
    return process.argv.slice(2);
}

export function flag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

export function opt(argv: string[], name: string): string | undefined {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
}
