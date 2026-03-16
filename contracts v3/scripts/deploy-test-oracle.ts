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
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    getOrCreateAccount,
    getSponsoredPFCContract,
    setupWallet,
} from './utils/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED !== 'false';
const ENV_PATH = path.join(__dirname, '..', '.env');
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

    const deployer = await getOrCreateAccount(wallet);
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

    console.log('Deploying TestOracle...');
    const sendOpts = {
        from: deployer,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

    const contract = await TestOracleContract.deploy(wallet)
        .send(sendOpts)
        .deployed();

    const address = contract.address.toString();
    console.log('\nTestOracle deployed at:', address);

    // Write/update .env
    let envContent = fs.existsSync(ENV_PATH)
        ? fs.readFileSync(ENV_PATH, 'utf-8')
        : '';

    if (envContent.includes(`${ENV_KEY}=`)) {
        envContent = envContent.replace(
            new RegExp(`^${ENV_KEY}=.*$`, 'm'),
            `${ENV_KEY}=${address}`
        );
    } else {
        envContent = envContent.trimEnd() + `\n${ENV_KEY}=${address}\n`;
    }
    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
    console.log(`Written ${ENV_KEY}=${address} to .env`);

    console.log('\nDone. Run test-oracle.ts to test it.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
