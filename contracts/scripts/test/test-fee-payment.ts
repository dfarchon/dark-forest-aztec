/**
 * Offline checks for FEE_PAYMENT_MODE parsing, fee send fields, and funding-stop helpers.
 * Run: pnpm test:fee-payment
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';

import {
    AccountFundingRequiredError,
    buildFeeSendFields,
    buildSendOpts,
    DEFAULT_ACCOUNT_MIN_BALANCE_FJ,
    formatFeeJuiceWei,
    getAccountMinBalanceFjWei,
    getFeePaymentMode,
    parseFjDecimalToWei,
    stopForAccountFunding,
} from '../utils/index.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
    if (cond) {
        passed++;
        console.log(`  ✅ ${msg}`);
    } else {
        failed++;
        console.error(`  ❌ ${msg}`);
    }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

console.log('\n=== fee payment mode parsing ===');
withEnv({ FEE_PAYMENT_MODE: undefined }, () => {
    assert(getFeePaymentMode() === 'sponsored', 'default is sponsored');
});
withEnv({ FEE_PAYMENT_MODE: 'sponsored' }, () => {
    assert(getFeePaymentMode() === 'sponsored', 'sponsored accepted');
});
withEnv({ FEE_PAYMENT_MODE: 'ACCOUNT' }, () => {
    assert(getFeePaymentMode() === 'account', 'ACCOUNT lowercased to account');
});
withEnv({ FEE_PAYMENT_MODE: 'bogus' }, () => {
    let threw = false;
    try {
        getFeePaymentMode();
    } catch {
        threw = true;
    }
    assert(threw, 'invalid mode throws');
});

console.log('\n=== fee send fields ===');
{
    const fpc = AztecAddress.fromStringUnsafe(
        '0x00000000000000000000000000000000000000000000000000000000000000a1'
    );
    const sponsored = buildFeeSendFields({
        mode: 'sponsored',
        sponsoredFpc: { address: fpc },
    });
    assert(
        'fee' in sponsored &&
            sponsored.fee.paymentMethod instanceof SponsoredFeePaymentMethod,
        'sponsored includes SponsoredFeePaymentMethod'
    );

    const account = buildFeeSendFields({ mode: 'account' });
    assert(
        !('fee' in account) || (account as { fee?: unknown }).fee === undefined,
        'account mode omits fee'
    );
    assert(Object.keys(account).length === 0, 'account mode fields empty');

    const send = buildSendOpts(fpc, { mode: 'account' });
    assert(send.from.equals(fpc), 'buildSendOpts sets from');
    assert(send.fee === undefined, 'buildSendOpts account has no fee');
}

console.log('\n=== FeeJuice units ===');
{
    assert(parseFjDecimalToWei('5') === 5n * 10n ** 18n, 'parse 5 FJ to wei');
    assert(formatFeeJuiceWei(5n * 10n ** 18n) === '5 FJ', 'format 5 FJ');
    withEnv({ ACCOUNT_MIN_BALANCE_FJ: undefined }, () => {
        assert(
            getAccountMinBalanceFjWei() ===
                parseFjDecimalToWei(DEFAULT_ACCOUNT_MIN_BALANCE_FJ)!,
            'default min balance'
        );
    });
    withEnv({ ACCOUNT_MIN_BALANCE_FJ: '1.5' }, () => {
        assert(
            getAccountMinBalanceFjWei() === parseFjDecimalToWei('1.5')!,
            'override min balance'
        );
    });
}

console.log('\n=== funding stop messaging ===');
{
    const addr = AztecAddress.fromStringUnsafe(
        '0x00000000000000000000000000000000000000000000000000000000000000b2'
    );
    let err: unknown;
    try {
        stopForAccountFunding({
            reason: 'keys_created',
            accountAddress: addr,
            commandHint: 'pnpm deploy-contracts',
        });
    } catch (e) {
        err = e;
    }
    assert(
        err instanceof AccountFundingRequiredError,
        'keys_created throws AccountFundingRequiredError'
    );
    if (err instanceof AccountFundingRequiredError) {
        assert(err.exitCode === 2, 'exit code 2');
        assert(
            err.message.includes(addr.toString()),
            'message includes fund address'
        );
        assert(
            err.message.includes('pnpm deploy-contracts'),
            'message includes re-run command'
        );
        assert(
            !err.message.includes('ACCOUNT_SECRET_KEY'),
            'message does not leak ACCOUNT_SECRET_KEY'
        );
        assert(
            !err.message.includes('ACCOUNT_SIGNING_KEY'),
            'message does not leak ACCOUNT_SIGNING_KEY'
        );
        assert(
            err.message.includes('NO transactions were sent') ||
                err.message.includes('NO transactions'),
            'message says no txs were sent'
        );
    }

    err = undefined;
    try {
        stopForAccountFunding({
            reason: 'insufficient_balance',
            accountAddress: addr,
            commandHint: 'pnpm configure',
            balanceWei: 0n,
            minWei: parseFjDecimalToWei('5')!,
        });
    } catch (e) {
        err = e;
    }
    assert(
        err instanceof AccountFundingRequiredError,
        'insufficient_balance throws'
    );
    if (err instanceof AccountFundingRequiredError) {
        assert(err.message.includes('INSUFFICIENT'), 'mentions insufficient');
        assert(err.message.includes('pnpm configure'), 'mentions configure');
        assert(err.message.includes('Shortfall'), 'mentions shortfall');
    }
}

console.log(`\n=== results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
