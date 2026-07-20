import { NO_FROM } from '@aztec/aztec.js/account';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { BlockNumber, Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import {
    type AccountManager,
    ContractInitializationStatus,
} from '@aztec/aztec.js/wallet';
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
    buildFeeSendFields,
    type FeePaymentContext,
    getFeePaymentMode,
    getSponsoredPFCContract,
} from './feePayment.ts';

const DEFAULT_PXE_STORE_DIR = path.join(
    import.meta.dirname,
    '..',
    '..',
    '.store'
);
const FINGERPRINT_FILENAME = '.network-fingerprint';

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

function resolveFeeCtx(feeCtx?: FeePaymentContext): FeePaymentContext {
    if (feeCtx) return feeCtx;
    const mode = getFeePaymentMode();
    if (mode === 'sponsored') {
        // Lazy: callers of legacy APIs without feeCtx still expect sponsored.
        // They must have registered SponsoredFPC already; address is resolved on send.
        return { mode: 'sponsored' };
    }
    return { mode: 'account' };
}

async function deployAccountIfNeeded(
    wallet: EmbeddedWallet,
    accountManager: AccountManager,
    timeoutMs: number,
    feeCtx?: FeePaymentContext
): Promise<boolean> {
    const metadata = await wallet.getContractMetadata(accountManager.address);
    if (
        metadata.initializationStatus ===
        ContractInitializationStatus.INITIALIZED
    )
        return false;

    const ctx = resolveFeeCtx(feeCtx);
    let sponsoredReady = ctx;
    if (ctx.mode === 'sponsored' && !ctx.sponsoredFpc) {
        sponsoredReady = {
            mode: 'sponsored',
            sponsoredFpc: await getSponsoredPFCContract(),
        };
    }

    const deployMethod = await accountManager.getDeployMethod();
    try {
        await deployMethod.send({
            from: NO_FROM,
            ...buildFeeSendFields(sponsoredReady),
            wait: { timeout: timeoutMs },
        });
        return true;
    } catch (error) {
        if (isAccountAlreadyDeployedError(error)) {
            return false;
        }
        throw error;
    }
}

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
 * recreates the same ECDSAR account in the wallet, and returns its address.
 *
 * Use this when:
 * - You called setupWallet with clearStore: true (fresh PXE), or
 * - You are on a new machine / new run and need to "attach" the same on-chain account.
 *
 * If you did NOT clear the store (setupWallet(..., { clearStore: false })), the wallet
 * already has the account; you can get the address from ACCOUNT_ADDRESS in env
 * or wallet.getAccounts() and use it as `from` without calling this.
 */
export async function loadAccountFromEnv(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: {
        ensureDeployed?: boolean;
        deployTimeoutMs?: number;
        /** Print chain + local wallet diagnosis (default true; use false when caller already printed). */
        logAccountStatus?: boolean;
        /** Fee payment context for account deploy (default: from FEE_PAYMENT_MODE). */
        feeCtx?: FeePaymentContext;
    } = {}
): Promise<AztecAddress> {
    const { ensureDeployed = true, deployTimeoutMs = 120_000 } = options;
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
            if (!ensureDeployed) return accountAddress;
            const metadata = await wallet.getContractMetadata(accountAddress);
            if (
                metadata.initializationStatus ===
                ContractInitializationStatus.INITIALIZED
            )
                return accountAddress;
        }
    }

    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        Buffer.from(signingKeyHex, 'hex')
    );

    if (ensureDeployed) {
        await deployAccountIfNeeded(
            wallet,
            accountManager,
            deployTimeoutMs,
            options.feeCtx
        );
    }

    return accountManager.address;
}

export type GetOrCreateAccountOptions = {
    /** Where to write account vars when creating (default: resolved contracts env file) */
    envFilePath?: string;
    /** If false, do not append to .env after creating (default: true) */
    writeEnv?: boolean;
    /** Deploy timeout in ms (default: 120_000) */
    deployTimeoutMs?: number;
    /** Fee payment context (default: from FEE_PAYMENT_MODE). */
    feeCtx?: FeePaymentContext;
};

/** Append a new `ACCOUNT_*` block (does not edit prior lines; last occurrence wins in dotenv parse). */
export function appendAccountToEnv(
    salt: Fr,
    secretKey: Fr,
    signingKey: Buffer,
    accountAddress: AztecAddress,
    envFilePath: string
) {
    const block = [
        `ACCOUNT_SALT=${salt.toString()}`,
        `ACCOUNT_SECRET_KEY=${secretKey.toString()}`,
        `ACCOUNT_SIGNING_KEY=${signingKey.toString('hex')}`,
        `ACCOUNT_ADDRESS=${accountAddress.toString()}`,
    ].join('\n');
    fs.appendFileSync(envFilePath, '\n\n' + block);
}

