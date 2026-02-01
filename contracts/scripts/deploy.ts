import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    DeployMethod,
    getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts';
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


import { ConfigContract } from './artifacts/Config.ts';
import { MainContract } from './artifacts/Main.ts';

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

async function deployMainContract(wallet: Wallet, deployer: AztecAddress, config_address: AztecAddress) {
    const salt = Fr.random();
    const contract = await getContractInstanceFromInstantiationParams(
        MainContract.artifact,
        {
            publicKeys: PublicKeys.default(),
            constructorArtifact: getDefaultInitializer(MainContract.artifact),
            constructorArgs: [deployer.toField(), config_address.toField()],
            deployer: deployer,
            salt,
        }
    );

    const deployMethod = new DeployMethod(
        contract.publicKeys,
        wallet,
        MainContract.artifact,
        (instance, wallet) => MainContract.at(instance.address, wallet),
        [deployer.toField(), config_address.toField()],
        getDefaultInitializer(MainContract.artifact)?.name
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
    await wallet.registerContract(contract, MainContract.artifact);

    return {
        contractAddress: contract.address.toString(),
        deployerAddress: deployer.toString(),
        deploymentSalt: salt.toString(),
    };
}

async function writeConfigEnvFile(configDeploymentInfo) {
    const envFilePath = path.join(import.meta.dirname, '../.env');
    const envConfig = Object.entries({
        CONFIG_CONTRACT_ADDRESS: configDeploymentInfo.contractAddress,
        CONFIG_DEPLOYER_ADDRESS: configDeploymentInfo.deployerAddress,
        CONFIG_DEPLOYMENT_SALT: configDeploymentInfo.deploymentSalt,
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

async function writeMainEnvFile(mainDeploymentInfo) {
    const envFilePath = path.join(import.meta.dirname, '../.env');
    const envConfig = Object.entries({
        MAIN_CONTRACT_ADDRESS: mainDeploymentInfo.contractAddress,
        MAIN_DEPLOYER_ADDRESS: mainDeploymentInfo.deployerAddress,
        MAIN_DEPLOYMENT_SALT: mainDeploymentInfo.deploymentSalt,
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

    const mainDeploymentInfo = await deployMainContract(wallet, accountAddress, AztecAddress.fromString(configDeploymentInfo.contractAddress));

    if (WRITE_ENV_FILE) {
        await writeMainEnvFile(mainDeploymentInfo);
    }

    // Call get_admin
    try {
        console.log('Simulating contract (calling get_admin_utility)...\n');
        const main = MainContract.at(
            AztecAddress.fromString(mainDeploymentInfo.contractAddress),
            wallet
        );

        const admin = await main.methods
            .get_admin_utility()
            .simulate({ from: accountAddress });

        console.log('admin in contract:', admin.toString());
        console.log('accountAddress:', accountAddress);
    } catch (err) {
        console.error('Failed to call contract get_admin():', err);
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
