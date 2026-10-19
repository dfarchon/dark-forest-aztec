/**
 * Wallet helpers for scripts.
 * Reads nothing from the old contracts env file.
 */
import { getSchnorrInitializerlessAccountContractAddress } from '@aztec/accounts/schnorr';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fq, Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import fs from 'fs';
import path from 'path';

const FINGERPRINT_FILENAME = '.network-fingerprint';

function fqFromHex(signingKeyHex: string): Fq {
    const hex = signingKeyHex.startsWith('0x')
        ? signingKeyHex.slice(2)
        : signingKeyHex;
    return Fq.fromBuffer(Buffer.from(hex, 'hex'));
}

/**
 * Pure offline deterministic address derivation for a Schnorr initializerless account.
 * No PXE, no Aztec RPC, no transactions.
 * Argument order matches `wallet.createSchnorrInitializerlessAccount(secret, salt, signingKey)`.
 */
export async function deriveSchnorrInitializerlessAddress(
    secretKey: Fr,
    salt: Fr,
    signingKey: Fq
): Promise<AztecAddress> {
    return getSchnorrInitializerlessAccountContractAddress(
        signingKey,
        salt,
        secretKey
    );
}

/**
 * Identify the Aztec chain this node is following.
 * `l1ChainId` is the base Ethereum chain; `rollupAddress` is the L1 rollup
 * contract that uniquely names this L2 (available at genesis).
 */
async function getNetworkFingerprint(node: AztecNode): Promise<string> {
    const info = await node.getNodeInfo();
    const rollup = info.l1ContractAddresses.rollupAddress.toString();
    return `${info.l1ChainId}:${rollup}`;
}

export type SetupWalletOptions = {
    /** If true, remove existing PXE store before creating wallet (default: false) */
    clearStore?: boolean;
    /** Enable prover. Callers should pass the network setting. */
    proverEnabled: boolean;
    /** PXE/wallet cache directory from PXE_STORE_DIR. */
    storeDir: string;
};

/**
 * Create an EmbeddedWallet connected to the given Aztec node.
 * Detects network changes via L1 chain id + rollup address and clears the stale PXE store.
 */
export async function setupWallet(
    aztecNode: AztecNode,
    options: SetupWalletOptions
): Promise<EmbeddedWallet> {
    const { clearStore = false, proverEnabled, storeDir } = options;

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

export async function hasLocalAccount(
    wallet: EmbeddedWallet,
    address: AztecAddress
): Promise<boolean> {
    const accounts = await wallet.getAccounts();
    return accounts.some((account) => account.item.equals(address));
}

/** Credentials for a Schnorr initializerless account. */
export type TestAccountCredentials = {
    salt: string;
    secretKey: string;
    signingKey: string;
    address: string;
};

/**
 * Recreate a Schnorr initializerless account in the wallet from saved credentials.
 * No deployment transaction is required.
 */
export async function loadAccountFromCredentials(
    wallet: EmbeddedWallet,
    cred: TestAccountCredentials,
    aztecNode: AztecNode
): Promise<AztecAddress> {
    void aztecNode;
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
