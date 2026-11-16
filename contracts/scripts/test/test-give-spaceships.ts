/**
 * One give_spaceships call on an already initialized home planet.
 *
 * Prerequisites: `pnpm deploy:run` + `pnpm bootstrap`, then test-core-initialize-player for the same user.
 *
 * Usage (from contracts/):
 *   pnpm exec tsx scripts/test/test-give-spaceships.ts [userIndex]
 */
import { getPublicEvents } from '@aztec-labs/aztec.js/events';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';
import { Gas } from '@aztec-labs/stdlib/gas';
import { getGasLimits } from '@aztec-labs/wallet-sdk/base-wallet';

import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { unwrapSimulateResult } from '../utils/index.ts';
import { logFeeMeasure } from './feeMeasureLog.ts';
import {
    getTestContext,
    sendTimestampRefreshTx,
    type TestContext,
} from './test-setup.ts';
import { parseUserIndex } from './testHelpers.ts';

const aztecZero =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

async function getL2BlockTimestamp(ctx: TestContext): Promise<bigint> {
    const block = await (
        ctx.node as unknown as {
            getBlock: (n: number | 'latest') => Promise<
                | {
                      header?: { globalVariables?: { timestamp?: unknown } };
                      timestamp?: number;
                  }
                | undefined
            >;
        }
    ).getBlock('latest');

    let ts: bigint | undefined;
    if (block?.header?.globalVariables?.timestamp != null) {
        ts = toBigint(block.header.globalVariables.timestamp);
    } else if (block?.timestamp != null) {
        ts = BigInt(Number(block.timestamp));
    }
    if (ts == null) {
        throw new Error('Could not read L2 block timestamp');
    }
    return ts;
}

async function loadStateEvent(
    ctx: TestContext,
    artifact: string,
    exportName: string,
    eventName: string,
    contractName: string,
    id: string
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = 0;
    const limit = latestBlock - from + 1;
    try {
        const mod = (await import(artifact)) as Record<
            string,
            {
                events?: Record<string, Parameters<typeof getPublicEvents>[1]>;
            }
        >;
        const contract = mod[exportName];
        const event = contract?.events?.[eventName];
        if (!event) return null;
        const raw = await getPublicEvents(ctx.node, event, {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(from + limit),
            contractAddress: ctx.contracts[contractName]?.address,
        });
        const events = raw.events.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const want = id.toLowerCase();
        const ev = events
            .filter((e) => String(e?.id).toLowerCase() === want)
            .pop();
        return ev?.state ?? null;
    } catch {
        return null;
    }
}

function planetEventsZero(): Record<string, unknown> {
    return { events: Array(20).fill({ id: 0 }), count: 0, last_updated: 0 };
}

function arrivalZero(): Record<string, unknown> {
    return {
        id: 0,
        player: aztecZero,
        from_planet: 0n,
        to_planet: 0n,
        pop_arriving: 0n,
        silver_moved: 0n,
        departure_time: 0,
        arrival_time: 0,
        arrival_type: 0,
        carried_artifact_id: 0n,
        distance: 0n,
    };
}

function artifactZero(): Record<string, unknown> {
    return {
        planet_discovered_on: 0n,
        rarity: 0,
        planet_biome: 0,
        minted_at_timestamp: 0,
        discoverer: aztecZero,
        artifact_type: 0,
        activations: 0n,
        last_activated: 0,
        last_deactivated: 0,
        wormhole_to: 0n,
        owner: aztecZero,
        controller: aztecZero,
        last_updated: 0,
    };
}

function artifactLocationZero(): Record<string, unknown> {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

function planetArtifactsZero(): Record<string, unknown> {
    return { ids: Array(20).fill(0n), count: 0, last_updated: 0 };
}

async function main() {
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);
    const Vault = ctx.contracts['ArtifactVault'];
    const Config = ctx.contracts['Config'];
    if (!Vault || !Config) {
        throw new Error('ArtifactVault or Config not loaded');
    }

    const user = ctx.accounts.users[userIndex]!;
    const locationId =
        ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);

    const planet = await loadStateEvent(
        ctx,
        '../artifacts/PlanetStorage.ts',
        'PlanetStorageContract',
        'PlanetUpdate',
        'PlanetStorage',
        String(locationId)
    );
    const player = await loadStateEvent(
        ctx,
        '../artifacts/PlayerStorage.ts',
        'PlayerStorageContract',
        'PlayerUpdate',
        'PlayerStorage',
        user.toString()
    );
    if (!planet || !player) {
        throw new Error(
            'Home planet or player missing. Run test-core-initialize-player first.'
        );
    }

    const planetEvents =
        (await loadStateEvent(
            ctx,
            '../artifacts/PlanetEventsStorage.ts',
            'PlanetEventsStorageContract',
            'PlanetEventsUpdate',
            'PlanetEventsStorage',
            String(locationId)
        )) ?? planetEventsZero();
    const planetArtifacts =
        (await loadStateEvent(
            ctx,
            '../artifacts/PlanetArtifactsStorage.ts',
            'PlanetArtifactsStorageContract',
            'PlanetArtifactsUpdate',
            'PlanetArtifactsStorage',
            String(locationId)
        )) ?? planetArtifactsZero();

    const spaceshipsConfig = unwrapSimulateResult(
        await Config.methods.get_spaceships_config().simulate({ from: user })
    );

    await sendTimestampRefreshTx(ctx);
    const timestamp = await getL2BlockTimestamp(ctx);

    const args = [
        locationId,
        timestamp,
        planet,
        planetArtifacts,
        planetEvents,
        Array.from({ length: 20 }, () => arrivalZero()),
        Array.from({ length: 20 }, () => artifactZero()),
        Array.from({ length: 20 }, () => artifactLocationZero()),
        player,
        spaceshipsConfig,
    ] as const;

    console.log('\n🎮 Calling ArtifactVault.give_spaceships() (private)...');
    const payload = await Vault.methods
        .give_spaceships(...args)
        .request(ctx.sendOpts(user));
    const txSimResult = await Vault.wallet.simulateTx(payload, { from: user });
    const gasUsed = txSimResult.gasUsed;
    const { txsLimits } = await ctx.node.getNodeInfo();
    const suggestedLimits = getGasLimits(gasUsed, Gas.from(txsLimits.gas), 0.1);
    console.log('   ✅ Simulate passed.');
    console.log(
        `   totalGas:  DA=${gasUsed.totalGas.daGas}  L2=${gasUsed.totalGas.l2Gas}`
    );
    console.log(
        `   publicGas: DA=${gasUsed.publicGas.daGas}  L2=${gasUsed.publicGas.l2Gas}`
    );
    console.log(
        `   billedGas: DA=${gasUsed.billedGas.daGas}  L2=${gasUsed.billedGas.l2Gas}`
    );
    console.log(
        `   gasLimits: DA=${suggestedLimits.gasLimits.daGas}  L2=${suggestedLimits.gasLimits.l2Gas}`
    );

    const { receipt } = await Vault.methods
        .give_spaceships(...args)
        .send(ctx.sendOpts(user));
    logFeeMeasure('give_spaceships', gasUsed, receipt);
    console.log('✅ TEST SUCCESS — give_spaceships committed');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
