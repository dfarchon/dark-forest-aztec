/**
 * Deployer account diagnosis and resolution (loads `ACCOUNT_*` from env; no interactive prompts).
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fq, Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';

import { getAztecNetwork, getAztecNodeUrl, getOptionalEnv } from './env.ts';
import {
    assertAccountFeeJuiceReady,
    type FeePaymentContext,
    getFeePaymentMode,
    stopForAccountFunding,
} from './feePayment.ts';
import {
    createAccount,
    createAccountKeysOnly,
    deriveSchnorrInitializerlessAddress,
    type GetOrCreateAccountOptions,
    hasLocalAccount,
    loadAccountFromEnv,
} from './wallet.ts';

export type DeployerAccountDiagnosis = {
    ok: boolean;
    reasons: string[];
    derivedAddress: AztecAddress | null;
    envAddress: AztecAddress | null;
    addressMismatch: boolean;
    /**
     * Always true for Schnorr initializerless accounts once keys are valid —
     * no on-chain account deployment / init nullifier is required.
     */
    accountReady: boolean;
    inLocalWallet: boolean;
};

function accountKeysPresent(): boolean {
    return !!(
        getOptionalEnv('ACCOUNT_SALT') &&
        getOptionalEnv('ACCOUNT_SECRET_KEY') &&
        getOptionalEnv('ACCOUNT_SIGNING_KEY')
    );
}

function fqFromHex(signingKeyHex: string): Fq {
    const hex = signingKeyHex.startsWith('0x')
        ? signingKeyHex.slice(2)
        : signingKeyHex;
    return Fq.fromBuffer(Buffer.from(hex, 'hex'));
}

/**
 * Inspect `.env` account material vs the **connected Aztec node** (`AZTEC_NODE_URL`) and local PXE wallet.
 * Schnorr initializerless accounts need no on-chain deploy; readiness is keys + local registration.
 */
export async function diagnoseDeployerAccount(
    wallet: EmbeddedWallet,
    // Kept in signature for API compatibility.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    aztecNode: AztecNode
): Promise<DeployerAccountDiagnosis> {
    const reasons: string[] = [];
    const salt = getOptionalEnv('ACCOUNT_SALT');
    const secretKey = getOptionalEnv('ACCOUNT_SECRET_KEY');
    const signingKeyHex = getOptionalEnv('ACCOUNT_SIGNING_KEY');
    const envAddrStr = getOptionalEnv('ACCOUNT_ADDRESS');

    if (!salt || !secretKey || !signingKeyHex) {
        reasons.push(
            'Missing ACCOUNT_SALT, ACCOUNT_SECRET_KEY, or ACCOUNT_SIGNING_KEY'
        );
        return {
            ok: false,
            reasons,
            derivedAddress: null,
            envAddress: null,
            addressMismatch: false,
            accountReady: false,
            inLocalWallet: false,
        };
    }

    // Pure offline deterministic derivation — never touches PXE sync or Aztec RPC,
    // so transient public-node errors cannot break the diagnosis.
    const derivedAddress = await deriveSchnorrInitializerlessAddress(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        fqFromHex(signingKeyHex)
    );

    let envAddress: AztecAddress | null = null;
    if (envAddrStr) {
        try {
            envAddress = AztecAddress.fromStringUnsafe(envAddrStr);
        } catch {
            reasons.push(
                'ACCOUNT_ADDRESS in .env is not a valid Aztec address'
            );
        }
    }

    const addressMismatch =
        envAddress !== null && !envAddress.equals(derivedAddress);
    if (addressMismatch) {
        reasons.push(
            'ACCOUNT_ADDRESS does not match keys (derived address differs)'
        );
    }

    const inLocalWallet = await hasLocalAccount(wallet, derivedAddress);
    if (!inLocalWallet) {
        reasons.push('Account is not registered in the local PXE wallet yet');
    }

    const accountReady = !addressMismatch;
    const ok = accountReady;

    return {
        ok,
        reasons,
        derivedAddress,
        envAddress,
        addressMismatch,
        accountReady,
        inLocalWallet,
    };
}

/**
 * Offline preflight for account fee mode: when `FEE_PAYMENT_MODE=account` and no
 * `ACCOUNT_*` keys exist yet, generate keys purely offline (deterministic Schnorr
 * initializerless address derivation — no PXE, no Aztec RPC, no transactions),
 * write them to env, and stop for funding.
 *
 * Call this BEFORE creating the node client / wallet so transient public-RPC
 * errors (e.g. code 19 during PXE contract-class sync) cannot break first-run
 * key generation. No-op in sponsored mode or when keys already exist.
 */
