import { AztecAddress } from '@aztec/aztec.js/addresses';
import { BlockNumber, Fq, Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import { type AccountManager } from '@aztec/aztec.js/wallet';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import fs from 'fs';
import path from 'path';

import {
    getContractsEnvFilePath,
    getOptionalEnv,
    getWriteEnvFile,
    reloadContractsEnv,
} from './env.ts';
import {
    type FeePaymentContext,
    getSponsoredPFCContract,
} from './feePayment.ts';

const DEFAULT_PXE_STORE_DIR = path.join(
    import.meta.dirname,
    '..',
    '..',
    '.store'
);
const FINGERPRINT_FILENAME = '.network-fingerprint';

/** Persist Fq signing keys as hex without a 0x prefix (matches ACCOUNT_SIGNING_KEY). */
function fqToHex(signingKey: Fq): string {
    return signingKey.toBuffer().toString('hex');
}

function fqFromHex(signingKeyHex: string): Fq {
    const hex = signingKeyHex.startsWith('0x')
        ? signingKeyHex.slice(2)
        : signingKeyHex;
    return Fq.fromBuffer(Buffer.from(hex, 'hex'));
}

/**
 * Compute a fingerprint for the current network instance by hashing block 1's header.
 * Returns a sentinel value when the network has not yet produced block 1.
 */
async function getNetworkFingerprint(node: AztecNode): Promise<string> {
    const blockNumber = await node.getBlockNumber();
    if (blockNumber < 1) return 'genesis-pending';
    const block = await node.getBlock(BlockNumber(1));
    if (!block) return 'genesis-pending';
    return block.hash.toString();
}

export type SetupWalletOptions = {
    /** If true, remove existing PXE store before creating wallet (default: false) */
    clearStore?: boolean;
    /** Enable prover (default: true). Callers (e.g. deploy script) should pass from env if needed. */
    proverEnabled?: boolean;
    /** Override PXE store directory (default: scripts/.store) */
    storeDir?: string;
};

/**
 * Create an EmbeddedWallet connected to the given Aztec node.
 * Automatically detects network changes via block-1 fingerprint and clears
 * the stale PXE store when necessary (without touching .env or account files).
 */
export async function setupWallet(
    aztecNode: AztecNode,
    options: SetupWalletOptions = {}
): Promise<EmbeddedWallet> {
    const {
        clearStore = false,
        proverEnabled = true,
        storeDir = DEFAULT_PXE_STORE_DIR,
    } = options;

    const fingerprintPath = path.join(storeDir, FINGERPRINT_FILENAME);
    const fingerprint = await getNetworkFingerprint(aztecNode);
    const storedFingerprint = fs.existsSync(fingerprintPath)
        ? fs.readFileSync(fingerprintPath, 'utf-8').trim()
        : null;

    const networkChanged =
        storedFingerprint !== null && storedFingerprint !== fingerprint;

    if (clearStore || networkChanged) {
        if (networkChanged) {
            console.warn(
                '[setupWallet] Network change detected, clearing stale PXE store'
            );
        }
        if (fs.existsSync(storeDir)) {
            fs.rmSync(storeDir, { recursive: true, force: true });
        }
    }

    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(fingerprintPath, fingerprint, 'utf-8');

    return await EmbeddedWallet.create(aztecNode, {
        pxe: {
            dataDirectory: storeDir,
            proverEnabled,
            dataStoreMapSizeKb: 1e6,
        },
    });
}

/** @deprecated Import from `./feePayment.ts` — re-exported for compatibility. */
export { getSponsoredPFCContract };

export async function hasLocalAccount(
    wallet: EmbeddedWallet,
    address: AztecAddress
): Promise<boolean> {
    const accounts = await wallet.getAccounts();
    return accounts.some((account) => account.item.equals(address));
}

/**
 * Load an account that was previously registered (e.g. after deploy wrote .env).
 * Reads ACCOUNT_SALT, ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY from the contracts env,
 * recreates the same Schnorr initializerless account in the wallet, and returns its address.
 *
 * Use this when:
 * - You called setupWallet with clearStore: true (fresh PXE), or
 * - You are on a new machine / new run and need to "attach" the same account.
 *
 * Initializerless accounts need no deployment transaction.
 */
export async function loadAccountFromEnv(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: {
        /** @deprecated No-op for Schnorr initializerless accounts. */
        ensureDeployed?: boolean;
        /** @deprecated Unused for Schnorr initializerless accounts. */
        deployTimeoutMs?: number;
        /** Print chain + local wallet diagnosis (default true; use false when caller already printed). */
        logAccountStatus?: boolean;
        /** @deprecated Unused for Schnorr initializerless accounts. */
        feeCtx?: FeePaymentContext;
    } = {}
): Promise<AztecAddress> {
    const shouldLog = options.logAccountStatus !== false;
    if (shouldLog) {
        const ar = await import('./accountResolution.ts');
        if (!ar.isAccountDiagnosticsSilent()) {
            const d = await ar.diagnoseDeployerAccount(wallet, aztecNode);
            ar.printDeployerAccountSummary(d);
        }
    }
    const envAddress = getOptionalEnv('ACCOUNT_ADDRESS');
    const salt = getOptionalEnv('ACCOUNT_SALT');
    const secretKey = getOptionalEnv('ACCOUNT_SECRET_KEY');
    const signingKeyHex = getOptionalEnv('ACCOUNT_SIGNING_KEY');
    if (!salt || !secretKey || !signingKeyHex) {
        throw new Error(
            'Account not in .env. Set ACCOUNT_SALT, ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY (or run deploy first).'
        );
    }

    if (envAddress) {
        const accountAddress = AztecAddress.fromStringUnsafe(envAddress);
        if (await hasLocalAccount(wallet, accountAddress)) {
            return accountAddress;
        }
    }

    const accountManager = await wallet.createSchnorrInitializerlessAccount(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        fqFromHex(signingKeyHex)
    );

    return accountManager.address;
}

export type GetOrCreateAccountOptions = {
    /** Where to write account vars when creating (default: resolved contracts env file) */
    envFilePath?: string;
    /** If false, do not append to .env after creating (default: true) */
    writeEnv?: boolean;
    /** @deprecated Unused for Schnorr initializerless accounts. */
    deployTimeoutMs?: number;
    /** @deprecated Unused for Schnorr initializerless accounts. */
    feeCtx?: FeePaymentContext;
};

/** Append a new `ACCOUNT_*` block (does not edit prior lines; last occurrence wins in dotenv parse). */
export function appendAccountToEnv(
    salt: Fr,
    secretKey: Fr,
    signingKey: Fq,
    accountAddress: AztecAddress,
    envFilePath: string
) {
    const block = [
        `ACCOUNT_SALT=${salt.toString()}`,
        `ACCOUNT_SECRET_KEY=${secretKey.toString()}`,
        `ACCOUNT_SIGNING_KEY=${fqToHex(signingKey)}`,
        `ACCOUNT_ADDRESS=${accountAddress.toString()}`,
    ].join('\n');
    fs.appendFileSync(envFilePath, '\n\n' + block);
}

export type CreateAccountKeysResult = {
    salt: Fr;
    secretKey: Fr;
    signingKey: Fq;
    address: AztecAddress;
    accountManager: AccountManager;
};

/**
 * Generate a new Schnorr initializerless account, optionally persist ACCOUNT_* to env,
 * and register it in the local wallet — **without** sending any transaction.
 * Used by account fee mode so the user can fund the address before any tx.
 */
export async function createAccountKeysOnly(
    wallet: EmbeddedWallet,
    options: GetOrCreateAccountOptions = {}
): Promise<CreateAccountKeysResult> {
    const {
        envFilePath = getContractsEnvFilePath(),
        writeEnv = getWriteEnvFile(),
    } = options;

    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = Fq.random();
    const accountManager = await wallet.createSchnorrInitializerlessAccount(
        secretKey,
        salt,
        signingKey
    );

    if (writeEnv) {
        appendAccountToEnv(
            salt,
            secretKey,
            signingKey,
            accountManager.address,
            envFilePath
        );
        reloadContractsEnv({ override: true });
    }

    return {
        salt,
        secretKey,
        signingKey,
        address: accountManager.address,
        accountManager,
    };
}

/**
 * Create a new Schnorr initializerless account and optionally write to .env.
 * No account deployment transaction is sent.
 */
export async function createAccount(
    wallet: EmbeddedWallet,
    options: GetOrCreateAccountOptions = {}
): Promise<AztecAddress> {
    const keys = await createAccountKeysOnly(wallet, options);
    return keys.address;
}

/**
 * Get account address: load from .env if present, otherwise create a new account,
 * write to .env, and return the address.
 */
export async function getOrCreateAccount(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: GetOrCreateAccountOptions = {}
): Promise<AztecAddress> {
    const hasAccount =
        getOptionalEnv('ACCOUNT_SALT') &&
        getOptionalEnv('ACCOUNT_SECRET_KEY') &&
        getOptionalEnv('ACCOUNT_SIGNING_KEY');
    if (hasAccount) {
        return loadAccountFromEnv(wallet, aztecNode, {
            logAccountStatus: true,
            feeCtx: options.feeCtx,
        });
    }
    return createAccount(wallet, options);
}

/** Credentials for a test account (persist to JSON and reload with loadAccountFromCredentials). */
export type TestAccountCredentials = {
    salt: string;
    secretKey: string;
    signingKey: string;
    address: string;
};

/**
 * Create a new Schnorr initializerless account and return credentials (no .env write).
 * Use with loadAccountFromCredentials on later runs to reuse the same account.
 * No deployment transaction is required.
 */
export async function createAccountWithCredentials(
    wallet: EmbeddedWallet,
    options: { deployTimeoutMs?: number; feeCtx?: FeePaymentContext } = {}
): Promise<TestAccountCredentials> {
    void options;
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = Fq.random();
    const accountManager = await wallet.createSchnorrInitializerlessAccount(
        secretKey,
        salt,
        signingKey
    );

    return {
        salt: salt.toString(),
        secretKey: secretKey.toString(),
        signingKey: fqToHex(signingKey),
        address: accountManager.address.toString(),
    };
}

/**
 * Recreate a Schnorr initializerless account in the wallet from saved credentials
 * (e.g. from .test-accounts.json).
 */
export async function loadAccountFromCredentials(
    wallet: EmbeddedWallet,
    cred: TestAccountCredentials,
    _aztecNode: AztecNode,
    options: {
        /** @deprecated No-op for Schnorr initializerless accounts. */
        ensureDeployed?: boolean;
        /** @deprecated Unused for Schnorr initializerless accounts. */
        deployTimeoutMs?: number;
        /** @deprecated Unused for Schnorr initializerless accounts. */
        feeCtx?: FeePaymentContext;
    } = {}
): Promise<AztecAddress> {
    void options;
    const accountAddress = AztecAddress.fromStringUnsafe(cred.address);
    if (await hasLocalAccount(wallet, accountAddress)) {
        return accountAddress;
    }

    const accountManager = await wallet.createSchnorrInitializerlessAccount(
        Fr.fromString(cred.secretKey),
        Fr.fromString(cred.salt),
        fqFromHex(cred.signingKey)
    );

    return accountManager.address;
}
