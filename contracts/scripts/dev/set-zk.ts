/**
 * Toggle the on-chain SnarkConfig.disable_zk_checks flag.
 *
 * When disabled (true), the system contracts skip the init / move / reveal /
 * find ZK proof asserts (see `if !snark_config.disable_zk_checks { ... }` in
 * core/move/admin/artifact_find). This lets local test scripts pass fixed
 * coordinates instead of searching for valid spawn points.
 *
 * Usage:
 *   pnpm set-zk show   # read-only: print current disable_zk_checks
 *   pnpm set-zk on      # disable ZK checks (set disable_zk_checks = true)
 *   pnpm set-zk off     # enable ZK checks  (set disable_zk_checks = false)
 *
 * Requires: .env with ACCOUNT_* (admin) and CONFIG_CONTRACT_ADDRESS (run deploy first).
 */
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';

import {
    getAztecNodeUrl,
    getContractInstances,
    getRequiredEnv,
    getSponsoredPFCContract,
    loadContractsEnv,
    resolveDeployerAccount,
    setupWallet,
    unwrapSimulateResult,
} from '../utils/index.ts';

loadContractsEnv();

const AZTEC_NODE_URL = getAztecNodeUrl();

const CONTRACT_SPECS = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
];

const VALID_COMMANDS = ['show', 'on', 'off'] as const;
type Command = (typeof VALID_COMMANDS)[number];

function printSnarkConfig(label: string, sc: Record<string, unknown>): void {
    console.log(`\n  ${label} SnarkConfig:`);
    console.log(`    disable_zk_checks   : ${sc.disable_zk_checks}`);
    console.log(`    planethash_key      : ${sc.planethash_key}`);
    console.log(`    spacetype_key       : ${sc.spacetype_key}`);
    console.log(`    biomebase_key       : ${sc.biomebase_key}`);
    console.log(`    perlin_mirror_x     : ${sc.perlin_mirror_x}`);
    console.log(`    perlin_mirror_y     : ${sc.perlin_mirror_y}`);
    console.log(`    perlin_length_scale : ${sc.perlin_length_scale}`);
}

async function main() {
    const command = process.argv[2] as Command | undefined;
    if (!command || !VALID_COMMANDS.includes(command)) {
        console.log('Usage: pnpm set-zk <command>\n');
        console.log('Commands:');
        console.log('  show   Print current disable_zk_checks (read-only)');
        console.log('  on     Disable ZK checks (disable_zk_checks = true)');
        console.log('  off    Enable ZK checks  (disable_zk_checks = false)');
        process.exit(1);
    }

    const configAddress = getRequiredEnv('CONFIG_CONTRACT_ADDRESS');
    console.log(`Config contract: ${configAddress}`);
    console.log(`Aztec Node URL : ${AZTEC_NODE_URL}\n`);

    console.log('Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: false,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const deployer = await resolveDeployerAccount(wallet, aztecNode, {
        mode: 'loadOnly',
        deployTimeoutMs: 120_000,
        ensureDeployed: false,
    });
    console.log(`Admin account  : ${deployer.toString()}\n`);

    const contracts = await getContractInstances(
        wallet,
        { Config: configAddress },
        CONTRACT_SPECS
    );
    const config = contracts['Config']!;

    const simOpts = { from: deployer };
    const sendOpts = {
        from: deployer,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    };

    const current = unwrapSimulateResult(
        await config.methods.get_snark_config_unconstrained().simulate(simOpts)
    ) as Record<string, unknown>;

    if (command === 'show') {
        console.log('Current on-chain SnarkConfig:');
        printSnarkConfig('[current]', current);
        console.log('');
        return;
    }

    const desired = command === 'on';
    if (Boolean(current.disable_zk_checks) === desired) {
        console.log(`disable_zk_checks is already ${desired}. Nothing to do.`);
        printSnarkConfig('[current]', current);
        return;
    }

    const newConfig = { ...current, disable_zk_checks: desired };
    printSnarkConfig('[before]', current);

    console.log(
        `\nSending set_snark_config tx (disable_zk_checks -> ${desired})...`
    );
    const t1 = Date.now();
    await config.methods.set_snark_config(newConfig).send(sendOpts);
    console.log(`  done (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

    printSnarkConfig('[after]', newConfig);
    console.log('\nSnarkConfig updated successfully.');
}

main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
