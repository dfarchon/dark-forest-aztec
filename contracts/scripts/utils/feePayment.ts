/**
 * Shared fee payment helpers for contracts scripts.
 *
 * Modes (`FEE_PAYMENT_MODE`):
 * - `sponsored` (default): pay via canonical SponsoredFPC (`SponsoredFeePaymentMethod`).
 * - `account`: omit `fee.paymentMethod`; SDK charges FeeJuice from the sender account.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';
import path from 'path';

import {
    getAztecNetwork,
    getAztecNodeUrl,
    getContractsEnvFilePath,
    getOptionalEnv,
} from './env.ts';
import {
    DEFAULT_ACCOUNT_MIN_BALANCE_FJ,
    FEE_JUICE_BRIDGE_URL,
    formatFeeJuiceWei,
    parseFjDecimalToWei,
} from './feeJuiceUnits.ts';

export type FeePaymentMode = 'sponsored' | 'account';

/** Thrown when account-mode scripts must stop for user funding (exit code 2). */
export class AccountFundingRequiredError extends Error {
    readonly exitCode = 2;
    readonly accountAddress: string;

    constructor(message: string, accountAddress: string) {
        super(message);
        this.name = 'AccountFundingRequiredError';
        this.accountAddress = accountAddress;
    }
}

export type SponsoredFpcInstance = { address: AztecAddress };

export type FeePaymentContext = {
    mode: FeePaymentMode;
    /** Present only when `mode === 'sponsored'`. */
    sponsoredFpc?: SponsoredFpcInstance;
};

/**
 * Canonical SponsoredFPC contract instance (for sponsored fee payments).
 */
export async function getSponsoredPFCContract() {
    return getContractInstanceFromInstantiationParams(
        SponsoredFPCContractArtifact,
        {
            salt: new Fr(SPONSORED_FPC_SALT),
        }
    );
}

/**
 * Strict parser for `FEE_PAYMENT_MODE`. Default: `sponsored`.
 * Accepts only `sponsored` | `account` (case-insensitive).
 */
export function getFeePaymentMode(): FeePaymentMode {
    const raw = getOptionalEnv('FEE_PAYMENT_MODE')?.toLowerCase().trim();
    if (raw === undefined || raw === '' || raw === 'sponsored') {
        return 'sponsored';
    }
    if (raw === 'account') {
        return 'account';
    }
    throw new Error(
        `Invalid FEE_PAYMENT_MODE="${raw}". Expected "sponsored" or "account".`
    );
}

/**
 * Minimum FeeJuice (wei) required for account-mode scripts.
 * Env: `ACCOUNT_MIN_BALANCE_FJ` as a decimal FJ string (e.g. "5").
 */
export function getAccountMinBalanceFjWei(): bigint {
    const raw = getOptionalEnv('ACCOUNT_MIN_BALANCE_FJ');
    if (raw !== undefined) {
        const parsed = parseFjDecimalToWei(raw);
        if (parsed !== undefined && parsed > 0n) return parsed;
    }
    return parseFjDecimalToWei(DEFAULT_ACCOUNT_MIN_BALANCE_FJ)!;
}

/**
 * Register SponsoredFPC when in sponsored mode; no-op for account mode.
 * Always prints the active fee payment mode.
 */
export async function prepareFeePayment(
    wallet: EmbeddedWallet
): Promise<FeePaymentContext> {
    const mode = getFeePaymentMode();
    console.log(`💳 FEE_PAYMENT_MODE=${mode}`);

    if (mode === 'sponsored') {
        console.log('📝 Registering SponsoredFPC contract...');
        const sponsoredFpc = await getSponsoredPFCContract();
        await wallet.registerContract(
            sponsoredFpc,
            SponsoredFPCContractArtifact
        );
        return { mode, sponsoredFpc };
    }

    console.log(
        '📝 Account fee mode: SponsoredFPC will not be used; FeeJuice must be on the deployer account.'
    );
    return { mode };
}

