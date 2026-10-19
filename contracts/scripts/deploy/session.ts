/**
 * Node, wallet, deployer account, and fee context for scripts deploy.
 * Reads network/account from networks/<AZTEC_NETWORK>.env. Does not write
 * contract addresses into that file.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fq, Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { EmbeddedWallet } from '@aztec/wallets/embedded';

import { requireAccountConfigured } from '../runtime/account.ts';
import {
    getNetworkValue,
    loadNetworkEnv,
    resolvePxeStoreDir,
} from '../runtime/env.ts';
import { requireNetworkConfigured } from '../runtime/network.ts';
import {
    assertFeePaymentReady,
    type FeePaymentContext,
    prepareFeePayment,
} from '../utils/feePayment.ts';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.ts';
import {
    deriveSchnorrInitializerlessAddress,
    loadAccountFromCredentials,
    setupWallet,
} from '../utils/wallet.ts';

export type DeploySession = {
    network: string;
    nodeUrl: string;
    aztecNode: AztecNode;
    wallet: EmbeddedWallet;
    deployer: AztecAddress;
    feeCtx: FeePaymentContext;
    proverEnabled: boolean;
};

function fqFromHex(signingKeyHex: string): Fq {
    const hex = signingKeyHex.startsWith('0x')
        ? signingKeyHex.slice(2)
        : signingKeyHex;
    return Fq.fromBuffer(Buffer.from(hex, 'hex'));
}

function isLocalSandboxUrl(url: string): boolean {
    return (
        /^https?:\/\/localhost(:\d+)?$/i.test(url) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(url)
    );
}

export function getAztecNodeUrlFromNetwork(): string {
    const url = getNetworkValue('AZTEC_NODE_URL');
    if (!url) {
        throw new Error(
            'Missing AZTEC_NODE_URL in the active networks/*.env file.'
        );
    }
    return url;
}

export function getProverEnabledFromNetwork(): boolean {
    const url = getAztecNodeUrlFromNetwork();
    const explicit = getNetworkValue('PROVER_ENABLED');
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    return !isLocalSandboxUrl(url);
}

/**
 * Offline check: network file is complete, ACCOUNT_* are present, and
 * ACCOUNT_ADDRESS matches the keys. No node, PXE, or transaction.
 */
export async function assertAccountKeysMatch(): Promise<string> {
    requireNetworkConfigured();
    requireAccountConfigured();

    const salt = getNetworkValue('ACCOUNT_SALT');
    const secretKey = getNetworkValue('ACCOUNT_SECRET_KEY');
    const signingKey = getNetworkValue('ACCOUNT_SIGNING_KEY');
    const address = getNetworkValue('ACCOUNT_ADDRESS');
    if (!salt || !secretKey || !signingKey || !address) {
        throw new Error(
            'Account is not configured. Run pnpm account:generate first.'
        );
    }

    const derived = await deriveSchnorrInitializerlessAddress(
        Fr.fromString(secretKey),
        Fr.fromString(salt),
        fqFromHex(signingKey)
    );
    if (derived.toString() !== address) {
        throw new Error(
            'ACCOUNT_ADDRESS does not match derived keys; fix networks/<network>.env before deploying.\n' +
                `  Derived from keys: ${derived.toString()}\n` +
                `  ACCOUNT_ADDRESS:   ${address}`
        );
    }
    return address;
}

async function loadDeployer(
    wallet: EmbeddedWallet,
    aztecNode: AztecNode
): Promise<AztecAddress> {
    const address = await assertAccountKeysMatch();
    return loadAccountFromCredentials(
        wallet,
        {
            salt: getNetworkValue('ACCOUNT_SALT')!,
            secretKey: getNetworkValue('ACCOUNT_SECRET_KEY')!,
            signingKey: getNetworkValue('ACCOUNT_SIGNING_KEY')!,
            address,
        },
        aztecNode
    );
}

export async function openDeploySession(options: {
    commandHint: string;
    /** Disable the balance preflight for read-only simulate commands. */
    requireFeeJuice?: boolean;
}): Promise<DeploySession> {
    await assertAccountKeysMatch();

    const ctx = loadNetworkEnv();
    const nodeUrl = getAztecNodeUrlFromNetwork();
    const proverEnabled = getProverEnabledFromNetwork();
    const storeDir = resolvePxeStoreDir();

    console.log(`🌐 Aztec Node URL: ${nodeUrl}`);
    console.log(
        `⚡ Prover: ${proverEnabled ? 'ON (slow — each contract ~2–5 min)' : 'OFF (fast)'}\n`
    );
    if (proverEnabled) {
        console.warn(
            '⚠️  PROVER_ENABLED=true: deploy will be very slow. For fast local deploy, unset it or set PROVER_ENABLED=false.\n'
        );
    }

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createTolerantAztecNodeClient(nodeUrl);

    console.log('📝 Setting up wallet...');
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled,
        storeDir,
    });

    const feeCtx = await prepareFeePayment(wallet);

    console.log('👤 Loading deployer account...');
    const deployer = await loadDeployer(wallet, aztecNode);
    if (options.requireFeeJuice !== false) {
        await assertFeePaymentReady({
            feeCtx,
            aztecNode,
            accountAddress: deployer,
            commandHint: options.commandHint,
        });
    }
    console.log(`✅ Deployer: ${deployer.toString()}\n`);

    return {
        network: ctx.network,
        nodeUrl,
        aztecNode,
        wallet,
        deployer,
        feeCtx,
        proverEnabled,
    };
}
