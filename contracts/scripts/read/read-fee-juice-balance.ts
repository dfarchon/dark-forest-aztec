/**
 * Read and print the public Fee Juice balance for ACCOUNT_ADDRESS.
 *
 * Usage (from contracts/ directory):
 *   pnpm read:balance
 *   pnpm read:balance -- --json
 *   pnpm read:balance -- <aztec-address>
 *
 * Or:
 *   node --experimental-transform-types scripts/read/read-fee-juice-balance.ts [--json] [address]
 *
 * Requires: AZTEC_NODE_URL. Address defaults to ACCOUNT_ADDRESS from the active env file.
 * This only reports public Fee Juice (gas); private note balances cannot be queried by address alone.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';

import {
    formatFeeJuiceWei,
    getAztecNetwork,
    getAztecNodeUrl,
    getContractsEnvFilePath,
    getRequiredEnv,
    loadContractsEnv,
} from '../utils/index.ts';

type ScriptOptions = {
    json: boolean;
    addressArg: string | undefined;
};

function parseOptions(): ScriptOptions {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const json = args.includes('--json');
    const positional = args.filter((arg) => arg !== '--json');
    if (positional.length > 1) {
        console.error(
            'Usage: pnpm read:balance -- [--json] [address]\n' +
                `Too many arguments: ${positional.join(', ')}`
        );
        process.exit(1);
    }
    const unknownFlags = positional.filter((arg) => arg.startsWith('-'));
    if (unknownFlags.length > 0) {
        console.error(
            'Usage: pnpm read:balance -- [--json] [address]\n' +
                `Unknown option(s): ${unknownFlags.join(', ')}`
        );
        process.exit(1);
    }
    return {
        json,
        addressArg: positional[0],
    };
}

function jsonReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

async function main(): Promise<void> {
    const options = parseOptions();
    if (options.json && process.env.ACCOUNT_SILENT_DIAGNOSTICS == null) {
        process.env.ACCOUNT_SILENT_DIAGNOSTICS = 'true';
    }
    loadContractsEnv();

    const aztecNodeUrl = getAztecNodeUrl();
    const network = getAztecNetwork() ?? '(unset)';
    const envFile = getContractsEnvFilePath();
    const addressStr = options.addressArg ?? getRequiredEnv('ACCOUNT_ADDRESS');
    const accountAddress = AztecAddress.fromStringUnsafe(addressStr);

    if (!options.json) {
        console.log('Connecting to Aztec node...');
    }
    const aztecNode = createAztecNodeClient(aztecNodeUrl);
    const balanceWei = await getFeeJuiceBalance(accountAddress, aztecNode);

    const result = {
        network,
        node: aztecNodeUrl,
        envFile,
        address: accountAddress.toString(),
        balanceWei: balanceWei.toString(),
        balance: formatFeeJuiceWei(balanceWei),
    };

    if (options.json) {
        console.log(JSON.stringify(result, jsonReplacer, 2));
        return;
    }

    console.log('\n' + '='.repeat(60));
    console.log('Network        :', result.network);
    console.log('Aztec node     :', result.node);
    console.log('Env file       :', result.envFile);
    console.log('Account        :', result.address);
    console.log('Fee Juice      :', result.balance);
    console.log('Fee Juice (wei):', result.balanceWei);
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Error:', err);
        process.exit(1);
    });
