/**
 * Deploy Config and Admin contracts to the Aztec sandbox.
 * Requires a running sandbox at PXE_URL (default http://localhost:8080).
 */
import {
    createAztecNodeClient,
    waitForNode,
} from '@aztec/aztec.js/node';
import {
    TestWallet,
    registerInitialLocalNetworkAccountsInWallet,
} from '@aztec/test-wallet/server';
import { ConfigContract } from './artifacts/Config.ts';
import { AdminContract } from './artifacts/Admin.ts';

const PXE_URL = process.env.PXE_URL ?? 'http://localhost:8080';

async function main() {
    console.log('Connecting to node at', PXE_URL);
    const node = createAztecNodeClient(PXE_URL);
    await waitForNode(node);

    const wallet = await TestWallet.create(node);
    const [adminAddress] = await registerInitialLocalNetworkAccountsInWallet(wallet);
    if (!adminAddress) {
        throw new Error('No initial accounts registered');
    }
    console.log('Deployer (admin) address:', adminAddress.toString());

    // Use first registered account as sender (TestWallet has getAccounts(), not getAddress())
    const from = adminAddress;

    console.log('Deploying Config...');
    const config = await ConfigContract.deploy(wallet, adminAddress)
        .send({ from })
        .deployed();
    console.log('Config deployed at:', config.address.toString());

    console.log('Deploying Admin...');
    const admin = await AdminContract.deploy(wallet, adminAddress)
        .send({ from })
        .deployed();
    console.log('Admin deployed at:', admin.address.toString());

    console.log('\nDeployment complete.');
    console.log('Config:', config.address.toString());
    console.log('Admin:', admin.address.toString());
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
