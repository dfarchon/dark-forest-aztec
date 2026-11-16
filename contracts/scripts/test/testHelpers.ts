/**
 * Shared helpers for contracts/scripts/test harnesses.
 * Loads *Update public logs the same way the indexer does.
 */
import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { ContractBase } from '@aztec-labs/aztec.js/contracts';
import { getPublicEvents } from '@aztec-labs/aztec.js/events';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';
import { Gas } from '@aztec-labs/stdlib/gas';
import { getGasLimits } from '@aztec-labs/wallet-sdk/base-wallet';

import { logFeeMeasure } from './feeMeasureLog.ts';
import { sendTimestampRefreshTx, type TestContext } from './test-setup.ts';

export const AZTEC_ZERO =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

export function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

export async function getL2BlockTimestamp(ctx: TestContext): Promise<bigint> {
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

function idMatches(rawId: unknown, id: string): boolean {
    const want = id.toLowerCase();
    const asStr = String(rawId).toLowerCase();
    if (asStr === want) return true;
    try {
        return BigInt(String(rawId)) === BigInt(id);
    } catch {
        return false;
    }
}

async function loadStateEventWindow(
    ctx: TestContext,
    artifact: string,
    exportName: string,
    eventName: string,
    contractName: string,
    id: string,
    fromBlock: number,
    toBlock: number
): Promise<Record<string, unknown> | null> {
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
            fromBlock: BlockNumber(fromBlock),
            toBlock: BlockNumber(toBlock),
            contractAddress: ctx.contracts[contractName]?.address,
        });
        const events = raw.events.map((e) => e.event) as {
            id: unknown;
            state?: Record<string, unknown>;
        }[];
        const ev = events.filter((e) => idMatches(e?.id, id)).pop();
        return ev?.state ?? null;
    } catch (err) {
        console.warn(
            `[loadStateEvent] ${eventName} id=${id}:`,
            err instanceof Error ? err.message : err
        );
        return null;
    }
}

export async function loadStateEvent(
    ctx: TestContext,
    artifact: string,
    exportName: string,
    eventName: string,
    contractName: string,
    id: string,
    opts?: { lookback?: number; page?: boolean }
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    // Keep each RPC window small: getPublicEvents truncates (~20), so a wide
    // single lookback returns the oldest rows and misses the tip.
    const window = opts?.lookback ?? 30;
    const page = opts?.page !== false;

    if (!page) {
        const from = Math.max(0, latestBlock - window);
        return loadStateEventWindow(
            ctx,
            artifact,
            exportName,
            eventName,
            contractName,
            id,
            from,
            latestBlock + 1
        );
    }

    // Tip → genesis in small windows so older Player/Planet updates are still found.
    for (let to = latestBlock + 1; to > 0; to -= window) {
        const from = Math.max(0, to - window);
        const got = await loadStateEventWindow(
            ctx,
            artifact,
            exportName,
            eventName,
            contractName,
            id,
            from,
            to
        );
        if (got) return got;
    }
    return null;
}

