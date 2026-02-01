import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    DeployMethod,
    getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts';
import { getDecodedPublicEvents } from './utils/events.ts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import { PublicKeys } from '@aztec/aztec.js/keys';
import { type AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import type { DeployAccountOptions, Wallet } from '@aztec/aztec.js/wallet';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { createStore } from '@aztec/kv-store/lmdb';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { getDefaultInitializer } from '@aztec/stdlib/abi';
import { TestWallet } from '@aztec/test-wallet/server';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

import { SilverContract } from './artifacts/Silver.ts';
import { ConfigContract } from './artifacts/Config.ts';

// Load environment variables
dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;
const WRITE_ENV_FILE = process.env.WRITE_ENV_FILE === 'false' ? false : true;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.store');

async function setupWallet(aztecNode: AztecNode) {
    fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });

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

// Append account configuration to .env file
function appendAccountConfigToEnv(
    salt: Fr,
    secretKey: Fr,
    signingKey: Buffer,
    accountAddress: AztecAddress
) {
    const envFilePath = path.join(import.meta.dirname, '../.env');
    const config = [
        `ACCOUNT_SALT=${salt.toString()}`,
        `ACCOUNT_SECRET_KEY=${secretKey.toString()}`,
        `ACCOUNT_SIGNING_KEY=${signingKey.toString('hex')}`,
        `ACCOUNT_ADDRESS=${accountAddress.toString()}`,
    ].join('\n');

    fs.appendFileSync(envFilePath, '\n\n\n' + config);
}

async function loadAccount(wallet: TestWallet): Promise<AztecAddress> {
    // Load account information from .env file
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

async function createAccount(wallet: TestWallet) {
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKey = Buffer.alloc(32, Fr.random().toBuffer());
    const accountManager = await wallet.createECDSARAccount(
        secretKey,
        salt,
        signingKey
    );

    const deployMethod = await accountManager.getDeployMethod();
    const sponsoredPFCContract = await getSponsoredPFCContract();
    const deployOpts: DeployAccountOptions = {
        from: AztecAddress.ZERO,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(
                sponsoredPFCContract.address
            ),
        },
        skipClassPublication: true,
        skipInstancePublication: true,
    };
    await deployMethod.send(deployOpts).wait({ timeout: 120 });

    // Save account information to .env file after successful deployment
    if (WRITE_ENV_FILE) {
        appendAccountConfigToEnv(
            salt,
            secretKey,
            signingKey,
            accountManager.address
        );
    }

    return accountManager.address;
}

async function deployConfigContract(wallet: Wallet, deployer: AztecAddress) {
    const salt = Fr.random();
    const contract = await getContractInstanceFromInstantiationParams(
        ConfigContract.artifact,
        {
            publicKeys: PublicKeys.default(),
            constructorArtifact: getDefaultInitializer(ConfigContract.artifact),
            constructorArgs: [deployer.toField()],
            deployer: deployer,
            salt,
        }
    );

    const deployMethod = new DeployMethod(
        contract.publicKeys,
        wallet,
        ConfigContract.artifact,
        (instance, wallet) => ConfigContract.at(instance.address, wallet),
        [deployer.toField()],
        getDefaultInitializer(ConfigContract.artifact)?.name
    );

    const sponsoredPFCContract = await getSponsoredPFCContract();

    await deployMethod
        .send({
            from: deployer,
            contractAddressSalt: salt,
            fee: {
                paymentMethod: new SponsoredFeePaymentMethod(
                    sponsoredPFCContract.address
                ),
            },
        })
        .wait({ timeout: 120 });
    await wallet.registerContract(contract, ConfigContract.artifact);

    return {
        contractAddress: contract.address.toString(),
        deployerAddress: deployer.toString(),
        deploymentSalt: salt.toString(),
    };
}

