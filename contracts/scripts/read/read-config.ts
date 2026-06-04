/**
 * Read and print the current Config contract values.
 *
 * Usage (from contracts/ directory):
 *   pnpm read:config
 *   pnpm read:config -- --hashes
 *   pnpm read:config -- --json
 *
 * Or:
 *   node --experimental-transform-types scripts/read/read-config.ts [--hashes] [--json]
 *
 * Requires: deploy + configure done, .env has ACCOUNT_* and CONFIG_CONTRACT_ADDRESS.
 */
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

const CONTRACT_SPECS = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
];

const HASH_LABELS = [
    'world',
    'snark',
    'game_core',
    'planet_level_thresholds',
    'planet_type_weights_tier_0',
    'planet_type_weights_tier_1',
    'planet_type_weights_tier_2',
    'planet_type_weights_tier_3',
    'artifacts',
    'spaceships',
    'space_junk',
    'capture_zones',
    'upgrade',
] as const;

type ScriptOptions = {
    hashes: boolean;
    json: boolean;
};

function parseOptions(): ScriptOptions {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const unknown = args.filter(
        (arg) => arg !== '--hashes' && arg !== '--json'
    );
    if (unknown.length > 0) {
        console.error(
            'Usage: pnpm read:config -- [--hashes] [--json]\n' +
                `Unknown option(s): ${unknown.join(', ')}`
        );
        process.exit(1);
    }

    return {
        hashes: args.includes('--hashes'),
        json: args.includes('--json'),
    };
}

function jsonReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

function printSection(title: string, value: unknown): void {
    console.log(`\n${title}:`);
    console.dir(value, { depth: null, colors: true });
}

async function main(): Promise<void> {
    const options = parseOptions();
    if (options.json && process.env.ACCOUNT_SILENT_DIAGNOSTICS == null) {
        process.env.ACCOUNT_SILENT_DIAGNOSTICS = 'true';
    }
    loadContractsEnv();

    const aztecNodeUrl = getAztecNodeUrl();
    const addresses = { Config: getRequiredEnv('CONFIG_CONTRACT_ADDRESS') };

    if (!options.json) {
        console.log('Connecting to Aztec node...');
    }
    const aztecNode = createAztecNodeClient(aztecNodeUrl);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: false,
    });
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const from = await resolveDeployerAccount(wallet, aztecNode, {
        mode: 'loadOnly',
        deployTimeoutMs: 120_000,
        ensureDeployed: false,
    });
    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );
    const config = contracts['Config']!;
    const fullConfig = unwrapSimulateResult(
        await config.methods.get_full_config_unconstrained().simulate({ from })
    );

    const result: Record<string, unknown> = {
        node: aztecNodeUrl,
        contract: config.address.toString(),
        from: from.toString(),
        full_config: fullConfig,
    };

    if (options.hashes) {
        const hashes = unwrapSimulateResult(
            await config.methods
                .get_all_config_hashes_unconstrained()
                .simulate({ from })
        ) as unknown[];
        result.hashes = Object.fromEntries(
            HASH_LABELS.map((label, index) => [label, hashes[index]])
        );
    }

    if (options.json) {
        console.log(JSON.stringify(result, jsonReplacer, 2));
        return;
    }

    console.log('\n' + '='.repeat(60));
    console.log('Aztec node     :', result.node);
    console.log('Config contract:', result.contract);
    console.log('Simulated from :', result.from);
    console.log('='.repeat(60));
    printSection('Full config', result.full_config);

    if (result.hashes) {
        printSection('Config hashes', result.hashes);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Error:', err);
        process.exit(1);
    });
