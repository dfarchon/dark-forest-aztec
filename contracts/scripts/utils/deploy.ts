/**
 * Contract deployment helpers.
 * Fee payment follows `FEE_PAYMENT_MODE` / {@link FeePaymentContext}:
 * - sponsored: SponsoredFeePaymentMethod (caller must register SponsoredFPC)
 * - account: omit fee.paymentMethod (SDK charges deployer FeeJuice)
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    Contract,
    DeployMethod,
    getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import { PublicKeys } from '@aztec/aztec.js/keys';
import type { Wallet } from '@aztec/aztec.js/wallet';
import type { ContractArtifact } from '@aztec/stdlib/abi';
import { getDefaultInitializer } from '@aztec/stdlib/abi';
import fs from 'fs';

import { getContractsEnvFilePath, getWriteEnvFile } from './env.ts';
import {
    buildFeeSendFields,
    type FeePaymentContext,
    getFeePaymentMode,
    getSponsoredPFCContract,
    type SponsoredFpcInstance,
} from './feePayment.ts';

export type { SponsoredFpcInstance };

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
    /**
     * Fee payment context. Prefer passing the result of `prepareFeePayment(wallet)`.
     * Legacy: `sponsoredFpc` alone still works for sponsored mode.
     */
    feeCtx?: FeePaymentContext;
    /** @deprecated Prefer `feeCtx`. SponsoredFPC instance for gas/fees. */
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

async function resolveDeployFeeCtx(options: {
    feeCtx?: FeePaymentContext;
    sponsoredFpc?: SponsoredFpcInstance;
}): Promise<FeePaymentContext> {
    if (options.feeCtx) {
        if (
            options.feeCtx.mode === 'sponsored' &&
            !options.feeCtx.sponsoredFpc
        ) {
            return {
                mode: 'sponsored',
                sponsoredFpc:
                    options.sponsoredFpc ?? (await getSponsoredPFCContract()),
            };
        }
        return options.feeCtx;
    }
    if (options.sponsoredFpc) {
        return { mode: 'sponsored', sponsoredFpc: options.sponsoredFpc };
    }
    const mode = getFeePaymentMode();
    if (mode === 'sponsored') {
        return {
            mode: 'sponsored',
            sponsoredFpc: await getSponsoredPFCContract(),
        };
    }
    return { mode: 'account' };
}

/**
 * Deploy a single contract and optionally append its deployment info to .env.
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
        feeCtx?: FeePaymentContext;
        /** @deprecated Prefer `feeCtx`. */
        sponsoredFpc?: SponsoredFpcInstance;
    } = {}
): Promise<DeploymentResult> {
    const {
        writeEnv = true,
        envFilePath = getContractsEnvFilePath(),
        timeoutMs = 120_000,
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

    const feeCtx = await resolveDeployFeeCtx(options);
    const deployMethod = DeployMethod.create(
        wallet,
        {
            artifact: config.artifact,
            postDeployCtor: (instance, w) =>
                Contract.at(instance.address, config.artifact, w),
            args: constructorArgs,
            constructorNameOrArtifact: initializer?.name,
        },
        {
            salt,
            deployer,
            publicKeys: contract.publicKeys,
        }
    );

    await deployMethod.send({
        from: deployer,
        ...buildFeeSendFields(feeCtx),
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
        feeCtx,
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
            feeCtx,
            sponsoredFpc,
        });
        addresses[config.name] = AztecAddress.fromStringUnsafe(
            result.contractAddress
        );
        results[config.name] = result;

        const stepMs = Date.now() - stepStart;
        const totalElapsed = scriptStartTime ? Date.now() - scriptStartTime : 0;
        onDeployComplete?.(config.name, i, total, stepMs, totalElapsed);
    }

    return results;
}
