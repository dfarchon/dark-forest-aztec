/**
 * Bridges real $AZTEC from L1 into Aztec fee juice.
 *
 *   pnpm --filter contracts run bridge-fee-juice -- --to 0x… --amount 50 --yes
 *
 * Thin CLI over @alejoamiras/quota-paymaster/operator `bridgeFeeJuice`, which
 * owns the part that matters: the claim secret is generated locally and
 * fsync'd to a hardened journal BEFORE anything touches L1 — a crash after
 * the deposit can no longer destroy the deposit. The secret never touches
 * argv or stdout; claim-fee-juice reads it back from the journal.
 *
 * Bridging is one-way. Fund only what you accept losing.
 */
import {
    bridgeFeeJuice,
    closeJournalDir,
    openJournalDir,
} from '@alejoamiras/quota-paymaster/operator';

import {
    getOptionalEnv,
    getRequiredEnv,
    loadContractsEnv,
} from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { argvOf, confirmFromFlags, flag, opt } from './confirm.js';

const FJ = 10n ** 18n;

async function main() {
    const argv = argvOf();
    const to = opt(argv, '--to');
    const amount = opt(argv, '--amount');
    if (!to || !amount || !/^\d+$/.test(amount)) {
        throw new Error(
            'Usage: bridge-fee-juice --to <l2-address> --amount <whole AZTEC> [--yes] [--dry-run] [--journal-dir <path>]'
        );
    }
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const l1Rpc = getOptionalEnv('ETHEREUM_HOST') ?? 'http://localhost:8545';
    const l1Key = getRequiredEnv('L1_PRIVATE_KEY');

    const node = createTolerantAztecNodeClient(nodeUrl);
    const info = await node.getNodeInfo();
    const { createEthereumChain } = await import('@aztec/ethereum/chain');
    const { createExtendedL1Client } = await import('@aztec/ethereum/client');
    const chain = createEthereumChain([l1Rpc], info.l1ChainId);
    const l1Client = createExtendedL1Client(
        chain.rpcUrls,
        l1Key,
        chain.chainInfo
    );

    const journal = openJournalDir(opt(argv, '--journal-dir'));
    try {
        const result = await bridgeFeeJuice(
            {
                node: node as never,
                l1Client: l1Client as never,
                journal,
                confirm: confirmFromFlags({
                    yes: flag(argv, '--yes'),
                    dryRun: flag(argv, '--dry-run'),
                }),
                onProgress: (msg) => console.log(`  ${msg}`),
            },
            { to, amountWei: BigInt(amount) * FJ }
        );
        console.log(`\nBridged ${formatFeeJuiceWei(result.amountWei)}.`);
        console.log(`  L1 tx        ${result.l1TxHash}`);
        console.log(`  message hash ${result.messageHash}`);
        console.log(`  leaf index   ${result.messageLeafIndex}`);
        console.log(
            `\nThe claim secret is journaled (not printed). Once the L1->L2 message is\n` +
                `included (a couple of L2 blocks), redeem with:\n` +
                `  pnpm --filter contracts run claim-fee-juice -- --for ${to} --yes`
        );
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
