/**
 * Read and print the public Fee Juice balance for ACCOUNT_ADDRESS.
 *
 *   pnpm admin:balance
 *   pnpm admin:balance --json
 *   pnpm admin:balance <aztec-address>
 */
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import { getFeeJuiceBalance } from '@aztec-labs/aztec.js/utils';
import path from 'path';

import { getAztecNodeUrlFromNetwork } from '../deploy/session.ts';
import { getNetworkValue, loadNetworkEnv } from '../runtime/env.ts';
import { requireNetworkConfigured } from '../runtime/network.ts';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.ts';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.ts';
import { jsonReplacer, parseAdminArgs } from './helpers.ts';

const USAGE = 'Usage: pnpm admin:balance [--json] [address]';

function parseOptions(): { json: boolean; addressArg: string | undefined } {
    const parsed = parseAdminArgs(process.argv.slice(2), {
        flags: ['json'],
        usage: USAGE,
    });
    if (parsed.id) {
        throw new Error(`Unknown option: --id\n${USAGE}`);
    }
    if (parsed.positionals.length > 1) {
        throw new Error(
            `${USAGE}\nToo many arguments: ${parsed.positionals.join(', ')}`
        );
    }
    return {
        json: parsed.flags.has('json'),
        addressArg: parsed.positionals[0],
    };
}

async function main(): Promise<void> {
    const options = parseOptions();
    requireNetworkConfigured();
    const ctx = loadNetworkEnv();
    const nodeUrl = getAztecNodeUrlFromNetwork();
    const addressStr = options.addressArg ?? getNetworkValue('ACCOUNT_ADDRESS');
    if (!addressStr) {
        throw new Error(
            'Missing ACCOUNT_ADDRESS. Pass an address or run pnpm account:generate.'
        );
    }
    const accountAddress = AztecAddress.fromStringUnsafe(addressStr);

    if (!options.json) console.log('Connecting to Aztec node...');
    const balanceWei = await getFeeJuiceBalance(
        accountAddress,
        createTolerantAztecNodeClient(nodeUrl)
    );
    const result = {
        network: ctx.network,
        node: nodeUrl,
        envFile: path.relative(process.cwd(), ctx.networkFilePath),
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

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