/**
 * Build the optional `fee` field for `.send()` / account deploy.
 * Account mode returns `{}` so the SDK defaults to charging the sender.
 */
export function buildFeeSendFields(
    ctx: FeePaymentContext
):
    | { fee: { paymentMethod: SponsoredFeePaymentMethod } }
    | Record<string, never> {
    if (ctx.mode === 'sponsored') {
        if (!ctx.sponsoredFpc) {
            throw new Error(
                'Sponsored fee mode requires a registered SponsoredFPC instance'
            );
        }
        return {
            fee: {
                paymentMethod: new SponsoredFeePaymentMethod(
                    ctx.sponsoredFpc.address
                ),
            },
        };
    }
    return {};
}

/** Build `{ from, fee? }` for gameplay / configure txs. */
export function buildSendOpts(
    from: AztecAddress,
    ctx: FeePaymentContext
): {
    from: AztecAddress;
    fee?: { paymentMethod: SponsoredFeePaymentMethod };
} {
    return { from, ...buildFeeSendFields(ctx) };
}

function banner(title: string): string {
    const line = '='.repeat(72);
    return `\n${line}\n  ${title}\n${line}`;
}

function relativeEnvPath(): string {
    return path.relative(process.cwd(), getContractsEnvFilePath());
}

/**
 * Print a full account-mode funding guide and throw {@link AccountFundingRequiredError}.
 * Never prints ACCOUNT_SECRET_KEY / ACCOUNT_SIGNING_KEY.
 */
export function stopForAccountFunding(params: {
    reason: 'keys_created' | 'insufficient_balance' | 'balance_query_failed';
    accountAddress: AztecAddress;
    commandHint: string;
    balanceWei?: bigint;
    minWei?: bigint;
    queryError?: string;
}): never {
    const {
        reason,
        accountAddress,
        commandHint,
        balanceWei,
        minWei = getAccountMinBalanceFjWei(),
        queryError,
    } = params;

    const addr = accountAddress.toString();
    const network = getAztecNetwork() ?? '(unset)';
    const nodeUrl = getAztecNodeUrl();
    const envFile = relativeEnvPath();
    const lines: string[] = [];

    if (reason === 'keys_created') {
        lines.push(
            banner('ACCOUNT FEE MODE — NEW DEPLOYER ADDRESS CREATED'),
            '',
            '  FEE_PAYMENT_MODE=account requires FeeJuice on the deployer BEFORE any',
            '  on-chain transaction (contract deploy or configure).',
            '',
            '  A new Schnorr initializerless account was generated and saved.',
            '  NO transactions were sent (no account deploy tx is required).',
            '',
            `  Fund this exact address (derived from ACCOUNT_* keys):`,
            `    ${addr}`,
            '',
            `  Written to env file: ${envFile}`,
            `  Network label:       ${network}`,
            `  Aztec node:          ${nodeUrl}`,
            `  Minimum FeeJuice:    ${formatFeeJuiceWei(minWei)}`,
            '',
            '  Next steps:',
            `    1. Bridge / fund FeeJuice to the address above (≥ ${formatFeeJuiceWei(minWei)}).`,
            `       Bridge (Aztec mainnet): ${FEE_JUICE_BRIDGE_URL}`,
            `    2. Re-run the same command:`,
            `       ${commandHint}`,
            '',
            '  Do NOT generate a second account. Re-use the ACCOUNT_* keys already saved.',
            '  Private keys are in the env file — never commit or paste them.',
            ''
        );
    } else if (reason === 'balance_query_failed') {
        lines.push(
            banner('ACCOUNT FEE MODE — COULD NOT READ FEEJUICE BALANCE'),
            '',
            `  FEE_PAYMENT_MODE=account`,
            `  Account address:  ${addr}`,
            `  Network label:    ${network}`,
            `  Aztec node:       ${nodeUrl}`,
            `  Env file:         ${envFile}`,
            `  Error:            ${queryError ?? 'unknown'}`,
            '',
            '  Fix the node URL / connectivity, then re-run:',
            `    ${commandHint}`,
            ''
        );
    } else {
        const bal = balanceWei ?? 0n;
        const shortfall = minWei > bal ? minWei - bal : 0n;
        lines.push(
            banner('ACCOUNT FEE MODE — INSUFFICIENT FEEJUICE'),
            '',
            '  Refusing to send any transaction until the deployer has enough FeeJuice.',
            '',
            `  FEE_PAYMENT_MODE=account`,
            `  Fund this exact address:`,
            `    ${addr}`,
            '',
            `  Current balance:  ${formatFeeJuiceWei(bal)}`,
            `  Minimum required: ${formatFeeJuiceWei(minWei)}`,
            `  Shortfall:        ${formatFeeJuiceWei(shortfall)}`,
            `  Network label:    ${network}`,
            `  Aztec node:       ${nodeUrl}`,
            `  Env file:         ${envFile}`,
            '',
            '  Next steps:',
            `    1. Bridge / fund FeeJuice to the address above.`,
            `       Bridge (Aztec mainnet): ${FEE_JUICE_BRIDGE_URL}`,
            `    2. Re-run the same command:`,
            `       ${commandHint}`,
            '',
            '  Tip: override the minimum with ACCOUNT_MIN_BALANCE_FJ (decimal FJ, e.g. "5").',
            ''
        );
    }

    const message = lines.filter((l) => l !== undefined).join('\n');
    console.error(message);
    throw new AccountFundingRequiredError(message.trim(), addr);
}

