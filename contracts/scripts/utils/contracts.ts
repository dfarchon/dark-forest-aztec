/**
 * Helpers to get contract instances after deploy (from deployment results or .env)
 * so you can run post-deploy interactions (e.g. Config set_default_*, Admin set_*_storage_address).
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    type ContractBase,
    getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import type { Wallet } from '@aztec/aztec.js/wallet';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { getOptionalEnv } from './env.ts';

export type ContractSpec = {
    name: string;
    modulePath: string;
    exportName: string;
};

/** Scripts directory (parent of utils); modulePath in specs is relative to this. */
const SCRIPTS_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
);

/**
 * Load contract wrapper modules and return instances for the given addresses.
 * Use this after deploy (with results) or when reading addresses from .env.
 * modulePath in specs is relative to the scripts directory (e.g. './artifacts/Config.ts' from `scripts/`).
 *
 * @param wallet - Wallet to use for interactions
 * @param addresses - Map of contract name -> address string (e.g. { Config: "0x...", Admin: "0x..." })
 * @param specs - Which contracts to load (name, modulePath, exportName) — same shape as deploy ARTIFACT_SPECS
 * @returns Record of name -> contract instance (e.g. contracts.Config.methods.set_default_world_config().send(...))
 */
export async function getContractInstances(
    wallet: Wallet,
    addresses: Record<string, string>,
    specs: ContractSpec[]
): Promise<Record<string, ContractBase>> {
    const out: Record<string, ContractBase> = {};
    for (const spec of specs) {
        const addr = addresses[spec.name];
        if (!addr) continue;
        const resolvedPath = path.resolve(SCRIPTS_DIR, spec.modulePath);
        const moduleUrl = pathToFileURL(resolvedPath).href;
        const mod = await import(/* @vite-ignore */ moduleUrl);
        const ContractClass =
            mod[spec.exportName] ?? mod[spec.name] ?? mod.default;
        if (!ContractClass?.at) {
            throw new Error(
                `Contract ${spec.name}: no .at() on export ${spec.exportName} from ${spec.modulePath}`
            );
        }
        out[spec.name] = ContractClass.at(
            AztecAddress.fromStringUnsafe(addr),
            wallet
        ) as ContractBase;
    }
    return out;
}

/**
 * Build address map from deploy results (so you can pass to getContractInstances).
 */
export function addressesFromDeployResults(
    results: Record<string, { contractAddress: string }>
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(results).map(([name, r]) => [name, r.contractAddress])
    );
}

/**
 * Register contract instances with the wallet (PXE) so simulate() can run their code.
 * Uses *_DEPLOYER_ADDRESS and *_DEPLOYMENT_SALT from env (same prefix as *_CONTRACT_ADDRESS).
 * Constructor args are assumed to be [admin] for all contracts.
 */
export async function registerContractsWithWallet(
    wallet: Wallet,
    admin: AztecAddress,
    specs: ContractSpec[],
    envKeys: Array<[string, string]>
): Promise<void> {
    const addressKeyBySpec = Object.fromEntries(envKeys);
    for (const spec of specs) {
        const addressKey = addressKeyBySpec[spec.name];
        if (!addressKey) continue;
        const deployerKey = addressKey.replace(
            '_CONTRACT_ADDRESS',
            '_DEPLOYER_ADDRESS'
        );
        const saltKey = addressKey.replace(
            '_CONTRACT_ADDRESS',
            '_DEPLOYMENT_SALT'
        );
        const deployerStr = getOptionalEnv(deployerKey);
        const saltStr = getOptionalEnv(saltKey);
        if (!deployerStr || !saltStr) continue;
        const resolvedPath = path.resolve(SCRIPTS_DIR, spec.modulePath);
        const moduleUrl = pathToFileURL(resolvedPath).href;
        const mod = await import(/* @vite-ignore */ moduleUrl);
        const ContractClass =
            mod[spec.exportName] ?? mod[spec.name] ?? mod.default;
        const artifact =
            (ContractClass as { artifact?: unknown }).artifact ??
            mod[spec.exportName + 'Artifact'] ??
            mod[spec.exportName.replace('Contract', 'ContractArtifact')];
        if (!artifact) continue;
        try {
            const instance = await getContractInstanceFromInstantiationParams(
                artifact as import('@aztec/stdlib/abi').ContractArtifact,
                {
                    deployer: AztecAddress.fromStringUnsafe(deployerStr),
                    salt: Fr.fromString(saltStr),
                    constructorArgs: [admin],
                }
            );
            await wallet.registerContract(
                instance,
                artifact as import('@aztec/stdlib/abi').ContractArtifact
            );
        } catch (err) {
            console.warn(
                `[registerContractsWithWallet] Skip ${spec.name}:`,
                err instanceof Error ? err.message : err
            );
        }
    }
}
