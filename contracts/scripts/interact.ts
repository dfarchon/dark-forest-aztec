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
import { ConfigContract } from './artifacts/Config.ts';

// Load environment variables
dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.store');

// "simulate" = dry-run (no fee). "send" = broadcast tx (needs fee payment).
// const INTERACT_MODE: 'send' | 'simulate' =
//     process.env.INTERACT_MODE === 'send' ? 'send' : 'simulate';
const INTERACT_MODE: 'send' | 'simulate' = 'send';

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
        !process.env.CONFIG_CONTRACT_ADDRESS ||
        !process.env.CONFIG_DEPLOYER_ADDRESS ||
        !process.env.CONFIG_DEPLOYMENT_SALT
    ) {
        throw new Error(
            'Config Contract information not found in .env file. Please create a contract first.'
        );
    }

    if (
        !process.env.MAIN_CONTRACT_ADDRESS ||
        !process.env.MAIN_DEPLOYER_ADDRESS ||
        !process.env.MAIN_DEPLOYMENT_SALT
    ) {
        throw new Error(
            'Main Contract information not found in .env file. Please create a contract first.'
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
    console.log(`📋 Config Contract Address: ${process.env.CONFIG_CONTRACT_ADDRESS}`);
    console.log(`📋 Main Contract Address: ${process.env.MAIN_CONTRACT_ADDRESS}`);
    console.log(`📋 Account Address: ${process.env.ACCOUNT_ADDRESS}`);
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}\n`);

    try {
        // Setup Aztec node and wallet
        console.log('🔗 Connecting to Aztec node...');
        const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
        const wallet = await setupWallet(aztecNode);

        // Register the SponsoredFPC contract (for sponsored fee payments)
        console.log('📝 Registering SponsoredFPC contract...');
        const sponsoredPFC = await getSponsoredPFCContract();
        await wallet.registerContract(
            sponsoredPFC,
            SponsoredFPCContractArtifact
        );

        // Load account
        console.log('👤 Loading account from .env...');
        const accountAddress = await loadAccount(wallet);
        console.log(`✅ Account loaded: ${accountAddress.toString()}\n`);

        // Connect to the contract
        const configContractAddress = AztecAddress.fromString(
            process.env.CONFIG_CONTRACT_ADDRESS
        );

        console.log(
            `📄 Connecting to config contract at ${configContractAddress.toString()}...`
        );

        const mainContractAddress = AztecAddress.fromString(
            process.env.MAIN_CONTRACT_ADDRESS
        );
        console.log(
            `📄 Connecting to contract at ${mainContractAddress.toString()}...`
        );



        // Register the contract with the wallet
        try {
            try {
                const configContractInstance =
                    await getContractInstanceFromInstantiationParams(
                        ConfigContract.artifact,
                        {
                            constructorArgs: [
                                AztecAddress.fromString(
                                    process.env.CONFIG_DEPLOYER_ADDRESS
                                ),
                            ],
                            salt: Fr.fromString(process.env.CONFIG_DEPLOYMENT_SALT),
                            deployer: AztecAddress.fromString(
                                process.env.CONFIG_DEPLOYER_ADDRESS
                            ),
                        }
                    );
                await wallet.registerContract(
                    configContractInstance,
                    ConfigContract.artifact
                );
                console.log('✅ Contract registered with wallet');
            } catch (err) {
                // Contract might already be registered, continue
                console.log(
                    '⚠️  Contract registration skipped (may already be registered)'
                );
                console.log(err);
            }


            const configContractInstance =
                await getContractInstanceFromInstantiationParams(
                    MainContract.artifact,
                    {
                        constructorArgs: [
                            AztecAddress.fromString(
                                process.env.MAIN_DEPLOYER_ADDRESS
                            ),
                            AztecAddress.fromString(
                                process.env.CONFIG_CONTRACT_ADDRESS
                            )
                        ],
                        salt: Fr.fromString(process.env.MAIN_DEPLOYMENT_SALT),
                        deployer: AztecAddress.fromString(
                            process.env.MAIN_DEPLOYER_ADDRESS
                        ),
                    }
                );
            await wallet.registerContract(
                configContractInstance,
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

        const config = ConfigContract.at(configContractAddress, wallet);
        const main = MainContract.at(mainContractAddress, wallet);

        // Interact with the contract
        console.log('\n🔍 Interacting with contract...\n');



        console.log('📞 Calling config get_admin()...');
        const config_admin = await config.methods
            .get_admin_utility()
            .simulate({ from: accountAddress });

        console.log('📞 Calling main get_admin()...');
        const main_admin = await main.methods
            .get_admin_utility()
            .simulate({ from: accountAddress });

        console.log('\n\n\n--------------------------------');
        console.log(`✅ Config admin address: ${config_admin.toString()}`);
        console.log(`✅ Main admin address: ${main_admin.toString()}`);
        console.log(`✅ Account address: ${accountAddress.toString()}`);
        console.log('--------------------------------\n\n\n');


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
