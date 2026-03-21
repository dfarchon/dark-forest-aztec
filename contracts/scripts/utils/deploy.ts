/**
 * Contract deployment helpers (mirrors contracts-v1 deploy flow).
 * All deploys use the SponsoredFPC contract for gas/fees: fee is paid via
 * SponsoredFeePaymentMethod(sponsoredFpc.address). Caller must register
 * SponsoredFPC with the wallet before calling deploy.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    Contract,
    DeployMethod,
    getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import { PublicKeys } from '@aztec/aztec.js/keys';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { ContractArtifact } from '@aztec/stdlib/abi';
import { getDefaultInitializer } from '@aztec/stdlib/abi';
import fs from 'fs';

import { getContractsEnvFilePath, getWriteEnvFile } from './env.ts';
import { getSponsoredPFCContract } from './wallet.ts';

/** SponsoredFPC instance (has .address). Pass from getSponsoredPFCContract() to reuse. */
export type SponsoredFpcInstance = { address: AztecAddress };

/** Context passed to getConstructorArgs: deployer + addresses of already-deployed contracts (by config name). */
export type DeployContext = {
    deployer: AztecAddress;
    addresses: Record<string, AztecAddress>;
};

/** Result of deploying one contract. */
export type DeploymentResult = {
    contractAddress: string;
    deployerAddress: string;
    deploymentSalt: string;
};

/**
 * Config for one contract to deploy. Order in the array defines deployment order;
 * later configs can reference earlier ones in getConstructorArgs via ctx.addresses[name].
 */
export type ContractDeployConfig = {
    /** Unique key to reference this contract in ctx.addresses (e.g. "Config", "Main"). */
    name: string;
    /** Env key prefix for writing to .env (e.g. "CONFIG" -> CONFIG_CONTRACT_ADDRESS, CONFIG_DEPLOYMENT_SALT). */
    envPrefix: string;
    /** Compiled contract artifact (e.g. ConfigContract.artifact). */
    artifact: ContractArtifact;
    /** Build constructor args from deployer and any previously deployed contract addresses. */
    getConstructorArgs: (ctx: DeployContext) => Fr[] | Promise<Fr[]>;
};

export type DeployContractsOptions = {
    /** Where to append deployment env vars (default: contracts/.env). */
    envFilePath?: string;
    /** If false, do not write to .env (default: true). */
    writeEnv?: boolean;
    /** Timeout per deploy in ms (default: 120_000). */
    timeoutMs?: number;
    /** SponsoredFPC instance for gas/fees. If set, used for every deploy; else getSponsoredPFCContract() per contract. */
    sponsoredFpc?: SponsoredFpcInstance;
    /** Script start time (Date.now()) for elapsed-time stats. */
    scriptStartTime?: number;
    /** Called before each contract deploy (name, index, total). */
    onDeploy?: (name: string, index: number, total: number) => void;
    /** Called after each contract deploy (name, index, total, stepMs, totalElapsed). */
    onDeployComplete?: (
        name: string,
        index: number,
        total: number,
        stepMs: number,
        totalElapsed: number
    ) => void;
};

function appendDeploymentToEnv(
    envPrefix: string,
    result: DeploymentResult,
    envFilePath: string
) {
    const block = [
        `${envPrefix}_CONTRACT_ADDRESS=${result.contractAddress}`,
        `${envPrefix}_DEPLOYER_ADDRESS=${result.deployerAddress}`,
        `${envPrefix}_DEPLOYMENT_SALT=${result.deploymentSalt}`,
    ].join('\n');
    fs.appendFileSync(envFilePath, '\n\n' + block);
}

/**
 * Deploy a single contract and optionally append its deployment info to .env.
 * Uses SponsoredFPC for gas (SponsoredFeePaymentMethod). Caller must have registered
 * SponsoredFPC with the wallet before calling.
 * @param ctx - DeployContext (deployer + addresses of already-deployed contracts) for getConstructorArgs.
 */
