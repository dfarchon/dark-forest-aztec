import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getContractInstanceFromInstantiationParams } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import { type AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { createStore } from '@aztec/kv-store/lmdb';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { TestWallet } from '@aztec/test-wallet/server';
import * as dotenv from 'dotenv';
import path from 'path';

import { MainContract } from './artifacts/Main.ts';

// Load environment variables
dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.store');

async function setupWallet(aztecNode: AztecNode) {
    // Don't remove store for interaction script, we want to keep the state
    const store = await createStore('pxe', {
        dataDirectory: PXE_STORE_DIR,
        dataStoreMapSizeKb: 1e6,
    });

    const config = getPXEConfig();
    config.dataDirectory = 'pxe';
    config.proverEnabled = PROVER_ENABLED;

    return await TestWallet.create(aztecNode, config, {
        store,
        useLogSuffix: true,
    });
}

async function getSponsoredPFCContract() {
    const instance = await getContractInstanceFromInstantiationParams(
        SponsoredFPCContractArtifact,
        {
            salt: new Fr(SPONSORED_FPC_SALT),
        }
    );

    return instance;
}

async function loadAccount(wallet: TestWallet): Promise<AztecAddress> {
    if (
        !process.env.ACCOUNT_SALT ||
        !process.env.ACCOUNT_SECRET_KEY ||
        !process.env.ACCOUNT_SIGNING_KEY
    ) {
        throw new Error(
            'Account information not found in .env file. Please create an account first.'
        );
    }

    const salt = Fr.fromString(process.env.ACCOUNT_SALT);
    const secretKey = Fr.fromString(process.env.ACCOUNT_SECRET_KEY);
    const signingKey = Buffer.from(process.env.ACCOUNT_SIGNING_KEY, 'hex');

    const accountManager = await wallet.createECDSARAccount(
        secretKey,
        salt,
        signingKey
    );

    return accountManager.address;
}

async function interactWithContract() {
    if (
        !process.env.CONTRACT_ADDRESS ||
        !process.env.DEPLOYER_ADDRESS ||
        !process.env.DEPLOYMENT_SALT
    ) {
        throw new Error(
            'Contract information not found in .env file. Please create a contract first.'
        );
    }

    if (
        !process.env.ACCOUNT_SALT ||
        !process.env.ACCOUNT_SECRET_KEY ||
        !process.env.ACCOUNT_SIGNING_KEY
    ) {
        throw new Error(
            'Account information not found in .env file. Please create an account first.'
        );
    }

    console.log('✅ All required environment variables are present');
    console.log(`📋 Contract Address: ${process.env.CONTRACT_ADDRESS}`);
    console.log(`📋 Account Address: ${process.env.ACCOUNT_ADDRESS}`);
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}\n`);

    try {
        // Setup Aztec node and wallet
        console.log('🔗 Connecting to Aztec node...');
        const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
        const wallet = await setupWallet(aztecNode);

        // Register the SponsoredFPC contract (for sponsored fee payments)
        console.log('📝 Registering SponsoredFPC contract...');
        await wallet.registerContract(
            await getSponsoredPFCContract(),
            SponsoredFPCContractArtifact
        );

        // Load account
        console.log('👤 Loading account from .env...');
        const accountAddress = await loadAccount(wallet);
        console.log(`✅ Account loaded: ${accountAddress.toString()}\n`);

        // Connect to the contract
        const contractAddress = AztecAddress.fromString(
            process.env.CONTRACT_ADDRESS
        );
        console.log(
            `📄 Connecting to contract at ${contractAddress.toString()}...`
        );

        // Register the contract with the wallet
        try {
            const contractInstance =
                await getContractInstanceFromInstantiationParams(
                    MainContract.artifact,
                    {
                        constructorArgs: [
                            AztecAddress.fromString(
                                process.env.DEPLOYER_ADDRESS
                            ),
                        ],
                        salt: Fr.fromString(process.env.DEPLOYMENT_SALT),
                        deployer: AztecAddress.fromString(
                            process.env.DEPLOYER_ADDRESS
                        ),
                    }
                );
            await wallet.registerContract(
                contractInstance,
                MainContract.artifact
            );
            console.log('✅ Contract registered with wallet');
        } catch (err) {
            // Contract might already be registered, continue
            console.log(
                '⚠️  Contract registration skipped (may already be registered)'
            );
            console.log(err);
        }

        const main = MainContract.at(contractAddress, wallet);

        // Interact with the contract
        console.log('\n🔍 Interacting with contract...\n');

        // Call get_admin
        try {
            console.log('📞 Calling get_admin()...');
            const admin = await main.methods
                .get_admin()
                .simulate({ from: accountAddress });

            console.log(`✅ Admin address: ${admin.toString()}`);
            console.log(`✅ Account address: ${accountAddress.toString()}`);
            console.log(
                `✅ Match: ${admin.toString() === accountAddress.toString() ? 'Yes' : 'No'}`
            );
        } catch (err) {
            console.error('❌ Failed to call get_admin():', err);
            throw err;
        }

        console.log('\n✅ Contract interaction completed successfully!');
    } catch (error) {
        console.error('\n❌ Error interacting with contract:', error);
        process.exit(1);
    }
}

// Run the interaction
interactWithContract()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

export { interactWithContract };
