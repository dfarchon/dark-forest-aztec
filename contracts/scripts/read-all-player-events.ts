/**
 * Read all PlayerStorage.PlayerUpdated events from the chain and print (or output JSON).
 *
 * Prerequisites: .env with AZTEC_NODE_URL and PLAYER_STORAGE_CONTRACT_ADDRESS (or run test-setup/deploy first).
 *
 * Run: pnpm exec tsx scripts/read-all-player-events.ts
 *      pnpm exec tsx scripts/read-all-player-events.ts --json   # one JSON array to stdout
 */
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { PlayerStorageContract } from './artifacts/PlayerStorage.ts';
import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import { getTestContext } from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function toStr(v: unknown): string {
    if (typeof v === 'bigint') return String(v);
    if (v === undefined || v === null) return '';
    return String(v);
}

type PlayerStateFromEvent = {
    is_initialized: boolean;
    player: string;
    init_timestamp: string | number;
    home_planet_id: string;
    last_reveal_timestamp: string | number;
    score: string | number;
    space_junk: string | number;
    space_junk_limit: string | number;
    claimed_ships: boolean;
};

function eventStateToPlayer(s: Record<string, unknown>): PlayerStateFromEvent {
    return {
        is_initialized: Boolean(s.is_initialized),
        player: toStr(s.player),
        init_timestamp: toStr(s.init_timestamp) || 0,
        home_planet_id: toStr(s.home_planet_id ?? 0),
        last_reveal_timestamp: toStr(s.last_reveal_timestamp) || 0,
        score: toStr(s.score) || 0,
        space_junk: toStr(s.space_junk) || 0,
        space_junk_limit: toStr(s.space_junk_limit) || 0,
        claimed_ships: Boolean(s.claimed_ships),
    };
}

type DecodedPlayerUpdated = {
    player: unknown;
    block_number: unknown;
    state: Record<string, unknown>;
};

async function main() {
    const jsonOnly = process.argv.includes('--json');

    if (!jsonOnly) {
        console.log('🔗 Loading context and node...');
    }
    const ctx = await getTestContext();

    const PlayerStorage = ctx.contracts['PlayerStorage'];
    const contractAddress = PlayerStorage?.address;
    if (!contractAddress) {
        throw new Error('PlayerStorage contract not loaded (missing PLAYER_STORAGE_CONTRACT_ADDRESS in .env?)');
    }

    const latestBlock = Number(await ctx.node.getBlockNumber());
    const fromBlock = 0;
    const blockCount = latestBlock + 1;

    if (!jsonOnly) {
        console.log('📥 Fetching PlayerUpdated events from block', fromBlock, 'to', latestBlock, '...');
    }

    const events = await getDecodedPublicEvents<DecodedPlayerUpdated>(
        ctx.node,
        PlayerStorageContract.events.PlayerUpdated,
        fromBlock,
        blockCount,
        { contractAddress }
    );

    const rows = events.map((ev) => ({
        player_address: toStr(ev.player),
        block_number: typeof ev.block_number === 'bigint' ? Number(ev.block_number) : Number(ev.block_number ?? 0),
        state: eventStateToPlayer(ev.state),
    }));

    if (jsonOnly) {
        console.log(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2));
        return;
    }

    console.log('✅ Total PlayerUpdated events:', rows.length);
    console.log('');
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        console.log('─'.repeat(60));
        console.log(`[${i + 1}/${rows.length}] player=${r.player_address} block=${r.block_number}`);
        console.log(JSON.stringify(r.state, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2));
        console.log('');
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
