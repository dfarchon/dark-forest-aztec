/**
 * Offline Schnorr initializerless account generation.
 * Always appends a new ACCOUNT_* block to networks/<AZTEC_NETWORK>.env.
 * Earlier lines are left unchanged. Later keys win when the file is read.
 *
 * Run from contracts: pnpm account:generate
 */
import path from 'path';

import { appendAccountToNetworkEnv, generateAccountKeys } from './account.ts';
import { loadNetworkEnv } from './env.ts';
import { requireNetworkConfigured } from './network.ts';

requireNetworkConfigured();

const ctx = loadNetworkEnv();
const rel = path.relative(process.cwd(), ctx.networkFilePath);
const keys = await generateAccountKeys();
appendAccountToNetworkEnv(keys);

console.log(
    [
        '\nAccount generated.',
        `  Network: ${ctx.network}`,
        `  Config:  ${rel}`,
        `  Address: ${keys.address}`,
        '  ACCOUNT_* was appended. Earlier lines in the file were not changed.',
        '',
    ].join('\n')
);
