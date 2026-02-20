/**
 * Read and print on-chain state changes after initialize_player (or any block).
 * Use the block number from a successful test-core-initialize-player.ts run.
 *
 * Usage (from contracts/ directory):
 *   node --experimental-transform-types scripts/read-initialize-player-state.ts <blockNumber> [playerAddress] [locationId]
 *
 * Example:
 *   node --experimental-transform-types scripts/read-initialize-player-state.ts 42
 *   node --experimental-transform-types scripts/read-initialize-player-state.ts 42 0x2303efff... 1053122916685571866979180276836704323188950954005495816462848571295662080
 *
 * If playerAddress is omitted, all PlayerUpdate events in the block are printed.
 * If locationId is omitted, all PlanetUpdate and PlanetRevealedCoordsUpdate events in the block are printed.
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

type StorageArtifacts = {
    WorldStorage: { events: { WorldUpdate: EventMetadataDefinition } };
    PlayerStorage: { events: { PlayerUpdate: EventMetadataDefinition } };
    PlanetStorage: { events: { PlanetUpdate: EventMetadataDefinition } };
    PlanetRevealedCoordsStorage: {
        events: { PlanetRevealedCoordsUpdate: EventMetadataDefinition };
    };
};

async function loadStorageArtifacts(): Promise<StorageArtifacts> {
    const [ws, ps, pls, prcs] = await Promise.all([
        import('./artifacts/WorldStorage.ts'),
        import('./artifacts/PlayerStorage.ts'),
        import('./artifacts/PlanetStorage.ts'),
        import('./artifacts/PlanetRevealedCoordsStorage.ts'),
    ]);
    return {
        WorldStorage:
            ws.WorldStorageContract as unknown as StorageArtifacts['WorldStorage'],
        PlayerStorage:
            ps.PlayerStorageContract as unknown as StorageArtifacts['PlayerStorage'],
        PlanetStorage:
            pls.PlanetStorageContract as unknown as StorageArtifacts['PlanetStorage'],
        PlanetRevealedCoordsStorage:
            prcs.PlanetRevealedCoordsStorageContract as unknown as StorageArtifacts['PlanetRevealedCoordsStorage'],
    };
}

async function printWorldFromEvents(
    ctx: TestContext,
    blockNumber: number,
    artifacts: StorageArtifacts
): Promise<void> {
    const WorldStorage = ctx.contracts['WorldStorage'];
    if (!WorldStorage?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.WorldStorage.events.WorldUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: WorldStorage.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        block_number?: number;
        state?: Record<string, unknown>;
    }[];
    const ev = events.filter((e) => toStr(e?.id) === '0').pop();
    if (!ev?.state) {
        console.log('\n  World: no WorldUpdate (id=0) in this block.');
        return;
    }
    const s = ev.state;
    console.log('\n  📦 World (on-chain, id=0):');
    console.log(
        '     paused:',
        Boolean(s.paused),
        '| radius:',
        toStr(s.radius),
        '| planet_ids_count:',
        toStr(s.planet_ids_count),
        '| player_ids_count:',
        toStr(s.player_ids_count),
        '| revealed_planet_ids_count:',
        toStr(s.revealed_planet_ids_count)
    );
    console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
}

async function printPlayerFromEvents(
    ctx: TestContext,
    blockNumber: number,
    playerFilter: string | undefined,
    artifacts: StorageArtifacts
): Promise<void> {
    const PlayerStorage = ctx.contracts['PlayerStorage'];
    if (!PlayerStorage?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.PlayerStorage.events.PlayerUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: PlayerStorage.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        block_number?: number;
        state?: Record<string, unknown>;
    }[];
    const filtered = playerFilter
        ? events.filter((e) => toStr(e?.id) === playerFilter)
        : events;
    if (filtered.length === 0) {
        console.log(
            '\n  👤 Player: no PlayerUpdate' +
                (playerFilter ? ` for ${playerFilter}` : '') +
                ' in this block.'
        );
        return;
    }
    for (const ev of filtered) {
        if (!ev?.state) continue;
        const s = ev.state;
        console.log('\n  👤 Player (on-chain, id =', toStr(ev.id), '):');
        console.log(
            '     init_timestamp:',
            toStr(s.init_timestamp),
            '| home_planet_id:',
            toStr(s.home_planet_id),
            '| score:',
            toStr(s.score),
            '| space_junk_limit:',
            toStr(s.space_junk_limit),
            '| claimed_ships:',
            Boolean(s.claimed_ships)
        );
        console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
    }
}

async function printPlanetFromEvents(
    ctx: TestContext,
    blockNumber: number,
    locationFilter: string | undefined,
    artifacts: StorageArtifacts
): Promise<void> {
    const PlanetStorage = ctx.contracts['PlanetStorage'];
    if (!PlanetStorage?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.PlanetStorage.events.PlanetUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: PlanetStorage.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        block_number?: number;
        state?: Record<string, unknown>;
    }[];
    const filtered = locationFilter
        ? events.filter((e) => toStr(e?.id) === locationFilter)
        : events;
    if (filtered.length === 0) {
        console.log(
            '\n  🌍 Planet: no PlanetUpdate' +
                (locationFilter ? ` for location_id ${locationFilter}` : '') +
                ' in this block.'
        );
        return;
    }
    for (const ev of filtered) {
        if (!ev?.state) continue;
        const s = ev.state;
        console.log(
            '\n  🌍 Planet (on-chain, location_id =',
            toStr(ev.id),
            '):'
        );
        console.log(
            '     perlin:',
            s.perlin,
            '| owner:',
            toStr(s.owner),
            '| planet_level:',
            s.planet_level,
            '| is_home_planet:',
            Boolean(s.is_home_planet),
            '| is_initialized:',
            Boolean(s.is_initialized)
        );
        console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
    }
}

async function printPlanetRevealedCoordsFromEvents(
    ctx: TestContext,
    blockNumber: number,
    locationFilter: string | undefined,
    artifacts: StorageArtifacts
): Promise<void> {
    const PRC = ctx.contracts['PlanetRevealedCoordsStorage'];
    if (!PRC?.address) return;
    const raw = await getPublicEvents(
        ctx.node,
        artifacts.PlanetRevealedCoordsStorage.events.PlanetRevealedCoordsUpdate,
        {
            fromBlock: BlockNumber(blockNumber),
            toBlock: BlockNumber(blockNumber + 1),
            contractAddress: PRC.address,
        }
    );
    const events = raw.map((e) => e.event) as {
        id: unknown;
        block_number?: number;
        state?: Record<string, unknown>;
    }[];
    const filtered = locationFilter
        ? events.filter((e) => toStr(e?.id) === locationFilter)
        : events;
    if (filtered.length === 0) {
        console.log(
            '\n  📍 PlanetRevealedCoords: no update' +
                (locationFilter ? ` for location_id ${locationFilter}` : '') +
                ' in this block.'
        );
        return;
    }
    for (const ev of filtered) {
        if (!ev?.state) continue;
        const s = ev.state;
        console.log(
            '\n  📍 PlanetRevealedCoords (on-chain, location_id =',
            toStr(ev.id),
            '):'
        );
        console.log(
            '     location_id:',
            toStr(s.location_id),
            '| x:',
            toStr(s.x),
            '| y:',
            toStr(s.y),
            '| revealer:',
            toStr(s.revealer)
        );
        console.log('     full:', JSON.stringify(s, jsonReplacer, 2));
    }
}

async function main() {
    const args = process.argv.slice(2);
    const blockStr = args[0];
    const playerAddress = args[1];
    const locationId = args[2];

    if (!blockStr || !/^\d+$/.test(blockStr)) {
        console.error(
            'Usage: node scripts/read-initialize-player-state.ts <blockNumber> [playerAddress] [locationId]'
        );
        process.exit(1);
    }
    const blockNumber = parseInt(blockStr, 10);

    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    let artifacts: StorageArtifacts;
    try {
        artifacts = await loadStorageArtifacts();
    } catch (e) {
        console.error(
            'Failed to load storage artifacts:',
            (e as Error).message
        );
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('State changes in block', blockNumber);
    if (playerAddress) console.log('  Player filter:', playerAddress);
    if (locationId) console.log('  Location filter:', locationId);
    console.log('='.repeat(60));

    await printWorldFromEvents(ctx, blockNumber, artifacts);
    await printPlayerFromEvents(ctx, blockNumber, playerAddress, artifacts);
    await printPlanetFromEvents(ctx, blockNumber, locationId, artifacts);
    await printPlanetRevealedCoordsFromEvents(
        ctx,
        blockNumber,
        locationId,
        artifacts
    );

    console.log('\n' + '='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
