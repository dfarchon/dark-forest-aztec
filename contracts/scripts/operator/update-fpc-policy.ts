/**
 * Shows and changes a deployed paymaster's policy — the tool an operator uses
 * to retune sponsorship without redeploying.
 *
 *   pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --show
 *   pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --max-uses 20
 *
 * Written to be safe for someone who has never read this codebase, because the
 * mistakes available here are expensive and quiet:
 *
 *   - Only ONE change can be pending at a time. Scheduling a second REPLACES
 *     the first and restarts its clock. So this refuses to write over a pending
 *     change unless told to, and when told to it edits the PENDING settings
 *     rather than the live ones, so nothing already decided is silently lost.
 *     (The real guard is on-chain: the contract takes an expected revision and
 *     rejects a stale one. A check here alone would lose a race between two
 *     operators.)
 *   - A ceiling below what the client actually spends makes EVERY sponsored
 *     transaction unprovable, and players get charged their own gas instead.
 *     This refuses such a value unless explicitly forced.
 *
 * Nothing takes effect for 12 hours, and there is no pause. This tool cannot
 * stop an incident; it can only schedule a change that lands half a day later.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';

import {
    MAX_ALLOWED_TARGETS,
    padAllowedTargets,
    worstCasePerDayWei,
} from '../../fpc/config/schema.js';
import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { buildFeeSendFields, prepareFeePayment } from '../utils/feePayment.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';

/** Must match UPDATE_DELAY_SECONDS in the contract. */
const UPDATE_DELAY_SECONDS = 43_200;

// The client's gas profile, imported rather than copied. Two copies of these
// numbers is exactly how this script's floor check silently stops matching
// what the client actually spends.
import { sponsoredFeeFloorWei } from '@dfpunk/quota-fpc';

interface Flags {
    fpc: string;
    show: boolean;
    dryRun: boolean;
    replacePending: boolean;
    forceBelowFloor: boolean;
    cancel: boolean;
    maxUses?: number;
    maxUsers?: number;
    maxFeeWei?: bigint;
    addTargets: string[];
    removeTargets: string[];
}

function parseArgs(argv: string[]): Flags {
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i === -1 ? undefined : argv[i + 1];
    };
    const all = (flag: string) =>
        argv.reduce<string[]>(
            (acc, a, i) =>
                a === flag && argv[i + 1] ? [...acc, argv[i + 1]] : acc,
            []
        );

    const fpc = get('--fpc');
    if (!fpc) {
        throw new Error(
            'Usage: update-fpc-policy --fpc <address> [--show]\n' +
                '         [--max-uses <n>] [--max-users <n>] [--max-fee-wei <n>]\n' +
                '         [--add-target <address>] [--remove-target <address>]\n' +
                '         [--cancel] [--replace-pending] [--force-below-client-floor] [--dry-run]'
        );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(fpc)) {
        throw new Error(`--fpc is not a 32-byte address: ${fpc}`);
    }

    const num = (flag: string) => {
        const raw = get(flag);
        if (raw === undefined) return undefined;
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
            throw new Error(`${flag} must be a positive integer, got ${raw}`);
        }
        return n;
    };

    const maxFeeRaw = get('--max-fee-wei');
    let maxFeeWei: bigint | undefined;
    if (maxFeeRaw !== undefined) {
        try {
            maxFeeWei = BigInt(maxFeeRaw);
        } catch {
            throw new Error(
                `--max-fee-wei must be an integer, got ${maxFeeRaw}`
            );
        }
        if (maxFeeWei <= 0n) {
            throw new Error('--max-fee-wei must be greater than zero');
        }
    }

    for (const addr of [...all('--add-target'), ...all('--remove-target')]) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(addr)) {
            throw new Error(`target is not a 32-byte address: ${addr}`);
        }
    }

    return {
        fpc,
        show: argv.includes('--show'),
        dryRun: argv.includes('--dry-run'),
        replacePending: argv.includes('--replace-pending'),
        forceBelowFloor: argv.includes('--force-below-client-floor'),
        cancel: argv.includes('--cancel'),
        maxUses: num('--max-uses'),
        maxUsers: num('--max-users'),
        maxFeeWei,
        addTargets: all('--add-target'),
        removeTargets: all('--remove-target'),
    };
}

