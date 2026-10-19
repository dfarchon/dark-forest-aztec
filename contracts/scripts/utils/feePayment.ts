/**
 * Fee payment helpers for scripts.
 *
 * Modes (`FEE_PAYMENT_MODE` in networks/<AZTEC_NETWORK>.env):
 * - `sponsored`: pay via canonical SponsoredFPC (`SponsoredFeePaymentMethod`).
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

import { getNetworkValue, loadNetworkEnv } from '../runtime/env.ts';
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
    const raw = getNetworkValue('FEE_PAYMENT_MODE')?.toLowerCase().trim();
    if (raw === 'sponsored' || raw === 'account') return raw;
    if (!raw) {
        throw new Error(
            'Missing FEE_PAYMENT_MODE in the active networks/*.env file.'
        );
    }
    throw new Error(
        `Invalid FEE_PAYMENT_MODE="${raw}". Expected "sponsored" or "account".`
    );
}

/**
 * Minimum FeeJuice (wei) on the fee payer before write scripts send txs.
 * Account mode: deployer. Sponsored mode: canonical SponsoredFPC.
 * Network file: `ACCOUNT_MIN_BALANCE_FJ` as a decimal FJ string (e.g. "5").
 */
export function getAccountMinBalanceFjWei(): bigint {
    const raw = getNetworkValue('ACCOUNT_MIN_BALANCE_FJ');
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

function networkLabel(): string {
    return loadNetworkEnv().network;
}

function nodeUrl(): string {
    const url = getNetworkValue('AZTEC_NODE_URL');
    if (!url) {
        throw new Error(
            'Missing AZTEC_NODE_URL in the active networks/*.env file.'
        );
    }
    return url;
}

function relativeNetworkFile(): string {
    return path.relative(process.cwd(), loadNetworkEnv().networkFilePath);
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
    const network = networkLabel();
    const aztecNodeUrl = nodeUrl();
    const envFile = relativeNetworkFile();
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
            `  Aztec node:          ${aztecNodeUrl}`,
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
            `  Aztec node:       ${aztecNodeUrl}`,
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
            `  Aztec node:       ${aztecNodeUrl}`,
            `  Env file:         ${envFile}`,
            '',
            '  Next steps:',
            `    1. Bridge / fund FeeJuice to the address above.`,
            `       Bridge (Aztec mainet): ${FEE_JUICE_BRIDGE_URL}`,
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

function stopForSponsoredFpcFunding(params: {
    reason: 'insufficient_balance' | 'balance_query_failed';
    fpcAddress: AztecAddress;
    commandHint: string;
    balanceWei?: bigint;
    minWei?: bigint;
    queryError?: string;
}): never {
    const {
        reason,
        fpcAddress,
        commandHint,
        balanceWei,
        minWei = getAccountMinBalanceFjWei(),
        queryError,
    } = params;

    const addr = fpcAddress.toString();
    const network = networkLabel();
    const aztecNodeUrl = nodeUrl();
    const envFile = relativeNetworkFile();
    const lines: string[] = [];

    if (reason === 'balance_query_failed') {
        lines.push(
            banner('SPONSORED FEE MODE — COULD NOT READ SPONSORED FPC BALANCE'),
            '',
            `  FEE_PAYMENT_MODE=sponsored`,
            `  SponsoredFPC:     ${addr}`,
            `  Network label:    ${network}`,
            `  Aztec node:       ${aztecNodeUrl}`,
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
            banner(
                'SPONSORED FEE MODE — INSUFFICIENT FEEJUICE ON SPONSORED FPC'
            ),
            '',
            '  Refusing to send any transaction until the SponsoredFPC has enough FeeJuice.',
            '  Fees are paid by this protocol contract, not the deployer account.',
            '',
            `  FEE_PAYMENT_MODE=sponsored`,
            `  SponsoredFPC:     ${addr}`,
            `  Current balance:  ${formatFeeJuiceWei(bal)}`,
            `  Minimum required: ${formatFeeJuiceWei(minWei)}`,
            `  Shortfall:        ${formatFeeJuiceWei(shortfall)}`,
            `  Network label:    ${network}`,
            `  Aztec node:       ${aztecNodeUrl}`,
            `  Env file:         ${envFile}`,
            '',
            '  This address is the canonical SponsoredFPC. Local sandbox usually',
            '  pre-funds it; a public node may not.',
            '',
            '  Next steps:',
            '    1. Use a node whose SponsoredFPC is funded, or',
            '    2. Set FEE_PAYMENT_MODE=account and fund ACCOUNT_ADDRESS instead.',
            `    3. Re-run: ${commandHint}`,
            '',
            '  Tip: override the minimum with ACCOUNT_MIN_BALANCE_FJ (decimal FJ, e.g. "5").',
            ''
        );
    }

    const message = lines.filter((l) => l !== undefined).join('\n');
    console.error(message);
    throw new AccountFundingRequiredError(message.trim(), addr);
}

async function assertPayerFeeJuiceReady(params: {
    title: string;
    mode: FeePaymentMode;
    payerLabel: string;
    extraLines: string[];
    payer: AztecAddress;
    aztecNode: AztecNode;
    commandHint: string;
    onQueryFailed: (queryError: string, minWei: bigint) => never;
    onInsufficient: (balanceWei: bigint, minWei: bigint) => never;
}): Promise<void> {
    const minWei = getAccountMinBalanceFjWei();
    console.log(banner(params.title));
    console.log(`  FEE_PAYMENT_MODE=${params.mode}`);
    console.log(`  Network label:    ${networkLabel()}`);
    console.log(`  Aztec node:       ${nodeUrl()}`);
    console.log(`  ${params.payerLabel}${params.payer.toString()}`);
    for (const line of params.extraLines) console.log(line);
    console.log(`  Minimum FeeJuice: ${formatFeeJuiceWei(minWei)}`);

    const balanceWei = await getFeeJuiceBalance(
        params.payer,
        params.aztecNode
    ).catch((err: unknown) => {
        const queryError = err instanceof Error ? err.message : String(err);
        console.log(`  Current balance:  (query failed)`);
        params.onQueryFailed(queryError, minWei);
    });

    console.log(`  Current balance:  ${formatFeeJuiceWei(balanceWei)}`);

    if (balanceWei < minWei) {
        params.onInsufficient(balanceWei, minWei);
    }

    console.log(
        `  Status:            OK (${formatFeeJuiceWei(balanceWei)} ≥ ${formatFeeJuiceWei(minWei)})`
    );
    console.log('='.repeat(72) + '\n');
}

/**
 * Fee preflight: stop if the payer (deployer account or SponsoredFPC) is short of FeeJuice.
 */
export async function assertFeePaymentReady(params: {
    feeCtx: FeePaymentContext;
    aztecNode: AztecNode;
    accountAddress: AztecAddress;
    commandHint: string;
}): Promise<void> {
    const { feeCtx, aztecNode, accountAddress, commandHint } = params;

    if (feeCtx.mode === 'sponsored') {
        if (!feeCtx.sponsoredFpc) {
            throw new Error(
                'Sponsored fee mode requires a registered SponsoredFPC instance'
            );
        }
        const fpcAddress = feeCtx.sponsoredFpc.address;
        await assertPayerFeeJuiceReady({
            title: 'SPONSORED FEE MODE — PREFLIGHT',
            mode: 'sponsored',
            payerLabel: 'SponsoredFPC:     ',
            extraLines: [
                '  Fee payer:        canonical SponsoredFPC (not the deployer)',
            ],
            payer: fpcAddress,
            aztecNode,
            commandHint,
            onQueryFailed: (queryError, minWei) =>
                stopForSponsoredFpcFunding({
                    reason: 'balance_query_failed',
                    fpcAddress,
                    commandHint,
                    minWei,
                    queryError,
                }),
            onInsufficient: (balanceWei, minWei) =>
                stopForSponsoredFpcFunding({
                    reason: 'insufficient_balance',
                    fpcAddress,
                    commandHint,
                    balanceWei,
                    minWei,
                }),
        });
        return;
    }

    await assertPayerFeeJuiceReady({
        title: 'ACCOUNT FEE MODE — PREFLIGHT',
        mode: 'account',
        payerLabel: 'Account address:  ',
        extraLines: [
            '  Account type:     Schnorr initializerless (no deploy tx)',
        ],
        payer: accountAddress,
        aztecNode,
        commandHint,
        onQueryFailed: (queryError, minWei) =>
            stopForAccountFunding({
                reason: 'balance_query_failed',
                accountAddress,
                commandHint,
                minWei,
                queryError,
            }),
        onInsufficient: (balanceWei, minWei) =>
            stopForAccountFunding({
                reason: 'insufficient_balance',
                accountAddress,
                commandHint,
                balanceWei,
                minWei,
            }),
    });
}

/** @deprecated Use {@link assertFeePaymentReady}. */
export async function assertAccountFeeJuiceReady(
    params: Parameters<typeof assertFeePaymentReady>[0]
): Promise<void> {
    return assertFeePaymentReady(params);
}

/** Exit helper for script entrypoints that catch {@link AccountFundingRequiredError}. */
export function exitIfAccountFundingRequired(err: unknown): boolean {
    if (err instanceof AccountFundingRequiredError) {
        process.exit(err.exitCode);
        return true;
    }
    return false;
}
