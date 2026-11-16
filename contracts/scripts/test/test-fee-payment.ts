/**
 * Offline checks for FEE_PAYMENT_MODE parsing, fee send fields, and funding-stop helpers.
 * Run (from contracts/): pnpm test:fee-payment
 *
 * gasMainRound2 semantics: FEE_PAYMENT_MODE is read from `networks/<AZTEC_NETWORK>.env`
 * (runtime/env.ts), not from process.env, and a missing value THROWS (no default).
 * This test never touches a real network file: it writes a throwaway
 * `networks/__fee-payment-test.env` (gitignored via networks/*.env), points AZTEC_NETWORK at it,
 * mutates the in-memory values per case, and deletes the file on exit.
 */
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec-labs/aztec.js/fee';
import fs from 'fs';
import path from 'path';

import { CONTRACTS_PACKAGE_ROOT, loadNetworkEnv } from '../runtime/env.ts';
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

const TEST_NETWORK = '__fee-payment-test';
const testNetworkFile = path.join(
    CONTRACTS_PACKAGE_ROOT,
    'networks',
    `${TEST_NETWORK}.env`
);

function cleanup() {
    try {
        fs.rmSync(testNetworkFile, { force: true });
    } catch {
        /* ignore */
    }
}

if (fs.existsSync(testNetworkFile)) {
    console.error(
        `Refusing to overwrite existing ${path.relative(process.cwd(), testNetworkFile)}. Remove it and retry.`
    );
    process.exit(1);
}
fs.writeFileSync(
    testNetworkFile,
    [
        '# Temporary file written by scripts/test/test-fee-payment.ts. Safe to delete.',
        'AZTEC_NODE_URL=http://localhost:8080',
        'FEE_PAYMENT_MODE=sponsored',
        '',
    ].join('\n'),
    'utf-8'
);
process.on('exit', cleanup);
process.env.AZTEC_NETWORK = TEST_NETWORK;

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

/** Temporarily override values from the (cached) active network file. */
function withNetwork<T>(
    vars: Record<string, string | undefined>,
    fn: () => T
): T {
    const values = loadNetworkEnv().values;
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = values[k];
        if (v === undefined) delete values[k];
        else values[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete values[k];
            else values[k] = v;
        }
    }
}

function throwsWith(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return undefined;
}

console.log('\n=== fee payment mode parsing ===');
withNetwork({ FEE_PAYMENT_MODE: undefined }, () => {
    const msg = throwsWith(() => getFeePaymentMode());
    assert(msg !== undefined, 'missing FEE_PAYMENT_MODE throws (no default)');
    assert(
        msg?.includes('Missing FEE_PAYMENT_MODE') ?? false,
        'missing mode error names FEE_PAYMENT_MODE'
    );
});
withNetwork({ FEE_PAYMENT_MODE: '' }, () => {
    assert(
        throwsWith(() => getFeePaymentMode()) !== undefined,
        'empty FEE_PAYMENT_MODE throws'
    );
});
withNetwork({ FEE_PAYMENT_MODE: 'sponsored' }, () => {
    assert(getFeePaymentMode() === 'sponsored', 'sponsored accepted');
});
withNetwork({ FEE_PAYMENT_MODE: 'ACCOUNT' }, () => {
    assert(getFeePaymentMode() === 'account', 'ACCOUNT lowercased to account');
});
withNetwork({ FEE_PAYMENT_MODE: 'bogus' }, () => {
    const msg = throwsWith(() => getFeePaymentMode());
    assert(msg !== undefined, 'invalid mode throws');
    assert(
        msg?.includes('Invalid FEE_PAYMENT_MODE') ?? false,
        'invalid mode error text'
    );
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

    assert(
        throwsWith(() => buildFeeSendFields({ mode: 'sponsored' })) !==
            undefined,
        'sponsored without a registered SponsoredFPC throws'
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
    withNetwork({ ACCOUNT_MIN_BALANCE_FJ: undefined }, () => {
        assert(
            getAccountMinBalanceFjWei() ===
                parseFjDecimalToWei(DEFAULT_ACCOUNT_MIN_BALANCE_FJ)!,
            'default min balance'
        );
    });
    withNetwork({ ACCOUNT_MIN_BALANCE_FJ: '1.5' }, () => {
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
            commandHint: 'pnpm deploy:run',
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
            err.message.includes('pnpm deploy:run'),
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
            commandHint: 'pnpm bootstrap',
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
        assert(err.message.includes('pnpm bootstrap'), 'mentions bootstrap');
        assert(err.message.includes('Shortfall'), 'mentions shortfall');
    }
}

console.log(`\n=== results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
