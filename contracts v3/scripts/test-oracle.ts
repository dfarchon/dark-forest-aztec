/**
 * Test script for TestOracle: verifies that get_block_header_at works in a private function
 * and that the resulting block hash is observable on-chain via event + storage.
 *
 * Flow:
 *   1. Read current block number N.
 *   2. Force a fresh L2 block (send a no-op public call) so N becomes finalized.
 *   3. Call TestOracle.test_get_block_header_private(N) — private function:
 *        - fetches block header for block N via oracle
 *        - computes header.hash()
 *        - enqueues record_block_hash_public(N, hash, chain_id)
 *   4. Wait for the tx to be mined.
 *   5. Read the BlockHashResult event  →  print block_hash & chain_id.
 *   6. Read storage via get_last_block_hash() + get_last_queried_block()  →  cross-verify.
 *
 * Usage (from contracts/ directory):
 *   pnpm exec tsx scripts/test-oracle.ts
 *   node --experimental-transform-types scripts/test-oracle.ts
 *
 * Prerequisites:
 *   - deploy-test-oracle.ts has been run (TEST_ORACLE_CONTRACT_ADDRESS in .env).
 *   - Aztec sandbox running.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import {
    getOrCreateAccount,
    getSponsoredPFCContract,
    setupWallet,
} from './utils/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL ?? 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED !== 'false';

// ---------------------------------------------------------------------------
// Block helper
// ---------------------------------------------------------------------------

async function waitForNextBlock(
    node: ReturnType<typeof createAztecNodeClient>,
    afterBlock: number,
    timeoutMs = 60_000
): Promise<number> {
    const start = Date.now();
    console.log(`   Waiting for block > ${afterBlock}...`);
    while (Date.now() - start < timeoutMs) {
        const current = Number(await node.getBlockNumber());
        if (current > afterBlock) {
            console.log(`   Block advanced to ${current}.`);
            return current;
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Timed out waiting for block > ${afterBlock}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const oracleAddr = process.env.TEST_ORACLE_CONTRACT_ADDRESS;
    if (!oracleAddr) {
        throw new Error(
            'TEST_ORACLE_CONTRACT_ADDRESS not in .env — run deploy-test-oracle.ts first.'
        );
    }

    console.log('Aztec Node URL:', AZTEC_NODE_URL);
    console.log('TestOracle address:', oracleAddr);

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
    });

    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const caller = await getOrCreateAccount(wallet);
    console.log('Caller:', caller.toString());

    const sendOpts = {
        from: caller,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

    // Load artifact
    const mod = await import('./artifacts/TestOracle.ts');
    const TestOracleContract = mod.TestOracleContract;
    if (!TestOracleContract) {
        throw new Error('TestOracle artifact not found. Run pnpm build-contracts.');
    }

    const oracle = await TestOracleContract.at(
        AztecAddress.fromString(oracleAddr),
        wallet
    );

    // ------------------------------------------------------------------
    // Step 1: Force a fresh L2 block so there's a finalized header to fetch
    // ------------------------------------------------------------------
    console.log('\n--- Step 1: Force fresh L2 block (no-op public call) ---');
    const chainId = await oracle.methods.get_chain_id().simulate({ from: caller });
    console.log('   chain_id (from contract):', String(chainId));

    const blockBeforeNoop = Number(await aztecNode.getBlockNumber());
    console.log('   Current block before noop:', blockBeforeNoop);

    // Use get_chain_id (a view) as a cheap public call to advance the block
    try {
        const noopTx = await oracle.methods
            .get_chain_id()
            .send(sendOpts);
        await noopTx.wait();
        console.log('   Fresh block produced.');
    } catch {
        console.warn('   No-op send failed (chain_id is view-only on some versions), continuing.');
    }

    // ------------------------------------------------------------------
    // Step 2: Pick a target block that is already finalized
    // ------------------------------------------------------------------
    const currentBlock = Number(await aztecNode.getBlockNumber());
    // Use currentBlock - 1 to guarantee the header exists
    const targetBlock = Math.max(1, currentBlock - 1);
    console.log(`\n--- Step 2: Target block for oracle query: ${targetBlock} ---`);

    // ------------------------------------------------------------------
    // Step 3: Simulate then send test_get_block_header_private(targetBlock)
    // ------------------------------------------------------------------
    console.log('\n--- Step 3: test_get_block_header_private (private) ---');

    try {
        await oracle.methods
            .test_get_block_header_private(targetBlock)
            .simulate({ from: caller });
        console.log('   Simulate passed.');
    } catch (e) {
        console.error('   Simulate failed:', e instanceof Error ? e.message : String(e));
        if (e instanceof Error && e.stack) console.error(e.stack);
        process.exit(1);
    }

    const tx = await oracle.methods
        .test_get_block_header_private(targetBlock)
        .send(sendOpts);
    const receipt = await tx.wait();
    const txHash = (receipt as unknown as { txHash?: unknown })?.txHash;
    console.log('   TX:', String(txHash ?? '(unknown)'));

    // ------------------------------------------------------------------
    // Step 4: Wait for the tx block so events are available
    // ------------------------------------------------------------------
    await waitForNextBlock(aztecNode, currentBlock);

    // ------------------------------------------------------------------
    // Step 5: Decode BlockHashResult event
    // ------------------------------------------------------------------
    console.log('\n--- Step 5: Reading BlockHashResult event ---');

    const latestBlock = Number(await aztecNode.getBlockNumber());
    const fromBlock = Math.max(0, latestBlock - 20);
    const limit = latestBlock - fromBlock + 1;

    const events = await getDecodedPublicEvents<{
        target_block: unknown;
        block_hash: unknown;
        chain_id: unknown;
    }>(aztecNode, TestOracleContract.events.BlockHashResult, fromBlock, limit, {
        contractAddress: oracle.address,
    });

    if (events.length === 0) {
        console.warn('   No BlockHashResult events found (may need to wait more blocks).');
    } else {
        const last = events[events.length - 1];
        console.log('\n' + '='.repeat(60));
        console.log('BlockHashResult event (latest):');
        console.log('  target_block :', String(last?.target_block));
        console.log('  block_hash   :', String(last?.block_hash));
        console.log('  chain_id     :', String(last?.chain_id));
        console.log('='.repeat(60));
    }

    // ------------------------------------------------------------------
    // Step 6: Read from storage via view functions
    // ------------------------------------------------------------------
    console.log('\n--- Step 6: Reading from contract storage ---');

    const storedHash = await oracle.methods
        .get_last_block_hash()
        .simulate({ from: caller });
    const storedBlock = await oracle.methods
        .get_last_queried_block()
        .simulate({ from: caller });

    console.log('  get_last_queried_block() :', String(storedBlock));
    console.log('  get_last_block_hash()    :', String(storedHash));

    // Sanity check
    const blockMatch = Number(storedBlock) === targetBlock;
    console.log(
        `  Block match (${Number(storedBlock)} === ${targetBlock}):`,
        blockMatch ? 'PASS' : 'FAIL'
    );

    if (events.length > 0) {
        const eventHash = String(events[events.length - 1]?.block_hash);
        const storageHash = String(storedHash);
        const hashMatch = eventHash === storageHash;
        console.log(
            `  Hash match (event vs storage):`,
            hashMatch ? 'PASS' : `FAIL (event=${eventHash}, storage=${storageHash})`
        );
    }

    console.log('\n' + '='.repeat(60));
    console.log('TestOracle test complete.');
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
