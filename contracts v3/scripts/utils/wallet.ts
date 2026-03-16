import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { DeployAccountOptions } from '@aztec/aztec.js/wallet';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { createStore } from '@aztec/kv-store/lmdb';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { TestWallet } from '@aztec/test-wallet/server';
import fs from 'fs';
import path from 'path';

const DEFAULT_PXE_STORE_DIR = path.join(
    import.meta.dirname,
    '..',
    '..',
    '.store'
);
const DEFAULT_ENV_PATH = path.join(import.meta.dirname, '..', '..', '.env');

export type SetupWalletOptions = {
    /** If true, remove existing PXE store before creating wallet (default: false) */
    clearStore?: boolean;
    /** Enable prover (default: true). Callers (e.g. deploy script) should pass from env if needed. */
    proverEnabled?: boolean;
    /** Override PXE store directory (default: scripts/.store) */
    storeDir?: string;
};

/**
 * Create a TestWallet connected to the given Aztec node.
 * Other scripts can use this for deploy or interaction.
 */
export async function setupWallet(
    aztecNode: AztecNode,
    options: SetupWalletOptions = {}
): Promise<TestWallet> {
    const {
        clearStore = false,
        proverEnabled = true,
        storeDir = DEFAULT_PXE_STORE_DIR,
    } = options;

    if (clearStore && fs.existsSync(storeDir)) {
        fs.rmSync(storeDir, { recursive: true, force: true });
    }

    const store = await createStore('pxe', {
        dataDirectory: storeDir,
        dataStoreMapSizeKb: 1e6,
    });

    const config = getPXEConfig();
    config.dataDirectory = 'pxe';
    config.proverEnabled = proverEnabled;

    return await TestWallet.create(aztecNode, config, {
        store,
        useLogSuffix: true,
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
    wallet: TestWallet
): Promise<AztecAddress> {
    const salt = process.env.ACCOUNT_SALT;
    const secretKey = process.env.ACCOUNT_SECRET_KEY;
    const signingKeyHex = process.env.ACCOUNT_SIGNING_KEY;
    if (!salt || !secretKey || !signingKeyHex) {
        throw new Error(
            'Account not in .env. Set ACCOUNT_SALT, ACCOUNT_SECRET_KEY, ACCOUNT_SIGNING_KEY (or run deploy first).'
        );
    }
    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        Buffer.from(signingKeyHex, 'hex')
    );
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
    const config = [
        `ACCOUNT_SALT=${salt.toString()}`,
        `ACCOUNT_SECRET_KEY=${secretKey.toString()}`,
        `ACCOUNT_SIGNING_KEY=${signingKey.toString('hex')}`,
        `ACCOUNT_ADDRESS=${accountAddress.toString()}`,
    ].join('\n');
    fs.appendFileSync(envFilePath, '\n\n' + config);
}

/**
 * Create a new ECDSAR account, deploy it with sponsored fee, and optionally write to .env.
 * Caller must have already registered SponsoredFPC with the wallet.
 */
export async function createAccount(
    wallet: TestWallet,
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
    const deployOpts: DeployAccountOptions = {
        from: AztecAddress.ZERO,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
        skipClassPublication: true,
        skipInstancePublication: true,
    };
    await deployMethod.send(deployOpts).wait({ timeout: deployTimeoutMs });

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
    wallet: TestWallet,
    options: GetOrCreateAccountOptions = {}
): Promise<AztecAddress> {
    const hasAccount =
        process.env.ACCOUNT_SALT &&
        process.env.ACCOUNT_SECRET_KEY &&
        process.env.ACCOUNT_SIGNING_KEY;
    if (hasAccount) {
        return loadAccountFromEnv(wallet);
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
 * Create a new ECDSAR account, deploy it, and return credentials (no .env write).
 * Use with loadAccountFromCredentials on later runs to reuse the same account.
 */
export async function createAccountWithCredentials(
    wallet: TestWallet,
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
    const deployOpts: DeployAccountOptions = {
        from: AztecAddress.ZERO,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
        skipClassPublication: true,
        skipInstancePublication: true,
    };
    await deployMethod.send(deployOpts).wait({ timeout: deployTimeoutMs });

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
    wallet: TestWallet,
    cred: TestAccountCredentials
): Promise<AztecAddress> {
    const accountManager = await wallet.createECDSARAccount(
        Fr.fromString(cred.secretKey),
        Fr.fromString(cred.salt),
        Buffer.from(cred.signingKey, 'hex')
    );
    return accountManager.address;
}