/** Prefer packed storage utility when present (avoids log-scan races). */
export async function loadPlanetFromStorage(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown> | null> {
    const PlanetStorage = ctx.contracts['PlanetStorage'];
    if (!PlanetStorage) return loadPlanet(ctx, locationId);
    const from = ctx.accounts.admin;
    try {
        const methods = PlanetStorage.methods as Record<
            string,
            (...a: unknown[]) => { simulate: (o: unknown) => Promise<unknown> }
        >;
        const fn =
            methods.get_planet_unconstrained ?? methods.get_unconstrained;
        if (!fn) return loadPlanet(ctx, locationId);
        const { unwrapSimulateResult } = await import('../utils/index.ts');
        const raw = unwrapSimulateResult(
            await fn(locationId).simulate({ from })
        ) as Record<string, unknown> | undefined;
        if (!raw || raw.is_initialized === false) {
            // Fall back to events if storage empty / zero.
            return loadPlanet(ctx, locationId);
        }
        return raw;
    } catch {
        return loadPlanet(ctx, locationId);
    }
}

export function loadPlanet(ctx: TestContext, locationId: bigint) {
    return loadStateEvent(
        ctx,
        '../artifacts/PlanetStorage.ts',
        'PlanetStorageContract',
        'PlanetUpdate',
        'PlanetStorage',
        String(locationId)
    );
}

export function loadPlayer(ctx: TestContext, address: string) {
    return loadStateEvent(
        ctx,
        '../artifacts/PlayerStorage.ts',
        'PlayerStorageContract',
        'PlayerUpdate',
        'PlayerStorage',
        address
    );
}

/**
 * On-chain init check via PlayerStorage (avoids event lookback races).
 * Event scans can miss older PlayerUpdate rows when getPublicEvents truncates.
 */
export async function isPlayerInitialized(
    ctx: TestContext,
    address: AztecAddress | string
): Promise<boolean> {
    const PlayerStorage = ctx.contracts['PlayerStorage'];
    if (!PlayerStorage) {
        const existing = await loadPlayer(ctx, String(address));
        return existing != null && toBigint(existing.init_timestamp) > 0n;
    }
    const from = ctx.accounts.admin;
    const methods = PlayerStorage.methods as Record<
        string,
        (...a: unknown[]) => { simulate: (o: unknown) => Promise<unknown> }
    >;
    const fn = methods.is_initialized_unconstrained ?? methods.is_initialized;
    if (!fn) {
        const existing = await loadPlayer(ctx, String(address));
        return existing != null && toBigint(existing.init_timestamp) > 0n;
    }
    const { unwrapSimulateResult } = await import('../utils/index.ts');
    return Boolean(unwrapSimulateResult(await fn(address).simulate({ from })));
}

/** On-chain check via PlanetRevealedCoordsStorage.is_initialized. */
export async function isPlanetRevealed(
    ctx: TestContext,
    locationId: bigint
): Promise<boolean> {
    const Revealed = ctx.contracts['PlanetRevealedCoordsStorage'];
    if (!Revealed) {
        const existing = await loadStateEvent(
            ctx,
            '../artifacts/PlanetRevealedCoordsStorage.ts',
            'PlanetRevealedCoordsStorageContract',
            'PlanetRevealedCoordsUpdate',
            'PlanetRevealedCoordsStorage',
            String(locationId)
        );
        return existing != null;
    }
    const from = ctx.accounts.admin;
    const methods = Revealed.methods as Record<
        string,
        (...a: unknown[]) => { simulate: (o: unknown) => Promise<unknown> }
    >;
    const fn = methods.is_initialized_unconstrained ?? methods.is_initialized;
    if (!fn) return false;
    const { unwrapSimulateResult } = await import('../utils/index.ts');
    return Boolean(
        unwrapSimulateResult(await fn(locationId).simulate({ from }))
    );
}

export async function loadWorld(
    ctx: TestContext
): Promise<Record<string, unknown> | null> {
    // World updates are sparse. Walk tip → genesis in small windows so
    // getPublicEvents truncation cannot hide the latest WorldUpdate.
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const window = 20;
    for (let to = latestBlock + 1; to > 0; to -= window) {
        const from = Math.max(0, to - window);
        const got = await loadStateEvent(
            ctx,
            '../artifacts/WorldStorage.ts',
            'WorldStorageContract',
            'WorldUpdate',
            'WorldStorage',
            '0',
            { lookback: latestBlock - from }
        );
        // loadStateEvent always uses latest-lookback; do a direct scan instead.
        try {
            const mod = await import('../artifacts/WorldStorage.ts');
            const raw = await getPublicEvents(
                ctx.node,
                mod.WorldStorageContract.events.WorldUpdate,
                {
                    fromBlock: BlockNumber(from),
                    toBlock: BlockNumber(to),
                    contractAddress: ctx.contracts['WorldStorage']?.address,
                }
            );
            const ev = raw.events
                .map(
                    (e) =>
                        e.event as {
                            id: unknown;
                            state?: Record<string, unknown>;
                        }
                )
                .filter(
                    (e) => String(e.id) === '0' || BigInt(String(e.id)) === 0n
                )
                .pop();
            if (ev?.state) return ev.state;
        } catch {
            /* continue */
        }
        void got;
    }
    return null;
}

export function loadPlanetArtifacts(ctx: TestContext, locationId: bigint) {
    return loadStateEvent(
        ctx,
        '../artifacts/PlanetArtifactsStorage.ts',
        'PlanetArtifactsStorageContract',
        'PlanetArtifactsUpdate',
        'PlanetArtifactsStorage',
        String(locationId)
    );
}

/** Latest PlanetEvents for a location — tip→genesis paging. */
export function loadPlanetEvents(ctx: TestContext, locationId: bigint) {
    return loadStateEvent(
        ctx,
        '../artifacts/PlanetEventsStorage.ts',
        'PlanetEventsStorageContract',
        'PlanetEventsUpdate',
        'PlanetEventsStorage',
        String(locationId)
    );
}

/**
 * Load an Arrival by id. Prefers packed storage utility (no log truncation),
 * falls back to tip→genesis ArrivalUpdate paging.
 */
export async function loadArrival(
    ctx: TestContext,
    arrivalId: bigint | number | string
): Promise<Record<string, unknown> | null> {
    const ArrivalStorage = ctx.contracts['ArrivalStorage'];
    const from = ctx.accounts.admin;
    if (ArrivalStorage) {
        try {
            const methods = ArrivalStorage.methods as Record<
                string,
                (...a: unknown[]) => {
                    simulate: (o: unknown) => Promise<unknown>;
                }
            >;
            const fn = methods.get_arrival_unconstrained;
            if (fn) {
                const { unwrapSimulateResult } =
                    await import('../utils/index.ts');
                const raw = unwrapSimulateResult(
                    await fn(arrivalId).simulate({ from })
                ) as Record<string, unknown> | undefined;
                if (
                    raw &&
                    (toBigint(raw.arrival_time) > 0n ||
                        toBigint(raw.id) !== 0n ||
                        toBigint(raw.silver_moved) > 0n ||
                        toBigint(raw.pop_arriving) > 0n)
                ) {
                    return raw;
                }
            }
        } catch {
            /* fall through to events */
        }
    }
    return loadStateEvent(
        ctx,
        '../artifacts/ArrivalStorage.ts',
        'ArrivalStorageContract',
        'ArrivalUpdate',
        'ArrivalStorage',
        String(arrivalId)
    );
}

export function worldZero() {
    return {
        paused: false,
        radius: 53_000n,
        misc_nonce: 0n,
        next_change_block: 0,
    };
}

export function planetArtifactsZero() {
    return { ids: Array(20).fill(0n), count: 0, last_updated: 0 };
}

export function homeLocationId(userIndex: number): bigint {
    return ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
}

/**
 * Parse CLI user index from argv (defaults to 0). Throws if out of range.
 */
export function parseUserIndex(
    argv: readonly string[],
    userCount: number,
    position = 2
): number {
    const raw = argv[position];
    const index = raw == null || raw === '' ? 0 : Number(raw);
    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= userCount ||
        (raw != null && raw !== '' && !/^\d+$/.test(raw))
    ) {
        throw new Error(
            `userIndex must be an integer in 0..${userCount - 1} (got ${JSON.stringify(raw)})`
        );
    }
    return index;
}

