import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { Contract, type ContractBase } from '@aztec-labs/aztec.js/contracts';
import type { AztecNode } from '@aztec-labs/aztec.js/node';
import type { ContractArtifact } from '@aztec-labs/stdlib/abi';
import type { EmbeddedWallet } from '@aztec-labs/wallets/embedded';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import {
    ARTIFACTS_DIR,
    DEPLOY_DEFINITIONS,
    type DeployDefinition,
} from '../deploy/definitions.ts';
import {
    type DeployManifest,
    relativeManifestPath,
} from '../deploy/manifest.ts';
import {
    addressesFromManifest,
    assertContractsDeployed,
    resolveCompletedDeployment,
} from '../deploy/onchain.ts';
import {
    assertAccountKeysMatch,
    getAztecNodeUrlFromNetwork,
    getProverEnabledFromNetwork,
} from '../deploy/session.ts';
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
import { loadAccountFromCredentials, setupWallet } from '../utils/wallet.ts';

export type AdminTarget = {
    network: string;
    nodeUrl: string;
    envFile: string;
    deploymentPath: string;
    aztecNode: AztecNode;
    manifest: DeployManifest;
    addresses: Record<string, string>;
};

export type AdminWallet = {
    wallet: EmbeddedWallet;
    admin: AztecAddress;
    feeCtx?: FeePaymentContext;
};

type ContractWrapper = {
    definition: DeployDefinition;
    artifact: ContractArtifact;
};

function pickAddresses(
    addresses: Record<string, string>,
    names: string[]
): Record<string, string> {
    const picked: Record<string, string> = {};
    for (const name of names) {
        const address = addresses[name];
        if (!address) {
            throw new Error(`Missing ${name} in deploy manifest.`);
        }
        picked[name] = address;
    }
    return picked;
}

export async function resolveAdminTarget(options?: {
    id?: string;
    contracts?: string[];
}): Promise<AdminTarget> {
    requireNetworkConfigured();
    const ctx = loadNetworkEnv();
    const nodeUrl = getAztecNodeUrlFromNetwork();
    const manifest = resolveCompletedDeployment(ctx.network, options?.id);
    const addresses = addressesFromManifest(manifest);
    const aztecNode = createTolerantAztecNodeClient(nodeUrl);
    if (options?.contracts && options.contracts.length > 0) {
        await assertContractsDeployed(
            aztecNode,
            pickAddresses(addresses, options.contracts)
        );
    }
    return {
        network: ctx.network,
        nodeUrl,
        envFile: path.relative(process.cwd(), ctx.networkFilePath),
        deploymentPath: relativeManifestPath(ctx.network, manifest.id),
        aztecNode,
        manifest,
        addresses,
    };
}

async function loadContractWrapper(name: string): Promise<ContractWrapper> {
    const definition = DEPLOY_DEFINITIONS.find((entry) => entry.name === name);
    if (!definition) throw new Error(`Unknown contract ${name}.`);
    const artifactPath = path.join(ARTIFACTS_DIR, definition.artifactFile);
    if (!fs.existsSync(artifactPath)) {
        throw new Error(
            `Artifact not found: ${artifactPath}. Run "pnpm build:contracts" first.`
        );
    }
    const mod = await import(
        /* @vite-ignore */ pathToFileURL(artifactPath).href
    );
    const wrapper =
        mod[definition.exportName] ?? mod[definition.name] ?? mod.default;
    if (!wrapper?.artifact) {
        throw new Error(
            `Artifact not found: ${definition.artifactFile} (tried ${definition.exportName}, ${definition.name}, default). Run "pnpm build:contracts" first.`
        );
    }
    return {
        definition,
        artifact: wrapper.artifact as ContractArtifact,
    };
}

export async function connectContract(
    wallet: EmbeddedWallet,
    addresses: Record<string, string>,
    name: string
): Promise<ContractBase> {
    const wrapper = await loadContractWrapper(name);
    const address = addresses[name];
    if (!address) throw new Error(`Missing ${name} in deploy manifest.`);
    return Contract.at(
        AztecAddress.fromStringUnsafe(address),
        wrapper.artifact,
        wallet
    );
}

export async function openAdminWallet(
    target: AdminTarget,
    options?: { commandHint: string }
): Promise<AdminWallet> {
    const address = await assertAccountKeysMatch();
    const wallet = await setupWallet(target.aztecNode, {
        clearStore: false,
        proverEnabled: options ? getProverEnabledFromNetwork() : false,
        storeDir: resolvePxeStoreDir(),
    });
    const admin = await loadAccountFromCredentials(
        wallet,
        {
            salt: getNetworkValue('ACCOUNT_SALT')!,
            secretKey: getNetworkValue('ACCOUNT_SECRET_KEY')!,
            signingKey: getNetworkValue('ACCOUNT_SIGNING_KEY')!,
            address,
        },
        target.aztecNode
    );
    if (!options) return { wallet, admin };

    const feeCtx = await prepareFeePayment(wallet);
    await assertFeePaymentReady({
        feeCtx,
        aztecNode: target.aztecNode,
        accountAddress: admin,
        commandHint: options.commandHint,
    });
    return { wallet, admin, feeCtx };
}
