/**
 * Debug script: prints all available time sources to figure out what
 * self.context.timestamp() returns in the Aztec sandbox.
 *
 * Usage: node --experimental-transform-types scripts/debug-timestamp.ts
 */
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const ETHEREUM_RPC = process.env.ETHEREUM_HOST || 'http://localhost:8545';

function toISO(sec: number | bigint): string {
    return new Date(Number(sec) * 1000).toISOString();
}

/** Recursively convert BigInts to strings for JSON.stringify */
function bigIntReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString() + 'n';
    return value;
}

async function main() {
    const nowSec = Math.floor(Date.now() / 1000);
    console.log('=== System Clock ===');
    console.log(`  Date.now()/1000 = ${nowSec} (${toISO(nowSec)})`);

    // --- L1 (Ethereum / Anvil) ---
    console.log('\n=== L1 (Ethereum) — eth_getBlockByNumber("latest") ===');
    try {
        const res = await fetch(ETHEREUM_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_getBlockByNumber',
                params: ['latest', false],
            }),
        });
        const json = (await res.json()) as { result?: Record<string, unknown> };
        if (json.result) {
            const ts = json.result.timestamp as string;
            const num = Number(BigInt(ts));
            console.log(`  block.number    = ${json.result.number}`);
            console.log(`  block.timestamp = ${ts} = ${num} (${toISO(num)})`);
            console.log(`  diff from system clock = ${num - nowSec} seconds`);
        } else {
            console.log('  (no result)', json);
        }
    } catch (e) {
        console.log(
            '  (failed to connect to',
            ETHEREUM_RPC,
            ')',
            e instanceof Error ? e.message : e
        );
    }

    // --- L2 (Aztec node) ---
    console.log('\n=== L2 (Aztec node) — getBlock("latest") ===');
    const node = createAztecNodeClient(AZTEC_NODE_URL);

    try {
        const blockNum = await node.getBlockNumber();
        console.log(`  getBlockNumber() = ${blockNum}`);
    } catch (e) {
        console.log(
            '  getBlockNumber() failed:',
            e instanceof Error ? e.message : e
        );
    }

    try {
        const block = await (
            node as unknown as {
                getBlock: (n: number | 'latest') => Promise<unknown>;
            }
        ).getBlock('latest');
        if (block && typeof block === 'object') {
            const b = block as Record<string, unknown>;

            // Print top-level keys
            console.log('  Top-level keys:', Object.keys(b).join(', '));

            // Check common timestamp locations
            if (b.timestamp != null) {
                console.log(
                    `  block.timestamp = ${b.timestamp} (${toISO(Number(b.timestamp))})`
                );
            }

            // header.globalVariables.timestamp (Aztec block format)
            const header = b.header as Record<string, unknown> | undefined;
            if (header) {
                console.log('  header keys:', Object.keys(header).join(', '));
                const gv = header.globalVariables as
                    | Record<string, unknown>
                    | undefined;
                if (gv) {
                    console.log(
                        '  header.globalVariables keys:',
                        Object.keys(gv).join(', ')
                    );
                    if (gv.timestamp != null) {
                        const ts = Number(gv.timestamp);
                        console.log(
                            `  header.globalVariables.timestamp = ${gv.timestamp} (${toISO(ts)})`
                        );
                        console.log(
                            `  diff from system clock = ${ts - nowSec} seconds`
                        );
                    }
                }
            }

            // Full dump (truncated)
            const dump = JSON.stringify(block, bigIntReplacer, 2);
            if (dump.length < 5000) {
                console.log('\n  Full block:\n', dump);
            } else {
                console.log(
                    '\n  Full block (first 5000 chars):\n',
                    dump.slice(0, 5000),
                    '\n  ... (truncated)'
                );
            }
        } else {
            console.log('  block is null/empty');
        }
    } catch (e) {
        console.log(
            '  getBlock("latest") failed:',
            e instanceof Error ? e.message : e
        );
    }

    // --- L2 Tips ---
    console.log('\n=== L2 Tips ===');
    try {
        const tips = await (
            node as unknown as { getL2Tips: () => Promise<unknown> }
        ).getL2Tips();
        console.log('  ', JSON.stringify(tips, bigIntReplacer, 2));
    } catch (e) {
        console.log(
            '  getL2Tips() failed:',
            e instanceof Error ? e.message : e
        );
    }

    // --- Node Info ---
    console.log('\n=== Node Info ===');
    try {
        const info = await (
            node as unknown as { getNodeInfo: () => Promise<unknown> }
        ).getNodeInfo();
        console.log('  ', JSON.stringify(info, bigIntReplacer, 2));
    } catch (e) {
        console.log(
            '  getNodeInfo() failed:',
            e instanceof Error ? e.message : e
        );
    }

    console.log('\n=== Summary ===');
    console.log(
        'The value of self.context.timestamp() in a public function during'
    );
    console.log(
        'simulation equals the timestamp of the L2 block used for the simulated'
    );
    console.log(
        'execution context. Compare the values above to find which one it matches.'
    );
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
