/**
 * Read and print on-chain state changes after a move (or any block).
 * Use the block number from a successful test-move.ts run.
 *
 * Usage (from contracts/ directory):
 *   node --experimental-transform-types scripts/read-move-state.ts <blockNumber> [sourceLoc] [targetLoc]
 *
 * Example:
 *   node --experimental-transform-types scripts/read-move-state.ts 50
 *   node --experimental-transform-types scripts/read-move-state.ts 50 1053122916685571866979180276836704323188950954005495816462848571295662080 1053122916685571866979180276836704323188950954005495816462848571295662081
 *
 * If sourceLoc/targetLoc omitted, all PlanetUpdate and ArrivalUpdate events in the block are printed.
 */
import { getPublicEvents } from '@aztec/aztec.js/events';
import { BlockNumber } from '@aztec/foundation/branded-types';
import type { EventMetadataDefinition } from '@aztec/stdlib/abi';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { getTestContext, type TestContext } from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function toStr(v: unknown): string {
    if (v === undefined || v === null) return '';
    if (typeof v === 'bigint') return String(v);
    return String(v);
}

function jsonReplacer(_k: string, v: unknown): unknown {
    return typeof v === 'bigint' ? String(v) : v;
}

type MoveArtifacts = {
    WorldStorage: { events: { WorldUpdate: EventMetadataDefinition } };
    PlanetStorage: { events: { PlanetUpdate: EventMetadataDefinition } };
    ArrivalStorage: { events: { ArrivalUpdate: EventMetadataDefinition } };
};

async function loadArtifacts(): Promise<MoveArtifacts> {
    const [ws, pls, arr] = await Promise.all([
        import('./artifacts/WorldStorage.ts'),
        import('./artifacts/PlanetStorage.ts'),
        import('./artifacts/ArrivalStorage.ts'),
    ]);
    return {
        WorldStorage:
            ws.WorldStorageContract as unknown as MoveArtifacts['WorldStorage'],
        PlanetStorage:
            pls.PlanetStorageContract as unknown as MoveArtifacts['PlanetStorage'],
        ArrivalStorage:
            arr.ArrivalStorageContract as unknown as MoveArtifacts['ArrivalStorage'],
    };
}

async function printWorld(
    ctx: TestContext,
    blockNumber: number,
    artifacts: MoveArtifacts
): Promise<void> {
    const W = ctx.contracts['WorldStorage'];
    if (!W?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.WorldStorage.events.WorldUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: W.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        state?: Record<string, unknown>;
    }[];
    const ev = events.filter((e) => toStr(e?.id) === '0').pop();
    if (!ev?.state) {
        console.log('\n  World: no WorldUpdate (id=0) in this block.');
        return;
    }
    const s = ev.state;
    console.log('\n  📦 World (on-chain):');
    console.log(
        '     planet_events_count:',
        toStr(s.planet_events_count),
        '| radius:',
        toStr(s.radius),
        '| player_ids_count:',
        toStr(s.player_ids_count)
    );
    console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
}

async function printPlanets(
    ctx: TestContext,
    blockNumber: number,
    sourceLoc: string | undefined,
    targetLoc: string | undefined,
    artifacts: MoveArtifacts
): Promise<void> {
    const P = ctx.contracts['PlanetStorage'];
    if (!P?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.PlanetStorage.events.PlanetUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: P.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        state?: Record<string, unknown>;
    }[];
    const filter = (e: { id?: unknown }) => {
        if (!sourceLoc && !targetLoc) return true;
        const id = toStr(e?.id);
        return (
            (sourceLoc && id === sourceLoc) || (targetLoc && id === targetLoc)
        );
    };
    const filtered = events.filter(filter);
    if (filtered.length === 0) {
        console.log(
            '\n  🌍 Planet: no PlanetUpdate for given locations in this block.'
        );
        return;
    }
    for (const ev of filtered) {
        if (!ev?.state) continue;
        const s = ev.state;
        console.log('\n  🌍 Planet (location_id =', toStr(ev.id), '):');
        console.log(
            '     owner:',
            toStr(s.owner),
            '| population:',
            toStr(s.population),
            '| silver:',
            toStr(s.silver),
            '| is_home_planet:',
            Boolean(s.is_home_planet),
            '| is_initialized:',
            Boolean(s.is_initialized)
        );
        console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
    }
}

async function printArrivals(
    ctx: TestContext,
    blockNumber: number,
    artifacts: MoveArtifacts
): Promise<void> {
    const A = ctx.contracts['ArrivalStorage'];
    if (!A?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.ArrivalStorage.events.ArrivalUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: A.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        state?: Record<string, unknown>;
    }[];
    if (events.length === 0) {
        console.log('\n  🚀 Arrival: no ArrivalUpdate in this block.');
        return;
    }
    for (const ev of events) {
        if (!ev?.state) continue;
        const s = ev.state;
        console.log('\n  🚀 Arrival (id =', toStr(ev.id), '):');
        console.log(
            '     player:',
            toStr(s.player),
            '| from_planet:',
            toStr(s.from_planet),
            '| to_planet:',
            toStr(s.to_planet),
            '| pop_arriving:',
            toStr(s.pop_arriving),
            '| arrival_time:',
            toStr(s.arrival_time)
        );
        console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
    }
}

async function main() {
    const args = process.argv.slice(2);
    const blockStr = args[0];
    const sourceLoc = args[1];
    const targetLoc = args[2];

    if (!blockStr || !/^\d+$/.test(blockStr)) {
        console.error(
            'Usage: node scripts/read-move-state.ts <blockNumber> [sourceLoc] [targetLoc]'
        );
        process.exit(1);
    }
    const blockNumber = parseInt(blockStr, 10);

    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    let artifacts: MoveArtifacts;
    try {
        artifacts = await loadArtifacts();
    } catch (e) {
        console.error('Failed to load artifacts:', (e as Error).message);
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('State changes in block', blockNumber, '(after move)');
    if (sourceLoc) console.log('  source_loc:', sourceLoc);
    if (targetLoc) console.log('  target_loc:', targetLoc);
    console.log('='.repeat(60));

    await printWorld(ctx, blockNumber, artifacts);
    await printPlanets(ctx, blockNumber, sourceLoc, targetLoc, artifacts);
    await printArrivals(ctx, blockNumber, artifacts);

    console.log('\n' + '='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