interface Bundle {
    maxFeeWei: bigint;
    maxUses: number;
    maxUsers: number;
    targets: string[];
}

function printBundle(label: string, b: Bundle): void {
    console.log(`\n${label}`);
    console.log(
        `  per-transaction ceiling   ${formatFeeJuiceWei(b.maxFeeWei)}  (${b.maxFeeWei} wei)`
    );
    console.log(`  transactions per user/day ${b.maxUses}`);
    console.log(`  users per day             ${b.maxUsers}`);
    console.log(`  sponsored contracts       ${b.targets.length}`);
    for (const t of b.targets) console.log(`    ${t}`);
    console.log(
        `  worst case per day        ${formatFeeJuiceWei(
            worstCasePerDayWei({
                maxFeeWei: b.maxFeeWei,
                maxUsesPerDay: b.maxUses,
                maxUsersPerDay: b.maxUsers,
            })
        )}`
    );
}

/**
 * Field-by-field difference between two bundles, in plain language.
 *
 * Printed before every write because `--replace-pending` bases edits on the
 * PENDING bundle: changing one dial silently carries the others forward, and
 * an operator who has forgotten what was queued would not otherwise see them.
 */
function describeDiff(from: Bundle, to: Bundle): string[] {
    const lines: string[] = [];
    if (from.maxFeeWei !== to.maxFeeWei) {
        lines.push(
            `  per-transaction ceiling  ${formatFeeJuiceWei(from.maxFeeWei)} -> ${formatFeeJuiceWei(to.maxFeeWei)}`
        );
    }
    if (from.maxUses !== to.maxUses) {
        lines.push(
            `  transactions per user    ${from.maxUses} -> ${to.maxUses}${to.maxUses < from.maxUses ? '   (REDUCTION)' : ''}`
        );
    }
    if (from.maxUsers !== to.maxUsers) {
        lines.push(
            `  users per day            ${from.maxUsers} -> ${to.maxUsers}${to.maxUsers < from.maxUsers ? '   (REDUCTION)' : ''}`
        );
    }
    const a = new Set(from.targets.map((t) => t.toLowerCase()));
    const b = new Set(to.targets.map((t) => t.toLowerCase()));
    for (const t of b)
        if (!a.has(t)) lines.push(`  + sponsored contract     ${t}`);
    for (const t of a)
        if (!b.has(t)) lines.push(`  - sponsored contract     ${t}`);
    return lines;
}

/** True when two bundles are identical in every field. */
function sameBundle(a: Bundle, b: Bundle): boolean {
    return describeDiff(a, b).length === 0;
}

/** Applies only the flags the operator actually passed. */
function applyEdits(base: Bundle, flags: Flags): Bundle {
    const targets = new Set(base.targets.map((t) => t.toLowerCase()));
    for (const t of flags.addTargets) targets.add(t.toLowerCase());
    for (const t of flags.removeTargets) targets.delete(t.toLowerCase());

    const next: Bundle = {
        maxFeeWei: flags.maxFeeWei ?? base.maxFeeWei,
        maxUses: flags.maxUses ?? base.maxUses,
        maxUsers: flags.maxUsers ?? base.maxUsers,
        targets: [...targets],
    };
    if (next.targets.length === 0) {
        throw new Error(
            'That would leave no sponsored contracts, which the contract rejects ' +
                '(and would stop sponsorship entirely).'
        );
    }
    if (next.targets.length > MAX_ALLOWED_TARGETS) {
        throw new Error(
            `That would leave ${next.targets.length} sponsored contracts; the contract holds ${MAX_ALLOWED_TARGETS}.`
        );
    }
    return next;
}

function hasEdits(flags: Flags): boolean {
    return (
        flags.cancel ||
        flags.maxUses !== undefined ||
        flags.maxUsers !== undefined ||
        flags.maxFeeWei !== undefined ||
        flags.addTargets.length > 0 ||
        flags.removeTargets.length > 0
    );
}

