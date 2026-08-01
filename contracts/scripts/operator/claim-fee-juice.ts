/**
 * Redeems a bridged fee-juice claim on behalf of a recipient.
 *
 *   pnpm --filter contracts run claim-fee-juice -- --for 0x… \
 *     --amount <wei> --secret 0x… --leaf-index <n>
 *
 * Why this exists separately from bridging: the paymaster is a CONTRACT, and a
 * contract cannot send the transaction that would claim its own juice. Anyone
 * may claim on a recipient's behalf — the claim secret is the authorisation —
 * so the operator's account does it, paying the gas itself.
 *
 * (An ACCOUNT with a claim has the opposite problem: it has no balance to pay
 * for the claim, and instead bundles it into its first transaction with
 * FeeJuicePaymentMethodWithClaim. See prepareFeePayment.)
 *
 * Bridging is one-way. Nothing here can be undone.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';

import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { buildFeeSendFields, prepareFeePayment } from '../utils/feePayment.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';

function parseArgs(argv: string[]) {
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i === -1 ? undefined : argv[i + 1];
    };
    const target = get('--for');
    const amount = get('--amount');
    const secret = get('--secret');
    const leafIndex = get('--leaf-index');
    if (!target || !amount || !secret || !leafIndex) {
        throw new Error(
            'Usage: claim-fee-juice --for <l2-address> --amount <wei> --secret 0x… --leaf-index <n>'
        );
    }
    return {
        target,
        amount: BigInt(amount),
        secret,
        leafIndex: BigInt(leafIndex),
    };
}

async function main() {
    const { target, amount, secret, leafIndex } = parseArgs(
        process.argv.slice(2)
    );
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const payer = await getOrCreateAccount(wallet, node);

    const { FeeJuiceContract } = await import('@aztec/aztec.js/protocol');
    const { Fr } = await import('@aztec/aztec.js/fields');
    const { getFeeJuiceBalance } = await import('@aztec/aztec.js/utils');

    const recipient = AztecAddress.fromStringUnsafe(target);
    const before = await getFeeJuiceBalance(recipient, node);

    console.log(`\nClaiming bridged fee juice`);
    console.log(`  recipient   ${target}`);
    console.log(`  amount      ${formatFeeJuiceWei(amount)}`);
    console.log(`  paid for by ${payer.toString()}`);
    console.log(`  balance now ${formatFeeJuiceWei(before)}`);

    const feeCtx = await prepareFeePayment(wallet, payer);
    await FeeJuiceContract.at(wallet as never)
        .methods.claim(recipient, amount, Fr.fromString(secret), leafIndex)
        .send({ from: payer, ...buildFeeSendFields(feeCtx) });

    const after = await getFeeJuiceBalance(recipient, node);
    console.log(
        `\nClaimed. Balance ${formatFeeJuiceWei(before)} -> ${formatFeeJuiceWei(after)}\n`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
