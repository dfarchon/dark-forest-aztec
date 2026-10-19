/**
 * Delete the PXE/wallet cache for the active network only.
 * Reads PXE_STORE_DIR from networks/<AZTEC_NETWORK>.env. Does not touch
 * keys, networks/*.env, .env, or scripts/.test-accounts.json.
 *
 * Run from contracts: pnpm clean:runtime
 */
import fs from 'fs';
import path from 'path';

import { loadNetworkEnv, resolvePxeStoreDir } from '../runtime/env.ts';
import { requireNetworkConfigured } from '../runtime/network.ts';

requireNetworkConfigured();

const ctx = loadNetworkEnv();
const storeDir = resolvePxeStoreDir();
const rel = path.relative(process.cwd(), storeDir);

if (!fs.existsSync(storeDir)) {
    console.log(`PXE store already absent for ${ctx.network}: ${rel}`);
    process.exit(0);
}

fs.rmSync(storeDir, { recursive: true, force: true });
console.log(`Removed PXE store for ${ctx.network}: ${rel}`);