async function main() {
    const flags = parseArgs(process.argv.slice(2));
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const signer = await getOrCreateAccount(wallet, node);

    const { QuotaFpcContract } = await import('../artifacts/QuotaFpc.js');
    const fpc = await QuotaFpcContract.at(
        AztecAddress.fromStringUnsafe(flags.fpc),
        wallet as never
    );

    // Simulation results are sometimes wrapped in { result }, sometimes not.
    // The payloads are contract-shaped and only read field-by-field below, so
    // `unknown` here (rather than `any`) keeps each access explicit.
    const unwrap = (
        raw: unknown
    ): Record<string, unknown> & ArrayLike<unknown> =>
        ((raw as { result?: unknown })?.result ?? raw) as Record<
            string,
            unknown
        > &
            ArrayLike<unknown>;
    /** Drops the zero-address padding the contract stores in fixed-size arrays. */
    const realTargets = (raw: unknown): string[] =>
        (raw as { toString(): string }[])
            .map((t) => t.toString())
            .filter((t) => !/^0x0+$/.test(t));
    const admin = unwrap(
        await fpc.methods.get_admin().simulate({ from: signer })
    ).toString();

    // Show what you are acting on BEFORE doing anything, so a wrong network or
    // a signer that is not the admin is obvious rather than discovered midway.
    console.log(`\nNetwork   ${nodeUrl}`);
    console.log(`Paymaster ${flags.fpc}`);
    console.log(`Signer    ${signer.toString()}`);
    console.log(
        `Admin     ${admin}${
            admin.toLowerCase() === signer.toString().toLowerCase()
                ? '  (that is you)'
                : '  ← NOT your signer; a write will be rejected on-chain'
        }`
    );

    // ORDER MATTERS. Read the clock FIRST, then the schedule, then the live
    // policy. Reading them in any order takes three separate snapshots, and an
    // activation landing between two of them makes the pair disagree: the
    // schedule looks already-applied while the "live" read still shows the old
    // values. Editing from that stale bundle would quietly schedule the
    // pre-activation policy straight back in.
    //
    // CHAIN time, never wall clock: the contract stamps activation from block
    // timestamps, and a chain can sit hours off a laptop's clock.
    const latestBlock = await node.getBlockData('latest');
    const nowSeconds = Number(
        latestBlock?.header?.globalVariables?.timestamp ?? 0
    );
    if (!nowSeconds) {
        throw new Error(
            'Could not read the chain timestamp from the latest block'
        );
    }

    const scheduled = unwrap(
        await fpc.methods.get_scheduled_settings().simulate({ from: signer })
    ) as unknown as [Record<string, unknown>, bigint | number, bigint | number];
    const [schedBundle, timestampOfChange, revision] = scheduled;
    const activatesAt = Number(timestampOfChange);
    const isPending = activatesAt > nowSeconds;

    const live = unwrap(
        await fpc.methods.get_policy().simulate({ from: signer })
    );
    const liveTargets = realTargets(
        unwrap(
            await fpc.methods.get_allowed_targets().simulate({ from: signer })
        )
    );

    const scheduledBundle: Bundle = {
        maxFeeWei: BigInt(schedBundle.max_fee as never),
        maxUses: Number(schedBundle.max_uses),
        maxUsers: Number(schedBundle.max_users),
        targets: realTargets(schedBundle.allowed_targets),
    };

    // Once the activation timestamp has passed, the scheduled bundle IS the
    // live one — and it was read from a single consistent view, so prefer it
    // over the separately-read policy, which may predate the changeover.
    const current: Bundle = isPending
        ? {
              maxFeeWei: BigInt((live.max_fee ?? live[0]) as never),
              maxUses: Number(live.max_uses ?? live[1]),
              maxUsers: Number(live.max_users ?? live[2]),
              targets: liveTargets,
          }
        : scheduledBundle;
    printBundle('In force now', current);
    const skewMinutes = Math.round(
        (nowSeconds - Math.floor(Date.now() / 1000)) / 60
    );
    if (Math.abs(skewMinutes) > 5) {
        console.log(
            `\n  (chain clock is ${Math.abs(skewMinutes)} min ` +
                `${skewMinutes > 0 ? 'AHEAD of' : 'BEHIND'} your machine; ` +
                `every time shown here is chain time)`
        );
    }

    const pending = scheduledBundle;

    if (isPending) {
        printBundle(
            `PENDING — takes effect ${new Date(activatesAt * 1000).toISOString()}`,
            pending
        );
        console.log(
            `\n  Sponsorship gets unreliable in the last minutes before that moment:\n` +
                `  transactions are stamped to expire at the changeover, so proofs\n` +
                `  started just before it can miss it. Expect a brief wobble, not an outage.`
        );
    } else {
        console.log('\nNothing pending.');
    }

    // `getFeeJuiceBalance` is a helper over the node, NOT a node method. It was
    // previously called as `node.getFeeJuiceBalance?.(…)`, which is always
    // undefined — so `--show` silently never printed the balance, which is one
    // of the two numbers an operator actually came here for.
    const { getFeeJuiceBalance } = await import('@aztec/aztec.js/utils');
    const balance = await getFeeJuiceBalance(
        AztecAddress.fromStringUnsafe(flags.fpc),
        node as never
    );
    // Read once, above both consumers: the balance report and the ceiling
    // check below must judge against the SAME fee snapshot, or they can
    // disagree about what the network currently costs.
    const fees = await node.getCurrentMinFees();
    if (balance !== undefined) {
        console.log(
            `\nPaymaster balance ${formatFeeJuiceWei(BigInt(balance))}`
        );
        // The sequencer admits a transaction only if the fee payer can cover
        // the MAXIMUM the transaction could possibly cost — gas limits times
        // fee rates — not what it will actually cost. Sponsored transactions
        // settle for well under a fee juice each, but the balance is checked
        // against roughly 20 FJ, so a paymaster funded below that sponsors
        // NOTHING while looking perfectly healthy. The failure surfaces as
        // "Insufficient fee payer balance" at admission, long after funding,
        // which is the worst possible place to learn it.
        const reserve = sponsoredFeeFloorWei(
            BigInt(fees.feePerDaGas),
            BigInt(fees.feePerL2Gas)
        );
        if (BigInt(balance) < reserve) {
            console.log(
                `  NOT ENOUGH TO SPONSOR ANYTHING. At current fee rates a single\n` +
                    `  sponsored transaction requires ${formatFeeJuiceWei(reserve)} on hand, because the\n` +
                    `  network reserves the worst case rather than the real cost (which is\n` +
                    `  under 1 FJ). Bridge more before expecting this to work.`
            );
        } else {
            // Dividing the balance by the reserve is the WRONG arithmetic and
            // badly understates capacity: the reserve is a floor the balance
            // must stay above, not a per-transaction charge. What is actually
            // consumed is the settled fee, so the usable budget is everything
            // above the floor.
            const spendable = BigInt(balance) - reserve;
            const typicalFeeWei = 1_200_000_000_000_000_000n; // ~1.2 FJ, measured on mainnet
            console.log(
                `  clears the ${formatFeeJuiceWei(reserve)} reserve, leaving ${formatFeeJuiceWei(spendable)} spendable\n` +
                    `  — roughly ${spendable / typicalFeeWei} more sponsored transactions at ~1.2 FJ each.\n` +
                    `  Sponsorship stops once the balance falls back below the reserve, not at zero.`
            );
        }
    }

    if (flags.show || !hasEdits(flags)) {
        console.log(
            '\nNothing to change. Pass --max-uses / --max-users / --max-fee-wei /' +
                ' --add-target / --remove-target to schedule one, or --cancel to\n' +
                'drop a pending change.\n'
        );
        return;
    }

    // --cancel: the documented way to drop a pending change is to schedule the
    // CURRENT values, which supersedes it. There is no "unschedule".
    if (flags.cancel) {
        if (!isPending) {
            console.error(
                '\nRefusing: nothing is pending, so there is nothing to cancel.\n'
            );
            process.exit(2);
        }
        console.log(
            '\nCancelling the pending change by re-scheduling what is live now.'
        );
        console.log('Discarding:');
        for (const line of describeDiff(current, pending)) console.log(line);
        console.log(
            `\nNOTE: the live settings do not change, but they are re-scheduled, so\n` +
                `they only become "settled" again after the 12h delay elapses.`
        );
        if (flags.dryRun) {
            console.log('\nDry run: nothing was sent.\n');
            return;
        }
        const cancelFeeCtx = await prepareFeePayment(wallet);
        await fpc.methods
            .schedule_settings(
                {
                    max_fee: current.maxFeeWei,
                    max_uses: current.maxUses,
                    max_users: current.maxUsers,
                    allowed_targets: padAllowedTargets(current.targets).map(
                        (a) => AztecAddress.fromStringUnsafe(a)
                    ),
                } as never,
                BigInt(revision) as never
            )
            .send({ from: signer, ...buildFeeSendFields(cancelFeeCtx) });
        console.log('\nCancelled.\n');
        return;
    }

    // Base edits on the PENDING settings when there are any, so a second edit
    // adds to the first rather than quietly discarding it.
    if (isPending && !flags.replacePending) {
        console.error(
            `\nRefusing: a change is already scheduled for ${new Date(
                activatesAt * 1000
            ).toISOString()}.\n` +
                `Scheduling another REPLACES it — there is no queue — and restarts the 12h clock.\n` +
                `Re-run with --replace-pending to edit on top of the pending settings.\n`
        );
        process.exit(2);
    }
    const base = isPending ? pending : current;
    console.log(
        `\nBasing edits on the ${isPending ? 'PENDING' : 'in-force'} settings.`
    );

    const next = applyEdits(base, flags);

    const floor = sponsoredFeeFloorWei(
        BigInt(fees.feePerDaGas),
        BigInt(fees.feePerL2Gas)
    );
    if (next.maxFeeWei < floor && !flags.forceBelowFloor) {
        console.error(
            `\nRefusing: a ceiling of ${next.maxFeeWei} wei is below what the game client\n` +
                `actually spends at current network fees (${floor} wei).\n` +
                `Every sponsored transaction would fail to prove and players would be charged\n` +
                `their own gas instead. Use --force-below-client-floor only if you mean it.\n`
        );
        process.exit(3);
    }

    // A reschedule that changes nothing still restarts the 12h clock, pushing
    // a pending activation further away for no reason. Almost always a typo.
    if (sameBundle(base, next)) {
        console.error(
            `\nRefusing: that would schedule settings identical to the ${
                isPending ? 'pending' : 'live'
            } ones.\n` +
                `Nothing would change, but the 12h clock would restart. Use --cancel if\n` +
                `that is what you meant.\n`
        );
        process.exit(4);
    }

    console.log(
        `\nChanges (from the ${isPending ? 'PENDING' : 'live'} settings):`
    );
    for (const line of describeDiff(base, next)) console.log(line);
    printBundle('WOULD SCHEDULE', next);
    const effectiveAt = new Date((nowSeconds + UPDATE_DELAY_SECONDS) * 1000);
    console.log(
        `\n  Takes effect ${effectiveAt.toISOString()} (12h from now). Nothing changes before then.`
    );
    if (next.maxUses < base.maxUses || next.maxUsers < base.maxUsers) {
        console.log(
            `  This is a REDUCTION. At that moment it binds everyone, including players\n` +
                `  already playing today: their remaining count can drop, and players holding\n` +
                `  a slot above the new limit stop being sponsored.`
        );
    }

    if (flags.dryRun) {
        console.log('\nDry run: nothing was sent.\n');
        return;
    }

    const feeCtx = await prepareFeePayment(wallet);
    const padded = padAllowedTargets(next.targets).map((a) =>
        AztecAddress.fromStringUnsafe(a)
    );
    await fpc.methods
        .schedule_settings(
            {
                max_fee: next.maxFeeWei,
                max_uses: next.maxUses,
                max_users: next.maxUsers,
                allowed_targets: padded,
            } as never,
            BigInt(revision) as never
        )
        .send({ from: signer, ...buildFeeSendFields(feeCtx) });

    console.log(
        `\nScheduled. Takes effect ${effectiveAt.toISOString()}.\n` +
            `Re-run with --show to confirm.\n` +
            `NOTE: the config file is not updated by this — once you have changed the\n` +
            `policy on-chain, fpc/config/*.json describes only what was DEPLOYED, not\n` +
            `what is live. Read live state from here, not from the file.\n`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
