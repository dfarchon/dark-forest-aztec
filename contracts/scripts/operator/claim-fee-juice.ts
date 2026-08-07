/**
 * Redeems a bridged fee-juice claim on a recipient's behalf.
 *
 *   pnpm --filter contracts run claim-fee-juice -- --for 0x… --yes
 *
 * A contract cannot claim its own bridged juice, so the operator account
 * sends the claim and pays its gas. By default the claim details — secret
 * included — come from the bridge journal (latest unclaimed deposit for the
 * recipient), so the secret never has to travel through argv; explicit
 * --amount/--secret/--leaf-index override for claims made elsewhere.
 */
import {
    claimFeeJuice,
    closeJournalDir,
    findClaimInJournal,
    openJournalDir,
} from '@alejoamiras/quota-paymaster/operator';

import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { buildFeeSendFields, prepareFeePayment } from '../utils/feePayment.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';
import { argvOf, confirmFromFlags, flag, opt } from './confirm.js';

async function main() {
    const argv = argvOf();
    const recipient = opt(argv, '--for');
    if (!recipient) {
        throw new Error(
            'Usage: claim-fee-juice --for <l2-address> [--message-hash 0x…]\n' +
                '         [--amount <wei> --secret 0x… --leaf-index <n>] [--yes] [--journal-dir <path>]'
        );
    }
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const from = await getOrCreateAccount(wallet, node);
    const feeCtx = await prepareFeePayment(wallet, from);

    const journal = openJournalDir(opt(argv, '--journal-dir'));
    try {
        const amount = opt(argv, '--amount');
        const secret = opt(argv, '--secret');
        const leafIndex = opt(argv, '--leaf-index');
        const claim =
            amount && secret && leafIndex
                ? {
                      recipient,
                      amountWei: BigInt(amount),
                      claimSecret: secret,
                      messageLeafIndex: BigInt(leafIndex),
                  }
                : findClaimInJournal(journal, {
                      recipient,
                      messageHash: opt(argv, '--message-hash'),
                      // Only after verifying on-chain that no prior attempt
                      // landed — a retry against a redeemed deposit burns gas.
                      allowRetryAfterUnknownOutcome: flag(
                          argv,
                          '--allow-retry-after-unknown'
                      ),
                  });

        const { balanceAfterWei } = await claimFeeJuice(
            {
                node: node as never,
                wallet: wallet as never,
                from,
                confirm: confirmFromFlags({
                    yes: flag(argv, '--yes'),
                    dryRun: flag(argv, '--dry-run'),
                }),
                journal,
            },
            claim,
            { from, ...buildFeeSendFields(feeCtx) }
        );
        console.log(
            `\nClaimed ${formatFeeJuiceWei(claim.amountWei)} for ${recipient}.`
        );
        console.log(`  balance now ${formatFeeJuiceWei(balanceAfterWei)}`);
    } finally {
        closeJournalDir(journal);
    }
}

main().catch((err) => {
    if ((err as { name?: string })?.name === 'ActionAborted') {
        process.exit(2);
    }
    console.error(err);
    process.exit(1);
});