/**
 * Account-mode preflight: print status, then stop if FeeJuice is insufficient.
 * Sponsored mode is a no-op.
 */
export async function assertAccountFeeJuiceReady(params: {
    feeCtx: FeePaymentContext;
    aztecNode: AztecNode;
    accountAddress: AztecAddress;
    commandHint: string;
}): Promise<void> {
    const { feeCtx, aztecNode, accountAddress, commandHint } = params;
    if (feeCtx.mode !== 'account') return;

    const minWei = getAccountMinBalanceFjWei();
    const network = getAztecNetwork() ?? '(unset)';
    const nodeUrl = getAztecNodeUrl();

    console.log(banner('ACCOUNT FEE MODE — PREFLIGHT'));
    console.log(`  FEE_PAYMENT_MODE=account`);
    console.log(`  Network label:    ${network}`);
    console.log(`  Aztec node:       ${nodeUrl}`);
    console.log(`  Account address:  ${accountAddress.toString()}`);
    console.log(`  Account type:     Schnorr initializerless (no deploy tx)`);
    console.log(`  Minimum FeeJuice: ${formatFeeJuiceWei(minWei)}`);

    const balanceWei = await getFeeJuiceBalance(
        accountAddress,
        aztecNode
    ).catch((err: unknown) => {
        const queryError = err instanceof Error ? err.message : String(err);
        console.log(`  Current balance:  (query failed)`);
        stopForAccountFunding({
            reason: 'balance_query_failed',
            accountAddress,
            commandHint,
            minWei,
            queryError,
        });
    });

    console.log(`  Current balance:  ${formatFeeJuiceWei(balanceWei)}`);

    if (balanceWei < minWei) {
        stopForAccountFunding({
            reason: 'insufficient_balance',
            accountAddress,
            commandHint,
            balanceWei,
            minWei,
        });
    }

    console.log(
        `  Status:            OK (${formatFeeJuiceWei(balanceWei)} ≥ ${formatFeeJuiceWei(minWei)})`
    );
    console.log('='.repeat(72) + '\n');
}

/** Exit helper for script entrypoints that catch {@link AccountFundingRequiredError}. */
export function exitIfAccountFundingRequired(err: unknown): boolean {
    if (err instanceof AccountFundingRequiredError) {
        process.exit(err.exitCode);
        return true;
    }
    return false;
}