export async function deployOneContract(
    wallet: Wallet,
    deployer: AztecAddress,
    config: ContractDeployConfig,
    ctx: DeployContext,
    options: {
        writeEnv?: boolean;
        envFilePath?: string;
        timeoutMs?: number;
        /** SponsoredFPC instance for gas. If omitted, getSponsoredPFCContract() is called. */
        sponsoredFpc?: SponsoredFpcInstance;
    } = {}
): Promise<DeploymentResult> {
    const {
        writeEnv = true,
        envFilePath = getContractsEnvFilePath(),
        timeoutMs = 120_000,
        sponsoredFpc: sponsoredFpcOpt,
    } = options;

    const salt = Fr.random();
    const initializer = getDefaultInitializer(config.artifact);
    const constructorArgs = await config.getConstructorArgs(ctx);

    const contract = await getContractInstanceFromInstantiationParams(
        config.artifact,
        {
            publicKeys: PublicKeys.default(),
            constructorArtifact: initializer,
            constructorArgs,
            deployer,
            salt,
        }
    );

    const sponsoredFPC = sponsoredFpcOpt ?? (await getSponsoredPFCContract());
    const deployMethod = new DeployMethod(
        contract.publicKeys,
        wallet,
        config.artifact,
        (instance, w) => Contract.at(instance.address, config.artifact, w),
        constructorArgs,
        initializer?.name
    );

    await deployMethod.send({
        from: deployer,
        contractAddressSalt: salt,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
        wait: { timeout: timeoutMs },
    });

    await wallet.registerContract(contract, config.artifact);

    const result: DeploymentResult = {
        contractAddress: contract.address.toString(),
        deployerAddress: deployer.toString(),
        deploymentSalt: salt.toString(),
    };

    if (writeEnv) {
        appendDeploymentToEnv(config.envPrefix, result, envFilePath);
    }

    return result;
}

/**
 * Deploy multiple contracts in config order. Each contract's getConstructorArgs receives
 * a context with deployer and addresses of all previously deployed contracts (by config.name).
 * Writes each deployment to .env using config.envPrefix.
 *
 * @example
 * const configs: ContractDeployConfig[] = [
 *   {
 *     name: 'Config',
 *     envPrefix: 'CONFIG',
 *     artifact: ConfigContract.artifact,
 *     getConstructorArgs: (ctx) => [ctx.deployer.toField()],
 *   },
 *   {
 *     name: 'Main',
 *     envPrefix: 'MAIN',
 *     artifact: MainContract.artifact,
 *     getConstructorArgs: (ctx) => [ctx.deployer.toField(), ctx.addresses.Config!.toField()],
 *   },
 * ];
 * const results = await deployContracts(wallet, deployer, configs);
 */
export async function deployContracts(
    wallet: Wallet,
    deployer: AztecAddress,
    configs: ContractDeployConfig[],
    options: DeployContractsOptions = {}
): Promise<Record<string, DeploymentResult>> {
    const {
        envFilePath = getContractsEnvFilePath(),
        writeEnv = getWriteEnvFile(),
        timeoutMs = 120_000,
        sponsoredFpc,
        scriptStartTime,
        onDeploy,
        onDeployComplete,
    } = options;

    const addresses: Record<string, AztecAddress> = {};
    const results: Record<string, DeploymentResult> = {};
    const total = configs.length;

    for (let i = 0; i < configs.length; i++) {
        const config = configs[i]!;
        onDeploy?.(config.name, i, total);
        const stepStart = Date.now();
        const ctx: DeployContext = { deployer, addresses: { ...addresses } };
        const result = await deployOneContract(wallet, deployer, config, ctx, {
            writeEnv,
            envFilePath,
            timeoutMs,
            sponsoredFpc,
        });
        addresses[config.name] = AztecAddress.fromString(
            result.contractAddress
        );
        results[config.name] = result;

        const stepMs = Date.now() - stepStart;
        const totalElapsed = scriptStartTime ? Date.now() - scriptStartTime : 0;
        onDeployComplete?.(config.name, i, total, stepMs, totalElapsed);
    }

    return results;
}