export async function ensureAccountKeysOffline(
    options: GetOrCreateAccountOptions & { commandHint?: string } = {}
): Promise<void> {
    const { commandHint = 'pnpm deploy-contracts', ...createOpts } = options;
    if (getFeePaymentMode() !== 'account') return;
    if (accountKeysPresent()) return;
    const keys = await createAccountKeysOnly(createOpts);
    stopForAccountFunding({
        reason: 'keys_created',
        accountAddress: keys.address,
        commandHint,
    });
}

/** Skip printed diagnostics when `ACCOUNT_SILENT_DIAGNOSTICS=true|1`. */
export function isAccountDiagnosticsSilent(): boolean {
    const v = getOptionalEnv('ACCOUNT_SILENT_DIAGNOSTICS')
        ?.toLowerCase()
        .trim();
    return v === '1' || v === 'true';
}

export type PrintDeployerAccountSummaryOptions = {
    /** Override the first heading line (default: `--- Deployer account ---`). */
    heading?: string;
};

/**
 * Human-readable summary: network, derived vs env address, and local PXE status.
 */
export function printDeployerAccountSummary(
    d: DeployerAccountDiagnosis,
    options?: PrintDeployerAccountSummaryOptions
): void {
    const net = getAztecNetwork();
    const heading = options?.heading ?? '\n--- Deployer account ---';
    const lines: string[] = [heading];
    lines.push(
        `  Network: ${net ?? '(unset)'}  Aztec node (AZTEC_NODE_URL): ${getAztecNodeUrl()}`
    );
    lines.push(`  FEE_PAYMENT_MODE: ${getFeePaymentMode()}`);
    if (d.derivedAddress) {
        lines.push(`  Derived address: ${d.derivedAddress.toString()}`);
    }
    if (d.envAddress) {
        lines.push(`  ACCOUNT_ADDRESS in .env: ${d.envAddress.toString()}`);
        lines.push(
            `  Keys vs ACCOUNT_ADDRESS: ${d.addressMismatch ? 'mismatch' : 'match'}`
        );
    } else {
        lines.push('  ACCOUNT_ADDRESS in .env: (not set)');
    }
    lines.push(
        `  Account type: Schnorr initializerless (no deploy tx required)`
    );
    lines.push(`  In local PXE wallet: ${d.inLocalWallet ? 'yes' : 'no'}`);
    if (!d.ok && d.reasons.length) {
        lines.push('  Notes:');
        for (const r of d.reasons) {
            lines.push(`    - ${r}`);
        }
    }
    let status: string;
    if (!d.derivedAddress) {
        status = 'Invalid: missing or incomplete ACCOUNT_* keys.';
    } else if (d.addressMismatch) {
        status =
            'Blocked: ACCOUNT_ADDRESS does not match derived keys (fix .env or keys).';
    } else if (!d.inLocalWallet) {
        status =
            'Keys OK; account not in local PXE wallet (will register when loading).';
    } else {
        status = 'Ready: keys match and present in local wallet.';
    }
    lines.push(`  Status: ${status}`);
    console.log(lines.join('\n'));
}

export type ResolveDeployerAccountOptions = GetOrCreateAccountOptions & {
    mode: 'getOrCreate' | 'loadOnly';
    /** @deprecated Unused for Schnorr initializerless accounts. */
    deployTimeoutMs?: number;
    /** @deprecated Unused for Schnorr initializerless accounts. */
    ensureDeployed?: boolean;
    /**
     * Read-only callers (e.g. `verify-perms`): require ACCOUNT_* already present,
     * never create keys; uses `loadAccountFromEnv`.
     * Only valid with `mode: 'loadOnly'`.
     */
    readonlyVerification?: boolean;
    /**
     * Fee payment context from {@link prepareFeePayment}. When omitted, derived from
     * `FEE_PAYMENT_MODE` (sponsored without an instance address until deploy time).
     */
    feeCtx?: FeePaymentContext;
    /**
     * Command users should re-run after funding (printed in account-mode stop messages).
     * Default: `pnpm deploy-contracts`
     */
    commandHint?: string;
    /**
     * When true (default for write scripts), account mode runs FeeJuice preflight
     * before sending contract txs. Set false for read-only simulate scripts.
     */
    requireAccountFeeJuice?: boolean;
};