async function deploySilverContract(wallet: Wallet, deployer: AztecAddress) {
    const salt = Fr.random();
    const contract = await getContractInstanceFromInstantiationParams(
        SilverContract.artifact,
        {
            publicKeys: PublicKeys.default(),
            constructorArtifact: getDefaultInitializer(SilverContract.artifact),
            constructorArgs: [],
            deployer: deployer,
            salt,
        }
    );

    const deployMethod = new DeployMethod(
        contract.publicKeys,
        wallet,
        SilverContract.artifact,
        (instance, wallet) => SilverContract.at(instance.address, wallet),
        [],
        getDefaultInitializer(SilverContract.artifact)?.name
    );

    const sponsoredPFCContract = await getSponsoredPFCContract();

    await deployMethod
        .send({
            from: deployer,
            contractAddressSalt: salt,
            fee: {
                paymentMethod: new SponsoredFeePaymentMethod(
                    sponsoredPFCContract.address
                ),
            },
        })
        .wait({ timeout: 120 });
    await wallet.registerContract(contract, SilverContract.artifact);

    return {
        contractAddress: contract.address.toString(),
        deployerAddress: deployer.toString(),
        deploymentSalt: salt.toString(),
    };
}


async function writeConfigEnvFile(deploymentInfo) {
    const envFilePath = path.join(import.meta.dirname, '../.env');
    const envConfig = Object.entries({
        CONFIG_CONTRACT_ADDRESS: deploymentInfo.contractAddress,
        CONFIG_DEPLOYER_ADDRESS: deploymentInfo.deployerAddress,
        CONFIG_DEPLOYMENT_SALT: deploymentInfo.deploymentSalt,
        AZTEC_NODE_URL,
    })
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    fs.appendFileSync(envFilePath, '\n\n\n' + envConfig);

    console.log(`
      \n\n\n
      Contract deployed successfully. Config saved to ${envFilePath}
      IMPORTANT: Do not lose this file as you will not be able to recover the contract address if you lose it.
      \n\n\n
    `);
}

async function writeSilverEnvFile(deploymentInfo) {
    const envFilePath = path.join(import.meta.dirname, '../.env');
    const envConfig = Object.entries({
        SILVER_CONTRACT_ADDRESS: deploymentInfo.contractAddress,
        SILVER_DEPLOYER_ADDRESS: deploymentInfo.deployerAddress,
        SILVER_DEPLOYMENT_SALT: deploymentInfo.deploymentSalt,
        AZTEC_NODE_URL,
    })
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    fs.appendFileSync(envFilePath, '\n\n\n' + envConfig);

    console.log(`
      \n\n\n
      Contract deployed successfully. Config saved to ${envFilePath}
      IMPORTANT: Do not lose this file as you will not be able to recover the contract address if you lose it.
      \n\n\n
    `);
}


