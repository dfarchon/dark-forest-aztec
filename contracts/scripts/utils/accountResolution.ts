/**
 * Deployer account diagnosis and resolution (loads `ACCOUNT_*` from env; no interactive prompts).
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import { ContractInitializationStatus } from '@aztec/aztec.js/wallet';
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
     * `true` iff the account contract's init nullifier exists on-chain
     * (via `wallet.getContractMetadata`). This is the reliable way to check
     * whether an account contract has been deployed — unlike `node.getContract()`
     * which only checks the instance registry (account contracts don't publish there).
     */
    onChainDeployed: boolean;
    inLocalWallet: boolean;
};

function accountKeysPresent(): boolean {
    return !!(
        getOptionalEnv('ACCOUNT_SALT') &&
        getOptionalEnv('ACCOUNT_SECRET_KEY') &&
        getOptionalEnv('ACCOUNT_SIGNING_KEY')
    );
}

/**
 * Inspect `.env` account material vs the **connected Aztec node** (`AZTEC_NODE_URL`) and local PXE wallet.
 * Uses `wallet.getContractMetadata(address).initializationStatus` to check on-chain deployment
 * (init nullifier), which works reliably for account contracts.
 */
export async function diagnoseDeployerAccount(
    wallet: EmbeddedWallet,
    // Kept in signature for API compatibility; diagnosis uses wallet.getContractMetadata instead.
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
            onChainDeployed: false,
            inLocalWallet: false,
        };
    }

    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        Buffer.from(signingKeyHex, 'hex')
    );
    const derivedAddress = accountManager.address;

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

    let onChainDeployed = false;
    try {
        const metadata = await wallet.getContractMetadata(derivedAddress);
        onChainDeployed =
            metadata.initializationStatus ===
            ContractInitializationStatus.INITIALIZED;
    } catch {
        // getContractMetadata may throw if PXE hasn't fully started yet; treat as unknown
    }

    if (!onChainDeployed) {
        reasons.push(
            'Account contract not yet initialized on this Aztec node (init nullifier not found)'
        );
    }

    const inLocalWallet = await hasLocalAccount(wallet, derivedAddress);
    if (!inLocalWallet) {
        reasons.push('Account is not registered in the local PXE wallet yet');
    }

    const ok = !addressMismatch && onChainDeployed;

    return {
        ok,
        reasons,
        derivedAddress,
        envAddress,
        addressMismatch,
        onChainDeployed,
        inLocalWallet,
    };
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
 * Human-readable summary: network, derived vs env address, on-chain deployment + local PXE status.
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
        `  Deployed on-chain (init nullifier): ${d.onChainDeployed ? 'yes' : 'no'}`
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
    } else if (!d.onChainDeployed) {
        status =
            'Account not yet deployed on this Aztec node (will deploy when needed).';
    } else if (!d.inLocalWallet) {
        status =
            'On-chain OK; account not in local PXE wallet (will register when loading).';
    } else {
        status =
            'Ready: keys match, deployed on-chain, present in local wallet.';
    }
    lines.push(`  Status: ${status}`);
    console.log(lines.join('\n'));
}

export type ResolveDeployerAccountOptions = GetOrCreateAccountOptions & {
    mode: 'getOrCreate' | 'loadOnly';
    deployTimeoutMs?: number;
    /** When resolving with existing keys (default true). */
    ensureDeployed?: boolean;
    /**
     * Read-only callers (e.g. `verify-perms`): require ACCOUNT_* already deployed on this chain,
     * never send account deploy txs; uses `loadAccountFromEnv(..., ensureDeployed: false)`.
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
     * before any account deploy. Set false for read-only simulate scripts.
     */
    requireAccountFeeJuice?: boolean;
};

/**
 * Resolve deployer: load `ACCOUNT_*` from env and ensure the account exists on this chain when needed.
 * No interactive prompts — always continues with existing keys.
 * - `readonlyVerification: true` (loadOnly): fail fast if account not deployed on chain; no deploy.
 * - `FEE_PAYMENT_MODE=account` + `getOrCreate` with no keys: generate keys, write env, stop for funding.
 * - `FEE_PAYMENT_MODE=account` with keys: FeeJuice preflight before deploy/continue.
 */
export async function resolveDeployerAccount(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: ResolveDeployerAccountOptions
): Promise<AztecAddress> {
    const {
        mode,
        deployTimeoutMs = 120_000,
        ensureDeployed = true,
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
            const keys = await createAccountKeysOnly(wallet, {
                ...createOpts,
            });
            stopForAccountFunding({
                reason: 'keys_created',
                accountAddress: keys.address,
                commandHint,
            });
        }

        const addr = await createAccount(wallet, {
            ...createOpts,
            deployTimeoutMs,
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
        if (!diagnosis.onChainDeployed) {
            throw new Error(
                'Account contract not deployed on this Aztec node (init nullifier not found). Deploy the account first (e.g. pnpm deploy-contracts) or check AZTEC_NODE_URL.'
            );
        }
        const addr = await loadAccountFromEnv(wallet, aztecNode, {
            deployTimeoutMs,
            ensureDeployed: false,
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
            onChainDeployed: diagnosis.onChainDeployed,
            commandHint,
        });
    }

    const addr = await loadAccountFromEnv(wallet, aztecNode, {
        deployTimeoutMs,
        ensureDeployed,
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