/**
 * Resolve deployer: load `ACCOUNT_*` from env and register the Schnorr account locally.
 * No interactive prompts — always continues with existing keys.
 * - `readonlyVerification: true` (loadOnly): fail fast if keys missing/mismatched; no key creation.
 * - `FEE_PAYMENT_MODE=account` + `getOrCreate` with no keys: generate keys, write env, stop for funding.
 * - `FEE_PAYMENT_MODE=account` with keys: FeeJuice preflight before continue.
 */
export async function resolveDeployerAccount(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: ResolveDeployerAccountOptions
): Promise<AztecAddress> {
    const {
        mode,
        readonlyVerification = false,
        feeCtx,
        commandHint = 'pnpm deploy-contracts',
        requireAccountFeeJuice = !readonlyVerification,
        ...createOpts
    } = options;

    const resolvedFeeCtx: FeePaymentContext = feeCtx ?? {
        mode: getFeePaymentMode(),
    };

    if (readonlyVerification && mode !== 'loadOnly') {
        throw new Error(
            'readonlyVerification is only supported with mode: "loadOnly"'
        );
    }

    if (mode === 'getOrCreate' && !accountKeysPresent()) {
        if (resolvedFeeCtx.mode === 'account') {
            // Offline key generation (no PXE / RPC) — then stop for funding.
            const keys = await createAccountKeysOnly({ ...createOpts });
            stopForAccountFunding({
                reason: 'keys_created',
                accountAddress: keys.address,
                commandHint,
            });
        }

        const addr = await createAccount(wallet, {
            ...createOpts,
            feeCtx: resolvedFeeCtx,
        });
        if (!isAccountDiagnosticsSilent()) {
            const afterCreate = await diagnoseDeployerAccount(
                wallet,
                aztecNode
            );
            printDeployerAccountSummary(afterCreate, {
                heading: '\n--- Deployer account (after create) ---',
            });
        }
        return addr;
    }

    if (mode === 'loadOnly' && !accountKeysPresent()) {
        throw new Error(
            'Account not in .env. Set ACCOUNT_SALT, ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY (or run deploy first).'
        );
    }

    const diagnosis = await diagnoseDeployerAccount(wallet, aztecNode);

    if (!isAccountDiagnosticsSilent()) {
        printDeployerAccountSummary(diagnosis, {
            heading: '\n--- Deployer account (before load) ---',
        });
    }

    if (!diagnosis.derivedAddress) {
        throw new Error(
            diagnosis.reasons.join('; ') || 'Invalid account diagnosis'
        );
    }

    if (diagnosis.addressMismatch) {
        throw new Error(
            'ACCOUNT_ADDRESS does not match derived keys; fix .env before running this script.\n' +
                `  Derived from keys: ${diagnosis.derivedAddress.toString()}\n` +
                `  ACCOUNT_ADDRESS:   ${diagnosis.envAddress?.toString() ?? '(invalid)'}\n` +
                '  Do not fund the mismatched ACCOUNT_ADDRESS — fix keys or address first.'
        );
    }

    if (readonlyVerification) {
        const addr = await loadAccountFromEnv(wallet, aztecNode, {
            logAccountStatus: false,
            feeCtx: resolvedFeeCtx,
        });
        if (!isAccountDiagnosticsSilent()) {
            const afterLoad = await diagnoseDeployerAccount(wallet, aztecNode);
            printDeployerAccountSummary(afterLoad, {
                heading: '\n--- Deployer account (after load) ---',
            });
        }
        return addr;
    }

    if (requireAccountFeeJuice) {
        await assertAccountFeeJuiceReady({
            feeCtx: resolvedFeeCtx,
            aztecNode,
            accountAddress: diagnosis.derivedAddress,
            commandHint,
        });
    }

    const addr = await loadAccountFromEnv(wallet, aztecNode, {
        logAccountStatus: false,
        feeCtx: resolvedFeeCtx,
    });
    if (!isAccountDiagnosticsSilent()) {
        const afterLoad = await diagnoseDeployerAccount(wallet, aztecNode);
        printDeployerAccountSummary(afterLoad, {
            heading: '\n--- Deployer account (after load) ---',
        });
    }
    return addr;
}
