/**
 * Sends a no-op transaction periodically to keep the local Aztec chain producing blocks,
 * so you can get correct timestamps when testing.
 *
 * Usage: node --experimental-transform-types scripts/dev/timestamp-ticker.ts [intervalSeconds]
 *   intervalSeconds: interval in seconds (default 12)
 *
 * Prerequisites: deploy + configure done, .env has ACCOUNT_* and ADMIN_CONTRACT_ADDRESS
 */
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';

import {
    getAztecNodeUrl,
    getContractInstances,
    getOptionalEnv,
    getProverEnabled,
    getSponsoredPFCContract,
    loadContractsEnv,
    resolveDeployerAccount,
    setupWallet,
} from '../utils/index.ts';

loadContractsEnv();

const AZTEC_NODE_URL = getAztecNodeUrl();
const PROVER_ENABLED = getProverEnabled();
const INTERVAL_SEC = parseInt(process.argv[2] || '12', 10) || 12;

const CONTRACT_SPECS = [
    {
        name: 'Admin',
        modulePath: './artifacts/Admin.ts',
        exportName: 'AdminContract',
    },
];
async function main() {
    const adminAddr = getOptionalEnv('ADMIN_CONTRACT_ADDRESS');
    if (!adminAddr) {
        throw new Error(
            'Missing ADMIN_CONTRACT_ADDRESS in .env. Run deploy + configure first.'
        );
    }

    console.log(
        `🕐 Timestamp ticker — sending no-op tx every ${INTERVAL_SEC}s`
    );
    console.log(`   Node: ${AZTEC_NODE_URL}\n`);

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
    });

    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const admin = await resolveDeployerAccount(wallet, aztecNode, {
        mode: 'loadOnly',
        deployTimeoutMs: 120_000,
    });
    const contracts = await getContractInstances(
        wallet,
        { Admin: adminAddr },
        CONTRACT_SPECS
    );
    const Admin = contracts['Admin'];
    if (!Admin) throw new Error('Admin contract not loaded.');

    const sendOpts = () => ({
        from: admin,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    });

    let count = 0;
    const run = async () => {
        count++;
        const blockBefore = await aztecNode.getBlockNumber();
        try {
            await Admin.methods.transfer_admin(admin).send(sendOpts());
            const blockAfter = await aztecNode.getBlockNumber();
            const ts = new Date().toISOString();
            console.log(
                `[${ts}] #${count} tx sent — block ${blockBefore} → ${blockAfter}`
            );
        } catch (e) {
            console.error(
                `[${new Date().toISOString()}] #${count} failed:`,
                e instanceof Error ? e.message : e
            );
        }
    };

    await run(); // send first tx immediately
    setInterval(run, INTERVAL_SEC * 1000);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
