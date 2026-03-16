/**
 * Standalone deploy script for the TestOracle contract.
 *
 * TestOracle is an independent contract (no storage wiring needed).
 * It only needs a deployer account and writes its address to .env as
 * TEST_ORACLE_CONTRACT_ADDRESS.
 *
 * Usage (from contracts/ directory):
 *   pnpm exec tsx scripts/deploy-test-oracle.ts
 *   node --experimental-transform-types scripts/deploy-test-oracle.ts
 *
 * Prerequisites:
 *   - Aztec sandbox running (AZTEC_NODE_URL, default http://localhost:8080)
 *   - contracts built: pnpm build-contracts  (produces target/test_oracle-TestOracle.ts)
 */
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import path from 'path';

import {
    type ContractDeployConfig,
    deployOneContract,
    getOrCreateAccount,
    getSponsoredPFCContract,
    setupWallet,
} from './utils/index.ts';

dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'true';
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const ENV_PATH = path.join(scriptDir, '..', '.env');
const ENV_KEY = 'TEST_ORACLE_CONTRACT_ADDRESS';

async function main() {
    console.log('Aztec Node URL:', AZTEC_NODE_URL);

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
    });

    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const deployer = await getOrCreateAccount(wallet, aztecNode);
    console.log('Deployer:', deployer.toString());

    console.log('\nLoading TestOracle artifact...');
    const mod = await import('./artifacts/TestOracle.ts');
    const TestOracleContract =
        mod.TestOracleContract ?? mod.TestOracle ?? mod.default;
    if (!TestOracleContract?.artifact) {
        throw new Error(
            'TestOracle artifact not found. Run "pnpm build-contracts" first.'
        );
    }

    const config: ContractDeployConfig = {
        name: 'TestOracle',
        envPrefix: 'TEST_ORACLE',
        artifact: TestOracleContract.artifact,
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    };

    console.log('Deploying TestOracle (sponsored fees via SponsoredFPC)...');
    const result = await deployOneContract(
        wallet,
        deployer,
        config,
        { deployer, addresses: {} },
        {
            envFilePath: ENV_PATH,
            writeEnv: true,
            sponsoredFpc: sponsoredFPC,
        }
    );

    const address = result.contractAddress;
    console.log('\nTestOracle deployed at:', address);
    console.log(
        `Written ${ENV_KEY}_CONTRACT_ADDRESS and related vars to .env at ${ENV_PATH}`
    );

    console.log('\nDone. Run test-oracle.ts to test it.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
