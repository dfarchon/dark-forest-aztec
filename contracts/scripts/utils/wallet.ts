import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { BlockNumber, Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { AccountManager } from '@aztec/aztec.js/wallet';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import fs from 'fs';
import path from 'path';

const DEFAULT_PXE_STORE_DIR = path.join(
    import.meta.dirname,
    '..',
    '..',
    '.store'
);
const DEFAULT_ENV_PATH = path.join(import.meta.dirname, '..', '..', '.env');
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
    return (await block.hash()).toString();
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
        pxeConfig: {
            dataDirectory: storeDir,
            proverEnabled,
            dataStoreMapSizeKb: 1e6,
        },
    });
}

/**
 * Get the canonical SponsoredFPC contract instance (for sponsored fee payments).
 * Use this when sending transactions with SponsoredFeePaymentMethod.
 */
export async function getSponsoredPFCContract() {
    const instance = await getContractInstanceFromInstantiationParams(
        SponsoredFPCContractArtifact,
        {
            salt: new Fr(SPONSORED_FPC_SALT),
        }
    );
    return instance;
}

async function deployAccountIfNeeded(
    aztecNode: AztecNode,
    accountManager: AccountManager,
    timeoutMs: number
): Promise<boolean> {
    const existing = await aztecNode.getContract(accountManager.address);
    if (existing) return false;

    const sponsoredFPC = await getSponsoredPFCContract();
    const deployMethod = await accountManager.getDeployMethod();
    try {
        await deployMethod.send({
            from: AztecAddress.ZERO,
            fee: {
                paymentMethod: new SponsoredFeePaymentMethod(
                    sponsoredFPC.address
                ),
            },
            skipClassPublication: true,
            skipInstancePublication: true,
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

async function hasLocalAccount(
    wallet: EmbeddedWallet,
    address: AztecAddress
): Promise<boolean> {
    const accounts = await wallet.getAccounts();
    return accounts.some((account) => account.item.equals(address));
}

/**
 * Load an account that was previously registered (e.g. after deploy wrote .env).
 * Reads ACCOUNT_SALT, ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY from process.env,
 * recreates the same ECDSAR account in the wallet, and returns its address.
 *
 * Use this when:
 * - You called setupWallet with clearStore: true (fresh PXE), or
 * - You are on a new machine / new run and need to "attach" the same on-chain account.
 *
 * If you did NOT clear the store (setupWallet(..., { clearStore: false })), the wallet
 * already has the account; you can get the address from process.env.ACCOUNT_ADDRESS
 * or wallet.getAccounts() and use it as `from` without calling this.
 */
export async function loadAccountFromEnv(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: { ensureDeployed?: boolean; deployTimeoutMs?: number } = {}
): Promise<AztecAddress> {
    const { ensureDeployed = true, deployTimeoutMs = 120_000 } = options;
    const envAddress = process.env.ACCOUNT_ADDRESS;
    const salt = process.env.ACCOUNT_SALT;
    const secretKey = process.env.ACCOUNT_SECRET_KEY;
    const signingKeyHex = process.env.ACCOUNT_SIGNING_KEY;
    if (!salt || !secretKey || !signingKeyHex) {
        throw new Error(
            'Account not in .env. Set ACCOUNT_SALT, ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY (or run deploy first).'
        );
    }

    if (envAddress) {
        const accountAddress = AztecAddress.fromString(envAddress);
        if (await hasLocalAccount(wallet, accountAddress)) {
            if (!ensureDeployed) return accountAddress;
            const deployed = await aztecNode.getContract(accountAddress);
            if (deployed) return accountAddress;
        }
    }

    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        Buffer.from(signingKeyHex, 'hex')
    );

    if (ensureDeployed) {
        await deployAccountIfNeeded(aztecNode, accountManager, deployTimeoutMs);
    }

    return accountManager.address;
}

export type GetOrCreateAccountOptions = {
    /** Where to write account vars when creating (default: contracts/.env) */
    envFilePath?: string;
    /** If false, do not append to .env after creating (default: true) */
    writeEnv?: boolean;
    /** Deploy timeout in ms (default: 120_000) */
    deployTimeoutMs?: number;
};

function appendAccountToEnv(
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

/**
 * Create a new ECDSAR account, deploy it with sponsored fee, and optionally write to .env.
 * Caller must have already registered SponsoredFPC with the wallet.
 */
export async function createAccount(
    wallet: EmbeddedWallet,
    options: GetOrCreateAccountOptions = {}
): Promise<AztecAddress> {
    const {
        envFilePath = DEFAULT_ENV_PATH,
        writeEnv = process.env.WRITE_ENV_FILE !== 'false',
        deployTimeoutMs = 120_000,
    } = options;

    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = Buffer.alloc(32, Fr.random().toBuffer());
    const accountManager = await wallet.createECDSARAccount(
        secretKey,
        salt,
        signingKey
    );

    const sponsoredFPC = await getSponsoredPFCContract();
    const deployMethod = await accountManager.getDeployMethod();
    const deployOpts = {
        from: AztecAddress.ZERO,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
        skipClassPublication: true,
        skipInstancePublication: true,
        wait: { timeout: deployTimeoutMs },
    };
    await deployMethod.send(deployOpts);

    if (writeEnv) {
        appendAccountToEnv(
            salt,
            secretKey,
            signingKey,
            accountManager.address,
            envFilePath
        );
    }
    return accountManager.address;
}

/**
 * Get account address: load from .env if present, otherwise create a new account,
 * deploy it, write to .env, and return the address.
 * Caller must have registered SponsoredFPC with the wallet before calling this.
 */
export async function getOrCreateAccount(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode,
    options: GetOrCreateAccountOptions = {}
): Promise<AztecAddress> {
    const hasAccount =
        process.env.ACCOUNT_SALT &&
        process.env.ACCOUNT_SECRET_KEY &&
        process.env.ACCOUNT_SIGNING_KEY;
    if (hasAccount) {
        return loadAccountFromEnv(wallet, aztecNode, {
            deployTimeoutMs: options.deployTimeoutMs,
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
    const cause =
        error instanceof Error && error.cause != null
            ? toMsg(error.cause).toLowerCase()
            : '';
    const combined = `${main} ${cause}`;
    return (
        combined.includes('existing nullifier') ||
        combined.includes('already deployed') ||
        combined.includes('already exists')
    );
}

/**
 * Create a new ECDSAR account, deploy it, and return credentials (no .env write).
 * Use with loadAccountFromCredentials on later runs to reuse the same account.
 */
export async function createAccountWithCredentials(
    wallet: EmbeddedWallet,
    options: { deployTimeoutMs?: number } = {}
): Promise<TestAccountCredentials> {
    const { deployTimeoutMs = 120_000 } = options;
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = Buffer.alloc(32, Fr.random().toBuffer());
    const accountManager = await wallet.createECDSARAccount(
        secretKey,
        salt,
        signingKey
    );

    const sponsoredFPC = await getSponsoredPFCContract();
    const deployMethod = await accountManager.getDeployMethod();
    const deployOpts = {
        from: AztecAddress.ZERO,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
        skipClassPublication: true,
        skipInstancePublication: true,
        wait: { timeout: deployTimeoutMs },
    };
    await deployMethod.send(deployOpts);

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
    options: { ensureDeployed?: boolean; deployTimeoutMs?: number } = {}
): Promise<AztecAddress> {
    const { ensureDeployed = true, deployTimeoutMs = 120_000 } = options;
    const accountAddress = AztecAddress.fromString(cred.address);
    if (await hasLocalAccount(wallet, accountAddress)) {
        if (!ensureDeployed) return accountAddress;
        const deployed = await aztecNode.getContract(accountAddress);
        if (deployed) return accountAddress;
    }

    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(cred.secretKey),
        Fr.fromString(cred.salt),
        Buffer.from(cred.signingKey, 'hex')
    );

    if (ensureDeployed) {
        await deployAccountIfNeeded(aztecNode, accountManager, deployTimeoutMs);
    }

    return accountManager.address;
}