async function createAccountAndDeployContract() {
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode);

    // Register the SponsoredFPC contract (for sponsored fee payments)
    await wallet.registerContract(
        await getSponsoredPFCContract(),
        SponsoredFPCContractArtifact
    );

    // Check if account information exists in .env, then load or create account
    let accountAddress: AztecAddress;
    if (
        process.env.ACCOUNT_SALT &&
        process.env.ACCOUNT_SECRET_KEY &&
        process.env.ACCOUNT_SIGNING_KEY
    ) {
        console.log('Loading existing account from .env file...');
        accountAddress = await loadAccount(wallet);
    } else {
        console.log('Creating new account...');
        accountAddress = await createAccount(wallet);
    }

    // Deploy the contract
    const configDeploymentInfo = await deployConfigContract(wallet, accountAddress);

    // Save the deployment info to app/public
    if (WRITE_ENV_FILE) {
        await writeConfigEnvFile(configDeploymentInfo);
    }

    // Deploy the silver contract
    const silverDeploymentInfo = await deploySilverContract(wallet, accountAddress);
    if (WRITE_ENV_FILE) {
        await writeSilverEnvFile(silverDeploymentInfo);
    }

    // Call get_admin
    try {
        console.log('Simulating contract (calling get_admin)...\n');
        const silver = SilverContract.at(
            AztecAddress.fromString(silverDeploymentInfo.contractAddress),
            wallet
        );

        const admin = await silver.methods
            .get_admin_from_config(AztecAddress.fromString(configDeploymentInfo.contractAddress))
            .simulate({ from: accountAddress });

        console.log('\n\n\n\n');
        console.log('admin in contract:', admin.toString());
        console.log('accountAddress:', accountAddress);
        console.log('\n\n\n\n');


        const msgSender = await silver.methods
            .get_msg_sender_from_config(AztecAddress.fromString(configDeploymentInfo.contractAddress))
            .simulate({ from: accountAddress });

        console.log('\n\n\n\n');
        console.log('msgSender in config contract:', msgSender.toString());
        console.log('silver contract:', silverDeploymentInfo.contractAddress);
        console.log('config contract:', configDeploymentInfo.contractAddress);
        console.log('\n\n\n\n');

        // ========== Hash + Event PoC Test ==========
        // Test store_large_data: struct as input -> hash stored (1 write) + event emitted
        // LargeData has 100 fields (values array) - scales without code changes
        console.log('=== Testing store_large_data (hash + event pattern) ===\n');
        const testKey = Fr.fromString('1');
        const values = Array.from({ length: 100 }, (_, i) => BigInt((i + 1) * 100));
        const largeData = { values };

        const sponsoredPFCContract = await getSponsoredPFCContract();
        const storeTx = silver.methods
            .store_large_data(testKey, largeData)
            .send({
                from: accountAddress,
                fee: {
                    paymentMethod: new SponsoredFeePaymentMethod(
                        sponsoredPFCContract.address
                    ),
                },
            });
        const storeReceipt = await storeTx.wait({ timeout: 120 });
        console.log('store_large_data tx hash:', storeReceipt.txHash.toString());

        // Read event content from public logs
        const blockNumber = Number(storeReceipt.blockNumber ?? 0);
        const events = await getDecodedPublicEvents<{
            key: Fr;
            data: { values: bigint[] };
        }>(aztecNode, SilverContract.events.LargeDataStored, blockNumber, 1);
        if (events.length > 0) {
            console.log('\n--- Event LargeDataStored content ---');
            events.forEach((evt, i) => {
                console.log(`[${i}] key:`, evt.key.toString());
                console.log(`[${i}] data.values:`, evt.data.values);
                console.log(`[${i}] data.values length:`, evt.data.values.length);
            });
            console.log('-------------------------------------\n');
        } else {
            const { logs } = await aztecNode.getPublicLogs({
                txHash: storeReceipt.txHash,
            });
            console.log('\n--- No LargeDataStored events found, raw logs:', logs.length, '---\n');
        }

        // Verify stored hash
        const storedHash = await silver.methods
            .get_data_hash(testKey)
            .simulate({ from: accountAddress });
        console.log('Stored hash:', storedHash.toString());

        // Verify data matches hash
        const verifyResult = await silver.methods
            .verify_large_data(testKey, largeData)
            .simulate({ from: accountAddress });
        console.log('verify_large_data (correct data):', verifyResult);

        // Verify wrong data fails
        const wrongValues = [...values];
        wrongValues[0] = 999n;
        const wrongData = { values: wrongValues };
        const verifyWrongResult = await silver.methods
            .verify_large_data(testKey, wrongData)
            .simulate({ from: accountAddress });
        console.log('verify_large_data (wrong data):', verifyWrongResult);

        console.log('\n=== Hash + Event PoC test complete ===');
        console.log('- store_large_data: 1 write (hash) instead of 100+ writes (struct)');
        console.log('- Chunked poseidon2 hash scales to 100+ fields');
        console.log('- Full struct emitted via LargeDataStored event for off-chain indexing');
        console.log('- verify_large_data: pass struct as param, hash checked against storage\n');
    } catch (err) {
        console.error('Failed to call contract:', err);
    }

    // Clean up the PXE store
    // fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });
}

createAccountAndDeployContract()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

export { createAccountAndDeployContract };
