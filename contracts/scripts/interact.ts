import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    getContractInstanceFromInstantiationParams,
    getGasLimits,
} from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import { type AztecNode, createAztecNodeClient } from '@aztec/aztec.js/node';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { createStore } from '@aztec/kv-store/lmdb';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { getPXEConfig } from '@aztec/pxe/server';
import { TestWallet } from '@aztec/test-wallet/server';
import * as dotenv from 'dotenv';
import path from 'path';

import { ConfigContract } from './artifacts/Config.ts';
import { SilverContract } from './artifacts/Silver.ts';
import { getDecodedPublicEvents } from './utils/events.ts';

// Load environment variables
dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'false' ? false : true;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.store');

async function setupWallet(aztecNode: AztecNode) {
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
            'Account information not found in .env file. Run deploy script first to create an account.'
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

async function interactWithContracts() {
    const requiredEnv = [
        'CONFIG_CONTRACT_ADDRESS',
        'SILVER_CONTRACT_ADDRESS',
        'CONFIG_DEPLOYER_ADDRESS',
        'SILVER_DEPLOYER_ADDRESS',
        'CONFIG_DEPLOYMENT_SALT',
        'SILVER_DEPLOYMENT_SALT',
    ];
    const missing = requiredEnv.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(
            `Missing in .env (run deploy first): ${missing.join(', ')}`
        );
    }

    console.log('✅ Required env vars present');
    console.log(`📋 Config:  ${process.env.CONFIG_CONTRACT_ADDRESS}`);
    console.log(`📋 Silver:  ${process.env.SILVER_CONTRACT_ADDRESS}`);
    console.log(`🌐 Node:    ${AZTEC_NODE_URL}\n`);

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode);

    await wallet.registerContract(
        await getSponsoredPFCContract(),
        SponsoredFPCContractArtifact
    );

    const accountAddress = await loadAccount(wallet);
    console.log(`👤 Account: ${accountAddress.toString()}\n`);

    const configAddress = AztecAddress.fromString(
        process.env.CONFIG_CONTRACT_ADDRESS!
    );
    const silverAddress = AztecAddress.fromString(
        process.env.SILVER_CONTRACT_ADDRESS!
    );

    // Register contracts with wallet
    try {
        const configInstance = await getContractInstanceFromInstantiationParams(
            ConfigContract.artifact,
            {
                constructorArgs: [
                    AztecAddress.fromString(process.env.CONFIG_DEPLOYER_ADDRESS!)
                        .toField(),
                ],
                salt: Fr.fromString(process.env.CONFIG_DEPLOYMENT_SALT!),
                deployer: AztecAddress.fromString(
                    process.env.CONFIG_DEPLOYER_ADDRESS!
                ),
            }
        );
        await wallet.registerContract(configInstance, ConfigContract.artifact);

        const silverInstance = await getContractInstanceFromInstantiationParams(
            SilverContract.artifact,
            {
                constructorArgs: [],
                salt: Fr.fromString(process.env.SILVER_DEPLOYMENT_SALT!),
                deployer: AztecAddress.fromString(
                    process.env.SILVER_DEPLOYER_ADDRESS!
                ),
            }
        );
        await wallet.registerContract(silverInstance, SilverContract.artifact);
        console.log('✅ Contracts registered\n');
    } catch (err) {
        console.log('⚠️  Registration skipped (may already be registered)', err);
    }

    const silver = SilverContract.at(silverAddress, wallet);
    const sponsoredPFCContract = await getSponsoredPFCContract();

    // --- Config cross-call ---
    console.log('=== Config cross-call (Silver -> Config) ===\n');
    const admin = await silver.methods
        .get_admin_from_config(configAddress)
        .simulate({ from: accountAddress });
    console.log('admin (from config):', admin.toString());
    console.log('accountAddress:      ', accountAddress.toString());

    const msgSender = await silver.methods
        .get_msg_sender_from_config(configAddress)
        .simulate({ from: accountAddress });
    console.log('msg_sender (config):', msgSender.toString());
    console.log('');

    // --- Hash + Event PoC ---
    console.log('=== store_large_data (hash + event) ===\n');
    const testKey = Fr.fromString('1');
    const values = Array.from({ length: 500 }, (_, i) => BigInt((i + 1) * 100));
    const largeData = { values };

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

    const blockNumber = Number(storeReceipt.blockNumber ?? 0);
    const events = await getDecodedPublicEvents<{
        key: Fr;
        data: { values: bigint[] };
    }>(aztecNode, SilverContract.events.LargeDataStored, blockNumber, 1);
    if (events.length > 0) {
        console.log('\n--- Event LargeDataStored ---');
        events.forEach((evt, i) => {
            console.log(`[${i}] key:`, evt.key.toString());
            console.log(`[${i}] data.values length:`, evt.data.values.length);
        });
        console.log('---\n');
    } else {
        const { logs } = await aztecNode.getPublicLogs({
            txHash: storeReceipt.txHash,
        });
        console.log('No LargeDataStored events, raw logs:', logs.length, '\n');
    }

    const storedHash = await silver.methods
        .get_data_hash(testKey)
        .simulate({ from: accountAddress });
    console.log('Stored hash:', storedHash.toString());

    // --- verify_large_data + gas ---
    console.log('\n=== verify_large_data ===\n');
    const verifyPayload = await silver.methods
        .verify_large_data(testKey, largeData)
        .request();
    const txSimResult = await wallet.simulateTx(verifyPayload, {
        from: accountAddress,
    });
    const gasUsed = txSimResult.gasUsed;
    const suggestedLimits = getGasLimits(txSimResult, 0.1);
    console.log('verify_large_data gas used:', {
        totalGas: {
            daGas: gasUsed.totalGas.daGas,
            l2Gas: gasUsed.totalGas.l2Gas,
        },
        billedGas: {
            daGas: gasUsed.billedGas.daGas,
            l2Gas: gasUsed.billedGas.l2Gas,
        },
    });
    console.log('suggested gas limits (10% pad):', {
        gasLimits: suggestedLimits.gasLimits,
        teardownGasLimits: suggestedLimits.teardownGasLimits,
    });

    const verifyResult = await silver.methods
        .verify_large_data(testKey, largeData)
        .simulate({ from: accountAddress });
    console.log('verify_large_data (correct data):', verifyResult);

    const wrongValues = [...values];
    wrongValues[0] = 999n;
    const wrongData = { values: wrongValues };
    const verifyWrongResult = await silver.methods
        .verify_large_data(testKey, wrongData)
        .simulate({ from: accountAddress });
    console.log('verify_large_data (wrong data):', verifyWrongResult);

    // --- compute_chunk_hashes_and_emit (private) + gas ---
    console.log('\n=== compute_chunk_hashes_and_emit (private, 20000 fields -> 500 hashes) ===\n');
    const chunkTestKey = Fr.fromString('2');
    const chunks = Array.from({ length: 500 }, (_, i) => ({
        values: Array.from({ length: 40 }, (_, j) => BigInt(i * 40 + j + 1)),
    }));
    const largePrivateInput = { chunks };

    const computePayload = await silver.methods
        .compute_chunk_hashes_and_emit(chunkTestKey, largePrivateInput)
        .request();

    const computeSimResult = await wallet.simulateTx(computePayload, {
        from: accountAddress,
    });
    const computeGasUsed = computeSimResult.gasUsed;
    const computeSuggestedLimits = getGasLimits(computeSimResult, 0.1);
    console.log('compute_chunk_hashes_and_emit (simulated) gas used:');
    console.log('  totalGas:  ', {
        daGas: Number(computeGasUsed.totalGas.daGas),
        l2Gas: Number(computeGasUsed.totalGas.l2Gas),
    });
    console.log('  billedGas: ', {
        daGas: Number(computeGasUsed.billedGas.daGas),
        l2Gas: Number(computeGasUsed.billedGas.l2Gas),
    });
    console.log('  suggested gas limits (10% pad):');
    console.log('    gasLimits:       ', computeSuggestedLimits.gasLimits);
    console.log('    teardownGasLimits:', computeSuggestedLimits.teardownGasLimits);

    const computeTx = silver.methods
        .compute_chunk_hashes_and_emit(chunkTestKey, largePrivateInput)
        .send({
            from: accountAddress,
            fee: {
                paymentMethod: new SponsoredFeePaymentMethod(
                    sponsoredPFCContract.address
                ),
            },
        });
    const computeReceipt = await computeTx.wait({ timeout: 120 });
    console.log('\ncompute_chunk_hashes_and_emit tx hash:', computeReceipt.txHash.toString());
    console.log('block number:', computeReceipt.blockNumber?.toString() ?? 'n/a');

    // Note: gasUsed does not exist on TxReceipt, so we do not log it.

    const computeBlockNumber = Number(computeReceipt.blockNumber ?? 0);
    const chunkEvents = await getDecodedPublicEvents<{
        key: Fr;
        chunk_hashes: bigint[];
    }>(aztecNode, SilverContract.events.ChunkHashesEmitted, computeBlockNumber, 1);
    if (chunkEvents.length > 0) {
        console.log('\n--- Event ChunkHashesEmitted ---');
        chunkEvents.forEach((evt, i) => {
            console.log(`[${i}] key:`, evt.key.toString());
            console.log(`[${i}] chunk_hashes length:`, evt.chunk_hashes?.length ?? 0);
            if (evt.chunk_hashes?.length && evt.chunk_hashes.length <= 5) {
                console.log(`[${i}] chunk_hashes:`, evt.chunk_hashes.map((h) => h.toString()));
            } else if (evt.chunk_hashes?.length) {
                console.log(`[${i}] first 3 hashes:`, evt.chunk_hashes.slice(0, 3).map((h) => h.toString()));
            }
        });
        console.log('---\n');
    } else {
        const { logs } = await aztecNode.getPublicLogs({
            txHash: computeReceipt.txHash,
        });
        console.log('No ChunkHashesEmitted events, raw logs:', logs.length, '\n');
    }


    console.log('\n=== Interact tests complete ===');
}

interactWithContracts()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

export { interactWithContracts };
