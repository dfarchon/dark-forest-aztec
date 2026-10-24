import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { SponsoredFpcContract } from '../artifacts/SponsoredFpc.ts';
import {
    createTolerantAztecNodeClient,
    deployOneContract,
    ensureAccountKeysOffline,
    exitIfAccountFundingRequired,
    getAztecNodeUrl,
    getContractsEnvFilePath,
    getProverEnabled,
    getWriteEnvFile,
    loadContractsEnv,
    prepareFeePayment,
    resolveDeployerAccount,
    setupWallet,
} from '../utils/index.ts';

type AddressEntry = { name: string; address: string };
type ClassEntry = { name: string; classId: string };
type SponsoredFpcConfig = {
    maxFeeWei: string;
    allowedTargets: AddressEntry[];
    allowedAccountClasses: ClassEntry[];
    requireUnpublishedAccounts: boolean;
};

loadContractsEnv();

function resolveEnv(value: string): string {
    if (!value.startsWith('env:')) return value;
    const key = value.slice(4);
    const resolved = process.env[key]?.trim();
    if (!resolved)
        throw new Error(`Missing required environment variable ${key}`);
    return resolved;
}

function loadConfig(): SponsoredFpcConfig {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const configArg = process.argv[2] ?? 'fpc/config/local.json';
    const configPath = path.resolve(here, '../..', configArg);
    return JSON.parse(
        fs.readFileSync(configPath, 'utf8')
    ) as SponsoredFpcConfig;
}

async function main() {
    await ensureAccountKeysOffline({
        commandHint: 'pnpm deploy-sponsored-fpc',
    });
    const node = createTolerantAztecNodeClient(getAztecNodeUrl());
    const wallet = await setupWallet(node, {
        // The main game deployment opens the default PXE store immediately
        // before this script. Use an isolated store so a stale/cancelled AVM
        // simulation there cannot block Sponsored FPC deployment.
        storeDir: path.resolve(
            import.meta.dirname,
            '../../.store-sponsored-fpc'
        ),
        clearStore: true,
        proverEnabled: getProverEnabled(),
    });
    const feeCtx = await prepareFeePayment(wallet);
    const deployer = await resolveDeployerAccount(wallet, node, {
        mode: 'getOrCreate',
        deployTimeoutMs: 120_000,
        feeCtx,
        commandHint: 'pnpm deploy-sponsored-fpc',
    });
    const config = loadConfig();
    const zero = AztecAddress.ZERO;
    const targets = config.allowedTargets.map((entry) =>
        AztecAddress.fromStringUnsafe(resolveEnv(entry.address))
    );
    const classes = config.allowedAccountClasses.map((entry) =>
        Fr.fromString(resolveEnv(entry.classId))
    );
    if (targets.length > 12 || classes.length > 4) {
        throw new Error(
            'SponsoredFpc supports at most 12 targets and 4 account classes'
        );
    }
    while (targets.length < 12) targets.push(zero);
    while (classes.length < 4) classes.push(Fr.ZERO);

    const result = await deployOneContract(
        wallet,
        deployer,
        {
            name: 'SponsoredFpc',
            envPrefix: 'SPONSORED_FPC',
            artifact: SponsoredFpcContract.artifact,
            getConstructorArgs: () =>
                [
                    BigInt(config.maxFeeWei),
                    targets,
                    classes,
                    config.requireUnpublishedAccounts,
                ] as never,
        },
        { deployer, addresses: {} },
        {
            writeEnv: getWriteEnvFile(),
            envFilePath: getContractsEnvFilePath(),
            timeoutMs: 120_000,
            feeCtx,
        }
    );
    console.log(`SPONSORED_FPC_CONTRACT_ADDRESS=${result.contractAddress}`);
}

main().catch((error) => {
    if (exitIfAccountFundingRequired(error)) return;
    console.error(error);
    process.exit(1);
});
