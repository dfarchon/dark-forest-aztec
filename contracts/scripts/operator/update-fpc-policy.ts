/**
 * Shows and retunes a deployed paymaster's policy.
 *
 *   pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --show
 *   pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --max-uses 20 --yes
 *   pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --cancel --yes
 *
 * Thin CLI over @alejoamiras/quota-paymaster/operator. The judgment lives in
 * the package: CAS-protected scheduling with confirm-by-digest, chain-time
 * pending detection, the client fee floor, the max-loss bound (enforced on
 * updates too), and the balance-vs-sequencer-reserve report. Changes take
 * effect 12h after landing; one pending slot, scheduling REPLACES it.
 */
import fs from 'node:fs';

import {
    DARK_FOREST_REFERENCE_GAS_PROFILE,
    parseQuotaFpcConfig,
} from '@alejoamiras/quota-paymaster';
import {
    cancelPendingPolicyChange,
    formatFeeJuiceWei,
    readPolicyState,
    schedulePolicyChange,
} from '@alejoamiras/quota-paymaster/operator';
import { AztecAddress } from '@aztec/aztec.js/addresses';

import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';
import { argvOf, confirmFromFlags, flag, opt } from './confirm.js';

/** Our measured gas envelope; the floor/reserve math derives from it. */
const GAS_PROFILE = DARK_FOREST_REFERENCE_GAS_PROFILE;

function usage(): never {
    throw new Error(
        'Usage: update-fpc-policy --fpc <address> [--show]\n' +
            '         [--max-uses <n>] [--max-users <n>] [--max-fee-wei <wei>]\n' +
            '         [--add-target <addr>]... [--remove-target <addr>]...\n' +
            '         [--cancel] [--accept-below-floor] [--accept-above-max-loss]\n' +
            '         [--config <path>] [--yes] [--dry-run]'
    );
}

async function main() {
    const argv = argvOf();
    const fpc = opt(argv, '--fpc');
    if (!fpc || !/^0x[0-9a-fA-F]{64}$/.test(fpc)) usage();
    loadContractsEnv({ optional: true } as never);

    // maxLossWei comes from the same config the deploy used, so the bound the
    // operator accepted at deploy time keeps binding updates.
    const configPath = opt(argv, '--config') ?? 'fpc/config/dark-forest.json';
    const config = parseQuotaFpcConfig(
        JSON.parse(fs.readFileSync(configPath, 'utf8')),
        process.env
    );

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const from = await getOrCreateAccount(wallet, node);
    const deps = {
        node: node as never,
        wallet: wallet as never,
        from,
        fpcAddress: AztecAddress.fromStringUnsafe(fpc),
    };

    // readPolicyState registers the instance + package artifact itself.
    const state = await readPolicyState(deps, GAS_PROFILE);

    const show = (label: string, v: typeof state.live) => {
        console.log(`\n${label}`);
        console.log(
            `  per-transaction ceiling   ${formatFeeJuiceWei(v.maxFeeWei)}`
        );
        console.log(`  transactions per user/day ${v.maxUses}`);
        console.log(`  users per day             ${v.maxUsers}`);
        for (const t of v.allowedTargets) console.log(`    ${t}`);
    };
    console.log(
        `Admin     ${state.admin}${state.admin === from.toString() ? '  (that is you)' : ''}`
    );
    show('In force now', state.live);
    if (state.scheduled.pending) {
        console.log(
            `\nPENDING — activates at chain time ${state.scheduled.activatesAt} (revision ${state.scheduled.revision})`
        );
        show('Pending values', {
            ...state.scheduled.values,
            allowedTargets: state.scheduled.allowedTargets,
        });
    } else {
        console.log('\nNothing pending.');
    }
    console.log(`\nPaymaster balance ${formatFeeJuiceWei(state.balanceWei)}`);
    if (state.balanceWei < state.sequencerReserveWei) {
        console.log(
            `  BELOW the sequencer reserve (${formatFeeJuiceWei(state.sequencerReserveWei)}) — sponsors NOTHING until topped up.`
        );
    } else {
        console.log(
            `  clears the ${formatFeeJuiceWei(state.sequencerReserveWei)} reserve.`
        );
    }

    const confirm = confirmFromFlags({
        yes: flag(argv, '--yes'),
        dryRun: flag(argv, '--dry-run'),
    });
    const guards = {
        maxLossWei: BigInt(config.maxLossWei),
        gasProfile: GAS_PROFILE,
        acceptCeilingBelowClientFloor: flag(argv, '--accept-below-floor'),
        acceptWorstCaseAboveMaxLoss: flag(argv, '--accept-above-max-loss'),
    };

    if (flag(argv, '--cancel')) {
        const r = await cancelPendingPolicyChange({ ...deps, confirm }, guards);
        console.log(
            `\nCancel scheduled (revision ${r.scheduledRevision}). The live values take a fresh 12h trip.`
        );
        if (r.pendingActivatedFirst !== false) {
            console.log(
                `  NOTE pendingActivatedFirst=${r.pendingActivatedFirst}: the pending bundle may have gone LIVE first — re-read state.`
            );
        }
        return;
    }

    const maxUses = opt(argv, '--max-uses');
    const maxUsers = opt(argv, '--max-users');
    const maxFeeWei = opt(argv, '--max-fee-wei');
    const addTargets = argv.flatMap((a, i) =>
        a === '--add-target' ? [argv[i + 1]] : []
    );
    const removeTargets = new Set(
        argv
            .flatMap((a, i) => (a === '--remove-target' ? [argv[i + 1]] : []))
            .map((t) => t.toLowerCase())
    );
    const hasEdits =
        maxUses !== undefined ||
        maxUsers !== undefined ||
        maxFeeWei !== undefined ||
        addTargets.length > 0 ||
        removeTargets.size > 0;

    if (flag(argv, '--show') || !hasEdits) return;

    const targets =
        addTargets.length > 0 || removeTargets.size > 0
            ? [
                  ...state.live.allowedTargets.filter(
                      (t) => !removeTargets.has(t.toLowerCase())
                  ),
                  ...addTargets,
              ]
            : undefined;

    const r = await schedulePolicyChange(
        { ...deps, confirm },
        {
            maxUses: maxUses === undefined ? undefined : Number(maxUses),
            maxUsers: maxUsers === undefined ? undefined : Number(maxUsers),
            maxFeeWei: maxFeeWei === undefined ? undefined : BigInt(maxFeeWei),
            allowedTargets: targets,
        },
        guards
    );
    console.log(
        `\nScheduled (revision ${r.scheduledRevision}). Takes effect ~12h after landing; re-run with --show to confirm.`
    );
    if (r.pendingActivatedFirst !== false) {
        console.log(
            `  NOTE pendingActivatedFirst=${r.pendingActivatedFirst}: a previously-pending bundle may have activated first — re-read state.`
        );
    }
}

main().catch((err) => {
    if ((err as { name?: string })?.name === 'ActionAborted') {
        process.exit(2);
    }
    console.error(err);
    process.exit(1);
});