export type CreateAccountKeysResult = {
    salt: Fr;
    secretKey: Fr;
    signingKey: Buffer;
    address: AztecAddress;
    accountManager: AccountManager;
};

/**
 * Generate a new ECDSAR account, optionally persist ACCOUNT_* to env, and register
 * it in the local wallet — **without** sending a deploy transaction.
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
    const signingKey = Buffer.alloc(32, Fr.random().toBuffer());
    const accountManager = await wallet.createECDSARAccount(
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
 * Create a new ECDSAR account, deploy it (using FEE_PAYMENT_MODE / feeCtx), and
 * optionally write to .env.
 * For sponsored mode, caller must have already registered SponsoredFPC.
 * Prefer account-mode first-run via {@link createAccountKeysOnly} + funding stop.
 */
export async function createAccount(
    wallet: EmbeddedWallet,
    options: GetOrCreateAccountOptions = {}
): Promise<AztecAddress> {
    const { deployTimeoutMs = 120_000, feeCtx } = options;

    const keys = await createAccountKeysOnly(wallet, options);

    await deployAccountIfNeeded(
        wallet,
        keys.accountManager,
        deployTimeoutMs,
        feeCtx
    );

    return keys.address;
}

/**
 * Get account address: load from .env if present, otherwise create a new account,
 * deploy it, write to .env, and return the address.
 * Caller must have registered SponsoredFPC with the wallet before calling this
 * when using sponsored fee mode.
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
            deployTimeoutMs: options.deployTimeoutMs,
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

function isAccountAlreadyDeployedError(error: unknown): boolean {
    const toMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
    const main = toMsg(error).toLowerCase();
    let causeStr = '';
    if (error instanceof Error && error.cause != null) {
        const c = error.cause;
        if (typeof c === 'object' && c !== null && 'message' in c) {
            causeStr = String(
                (c as { message: unknown }).message
            ).toLowerCase();
        } else {
            causeStr = toMsg(c).toLowerCase();
        }
    }
    const combined = `${main} ${causeStr}`;
    return (
        combined.includes('existing nullifier') ||
        combined.includes('already deployed') ||
        combined.includes('already exists')
    );
}

/**
 * Create a new ECDSAR account, deploy it, and return credentials (no .env write).
 * Use with loadAccountFromCredentials on later runs to reuse the same account.
 * Local test helper — uses sponsored fees by default.
 */
export async function createAccountWithCredentials(
    wallet: EmbeddedWallet,
    options: { deployTimeoutMs?: number; feeCtx?: FeePaymentContext } = {}
): Promise<TestAccountCredentials> {
    const { deployTimeoutMs = 120_000, feeCtx } = options;
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = Buffer.alloc(32, Fr.random().toBuffer());
    const accountManager = await wallet.createECDSARAccount(
        secretKey,
        salt,
        signingKey
    );

    let ctx = feeCtx ?? { mode: 'sponsored' as const };
    if (ctx.mode === 'sponsored' && !ctx.sponsoredFpc) {
        ctx = {
            mode: 'sponsored',
            sponsoredFpc: await getSponsoredPFCContract(),
        };
    }

    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod.send({
        from: NO_FROM,
        ...buildFeeSendFields(ctx),
        skipClassPublication: true,
        skipInstancePublication: true,
        wait: { timeout: deployTimeoutMs },
    });

    return {
        salt: salt.toString(),
        secretKey: secretKey.toString(),
        signingKey: signingKey.toString('hex'),
        address: accountManager.address.toString(),
    };
}

/**
 * Recreate an ECDSAR account in the wallet from saved credentials (e.g. from .test-accounts.json).
 */
export async function loadAccountFromCredentials(
    wallet: EmbeddedWallet,
    cred: TestAccountCredentials,
    aztecNode: AztecNode,
    options: {
        ensureDeployed?: boolean;
        deployTimeoutMs?: number;
        feeCtx?: FeePaymentContext;
    } = {}
): Promise<AztecAddress> {
    const { ensureDeployed = true, deployTimeoutMs = 120_000 } = options;
    const accountAddress = AztecAddress.fromStringUnsafe(cred.address);
    if (await hasLocalAccount(wallet, accountAddress)) {
        if (!ensureDeployed) return accountAddress;
        const metadata = await wallet.getContractMetadata(accountAddress);
        if (
            metadata.initializationStatus ===
            ContractInitializationStatus.INITIALIZED
        )
            return accountAddress;
    }

    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(cred.secretKey),
        Fr.fromString(cred.salt),
        Buffer.from(cred.signingKey, 'hex')
    );

    if (ensureDeployed) {
        await deployAccountIfNeeded(
            wallet,
            accountManager,
            deployTimeoutMs,
            options.feeCtx
        );
    }

    return accountManager.address;
}