/** Next user in the ring (for cross-player harnesses). */
export function otherUserIndex(userIndex: number, userCount: number): number {
    if (userCount < 2) {
        throw new Error('Need at least 2 users for cross-player actions');
    }
    return (userIndex + 1) % userCount;
}

/**
 * Advance L2 time by mining no-op blocks until at least `minAdvanceSeconds` elapsed.
 */
export async function advanceChainTime(
    ctx: TestContext,
    minAdvanceSeconds: bigint
): Promise<void> {
    const start = await getL2BlockTimestamp(ctx);
    let now = start;
    while (now - start < minAdvanceSeconds) {
        await sendTimestampRefreshTx(ctx);
        now = await getL2BlockTimestamp(ctx);
    }
    console.log(
        `   [timestamp] advanced by ${now - start}s (target ${minAdvanceSeconds}s)`
    );
}

/**
 * Simulate + send a contract method, logging FEE_MEASURE for the fee harness.
 */
export async function measureCall(
    name: string,
    ctx: TestContext,
    contract: ContractBase,
    method: string,
    args: readonly unknown[],
    from: AztecAddress,
    opts?: { refreshTimestamp?: boolean }
): Promise<void> {
    if (opts?.refreshTimestamp !== false) {
        await sendTimestampRefreshTx(ctx);
    }
    const methodFn = (
        contract.methods as Record<
            string,
            (...a: unknown[]) => {
                request: (o: unknown) => Promise<unknown>;
                simulate: (o: unknown) => Promise<unknown>;
                send: (o: unknown) => Promise<{ receipt: unknown }>;
            }
        >
    )[method];
    if (!methodFn) {
        throw new Error(`Unknown method ${method} on contract`);
    }
    const invocation = methodFn(...args);
    const sendOpts = ctx.sendOpts(from);
    const payload = await invocation.request(sendOpts);
    const txSimResult = await contract.wallet.simulateTx(payload, { from });
    const gasUsed = txSimResult.gasUsed;
    const { txsLimits } = await ctx.node.getNodeInfo();
    const suggestedLimits = getGasLimits(gasUsed, Gas.from(txsLimits.gas), 0.1);
    console.log(`\n⛽ ${name}`);
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
    const { receipt } = await invocation.send(sendOpts);
    logFeeMeasure(name, gasUsed, receipt);
}
