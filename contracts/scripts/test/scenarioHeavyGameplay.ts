/**
 * Heavy gameplay paths for the 5p scenario: upgrade, withdraw, settle + contested move.
 *
 * Upgrade / withdraw reuse the proven harness scripts (unique runTag locations).
 * Move is inlined so settle targets stay unique across re-runs.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AztecAddress } from '@aztec-labs/aztec.js/addresses';

import { unwrapSimulateResult } from '../utils/index.ts';
import { sendTimestampRefreshTx, type TestContext } from './test-setup.ts';
import {
    advanceChainTime,
    AZTEC_ZERO,
    getL2BlockTimestamp,
    homeLocationId,
    loadArrival,
    loadPlanet,
    loadPlanetArtifacts,
    loadPlanetFromStorage,
    loadStateEvent,
    loadWorld,
    planetArtifactsZero,
    toBigint,
    worldZero,
} from './testHelpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '../..');

function arrivalZero() {
    return {
        id: 0,
        player: AZTEC_ZERO,
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

function artifactZero() {
    return {
        planet_discovered_on: 0n,
        rarity: 0,
        planet_biome: 0,
        minted_at_timestamp: 0,
        discoverer: AZTEC_ZERO,
        artifact_type: 0,
        activations: 0n,
        last_activated: 0,
        last_deactivated: 0,
        wormhole_to: 0n,
        owner: AZTEC_ZERO,
        controller: AZTEC_ZERO,
        last_updated: 0,
    };
}

function artifactLocationZero() {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

function planetEventsZero() {
    return { events: Array(20).fill({ id: 0 }), count: 0, last_updated: 0 };
}

function planetZero(): Record<string, unknown> {
    return {
        perlin: 0,
        created_at: 0,
        owner: AZTEC_ZERO,
        planet_level: 0,
        planet_type: 0,
        space_type: 0,
        is_home_planet: false,
        is_initialized: false,
        destroyed: false,
        invader: AZTEC_ZERO,
        capturer: AZTEC_ZERO,
        invade_start_block: 0,
        population_cap: 0n,
        population_growth: 0n,
        range: 0n,
        speed: 0n,
        defense: 0n,
        silver_cap: 0n,
        silver_growth: 0n,
        population: 0n,
        silver: 0n,
        upgrade_state_0: 0,
        upgrade_state_1: 0,
        upgrade_state_2: 0,
        last_updated: 0,
        pausers: 0n,
        energy_gro_doublers: 0n,
        silver_gro_doublers: 0n,
        hat_level: 0n,
        space_junk: 0n,
        has_tried_finding_artifact: false,
        prospected_block_number: 0,
    };
}

export function runHarnessScript(
    script: string,
    args: string[]
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('pnpm', ['exec', 'tsx', script, ...args], {
            cwd: contractsDir,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (buf: Buffer) => {
            const text = buf.toString();
            out += text;
            process.stdout.write(text);
        });
        child.stderr.on('data', (buf: Buffer) => {
            const text = buf.toString();
            out += text;
            process.stderr.write(text);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(out);
            else
                reject(
                    new Error(`${script} exited ${code}\n${out.slice(-4000)}`)
                );
        });
    });
}

export async function runUpgradePlanetHarness(
    userIndex: number
): Promise<void> {
    console.log(`   running test-upgrade.ts userIndex=${userIndex}`);
    await runHarnessScript('scripts/test/test-upgrade.ts', [String(userIndex)]);
}

export async function runWithdrawSilverHarness(
    userIndex: number
): Promise<void> {
    console.log(`   running test-withdraw.ts userIndex=${userIndex}`);
    await runHarnessScript('scripts/test/test-withdraw.ts', [
        String(userIndex),
    ]);
}

async function loadPlanetEvents(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown>> {
    return (
        (await loadStateEvent(
            ctx,
            '../artifacts/PlanetEventsStorage.ts',
            'PlanetEventsStorageContract',
            'PlanetEventsUpdate',
            'PlanetEventsStorage',
            String(locationId)
        )) ?? planetEventsZero()
    );
}

async function loadArtifact(
    ctx: TestContext,
    id: bigint | number | string
): Promise<Record<string, unknown> | null> {
    return loadStateEvent(
        ctx,
        '../artifacts/ArtifactStorage.ts',
        'ArtifactStorageContract',
        'ArtifactUpdate',
        'ArtifactStorage',
        String(id)
    );
}

async function loadArtifactLocation(
    ctx: TestContext,
    id: bigint | number | string
): Promise<Record<string, unknown>> {
    return (
        (await loadStateEvent(
            ctx,
            '../artifacts/ArtifactLocationStorage.ts',
            'ArtifactLocationStorageContract',
            'ArtifactLocationUpdate',
            'ArtifactLocationStorage',
            String(id)
        )) ?? artifactLocationZero()
    );
}

async function loadArrivalsForPlanetEvents(
    ctx: TestContext,
    planetEvents: Record<string, unknown>
): Promise<{
    arrivals: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
    artifactLocations: Record<string, unknown>[];
}> {
    const count = Number(planetEvents.count ?? 0);
    const events = (planetEvents.events ?? []) as Array<{ id?: unknown }>;
    const arrivals: Record<string, unknown>[] = [];
    const artifacts: Record<string, unknown>[] = [];
    const artifactLocations: Record<string, unknown>[] = [];

    for (let i = 0; i < 20; i++) {
        if (i < count) {
            const id = events[i]?.id ?? 0;
            const arrival =
                (await loadArrival(ctx, String(id))) ?? arrivalZero();
            arrivals.push(arrival);
            const carried = toBigint(arrival.carried_artifact_id);
            if (carried !== 0n) {
                artifacts.push(
                    (await loadArtifact(ctx, carried)) ?? artifactZero()
                );
                artifactLocations.push(
                    await loadArtifactLocation(ctx, carried)
                );
            } else {
                artifacts.push(artifactZero());
                artifactLocations.push(artifactLocationZero());
            }
        } else {
            arrivals.push(arrivalZero());
            artifacts.push(artifactZero());
            artifactLocations.push(artifactLocationZero());
        }
    }
    return { arrivals, artifacts, artifactLocations };
}

async function loadMoveConfigs(
    ctx: TestContext,
    from: AztecAddress,
    level: number
) {
    const Config = ctx.contracts['Config']!;
    const snarkConfig = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from })
    );
    const planetDefaultStats = unwrapSimulateResult(
        await Config.methods.get_planet_default_stats(level).simulate({ from })
    );
    const worldConfig = unwrapSimulateResult(
        await Config.methods.get_world_config().simulate({ from })
    );
    const gameConfigCore = unwrapSimulateResult(
        await Config.methods.get_game_config_core().simulate({ from })
    );
    const planetLevelThresholds = unwrapSimulateResult(
        await Config.methods.get_planet_level_thresholds().simulate({ from })
    );
    const spaceJunkConfig = unwrapSimulateResult(
        await Config.methods.get_space_junk_config().simulate({ from })
    );
    const tiers = [];
    for (let t = 0; t < 4; t++) {
        tiers.push(
            unwrapSimulateResult(
                await Config.methods
                    .get_planet_type_weights_tier(t)
                    .simulate({ from })
            )
        );
    }
    const artifactsConfig = unwrapSimulateResult(
        await Config.methods.get_artifacts_config().simulate({ from })
    );
    return {
        snarkConfig,
        planetDefaultStats,
        worldConfig,
        gameConfigCore,
        planetLevelThresholds,
        spaceJunkConfig,
        tiers,
        artifactsConfig,
    };
}

async function loadPlanetBundle(ctx: TestContext, locationId: bigint) {
    const planet =
        (await loadPlanetFromStorage(ctx, locationId)) ??
        (await loadPlanet(ctx, locationId)) ??
        planetZero();
    const planetEvents = await loadPlanetEvents(ctx, locationId);
    const planetArtifacts =
        (await loadPlanetArtifacts(ctx, locationId)) ?? planetArtifactsZero();
    const arrivalData = await loadArrivalsForPlanetEvents(ctx, planetEvents);
    return {
        planet,
        planetEvents,
        planetArtifacts,
        ...arrivalData,
    };
}

/**
 * Settle move: attacker home → unique empty target (short distance).
 * Contested move: attacker home → defender-owned planet (admin-created).
 */
export async function runSettleAndContestedMoves(
    ctx: TestContext,
    attackerIndex: number,
    defenderIndex: number
): Promise<void> {
    const Move = ctx.contracts['Move']!;
    const Admin = ctx.contracts['Admin']!;
    const attacker = ctx.accounts.users[attackerIndex]!;
    const defender = ctx.accounts.users[defenderIndex]!;
    const admin = ctx.accounts.admin;
    const sendOpts = ctx.sendOpts;
    const runTag = BigInt(Number(await ctx.node.getBlockNumber()) % 1_000_000);

    const sourceLoc = homeLocationId(attackerIndex);
    // Must satisfy location_id_valid (loc < max_location_id). Bases above ~12.6M
    // fail when Move initializes an empty target; keep under that and clear of
    // home ids (10_000_000+i) and test-move's 10_000_002 target.
    const settleLoc =
        ((10_100_000n + BigInt(attackerIndex) * 1_000n + (runTag % 1_000n)) <<
            216n) |
        (255n << 64n);
    const contestedLoc =
        ((10_200_000n + BigInt(defenderIndex) * 1_000n + (runTag % 1_000n)) <<
            216n) |
        (255n << 64n);

    const world = (await loadWorld(ctx)) ?? worldZero();
    const configs = await loadMoveConfigs(ctx, attacker, 0);

    const maxDist = 50n;

    function estimatePopArriving(
        popMoved: bigint,
        populationCap: bigint,
        range: bigint
    ): bigint {
        const percent =
            populationCap > 0n ? (popMoved * 100n) / populationCap : 0n;
        const dMaxPercent =
            percent <= 25n
                ? percent * 2n
                : percent <= 50n
                  ? 25n + percent
                  : (100n + percent) / 2n;
        const dFactor = range * 432n * dMaxPercent;
        const distScaled = maxDist * 100n * 100n;
        if (dFactor === 0n || distScaled >= dFactor) return 0n;
        return (popMoved * (dFactor - distScaled)) / dFactor;
    }

    function choosePopMoved(
        source: Awaited<ReturnType<typeof loadPlanetBundle>>
    ): {
        popMoved: bigint;
        minPopForArrival: bigint;
    } {
        const population = toBigint(source.planet.population);
        const populationCap = toBigint(source.planet.population_cap);
        const range = toBigint(source.planet.range);
        if (population <= 1n) {
            return { popMoved: 0n, minPopForArrival: 1n };
        }
        let lo = 1n;
        let hi = populationCap > 0n ? populationCap : population;
        if (hi < 1n) hi = population;
        while (lo < hi) {
            const mid = (lo + hi) / 2n;
            if (estimatePopArriving(mid, populationCap, range) > 0n) hi = mid;
            else lo = mid + 1n;
        }
        const minPopForArrival = lo;
        if (population <= minPopForArrival) {
            return { popMoved: 0n, minPopForArrival };
        }
        const popMoved =
            population > minPopForArrival + 10_000n
                ? minPopForArrival + 10_000n
                : population - 1n;
        return { popMoved, minPopForArrival };
    }

    async function sendMove(
        label: string,
        source: Awaited<ReturnType<typeof loadPlanetBundle>>,
        targetLoc: bigint,
        target: Awaited<ReturnType<typeof loadPlanetBundle>>,
        popMoved: bigint,
        targetLevel: number,
        targetPerlin: number
    ): Promise<void> {
        await sendTimestampRefreshTx(ctx);
        let timestamp = await getL2BlockTimestamp(ctx);
        const liveWorld = (await loadWorld(ctx)) ?? world;

        for (let attempt = 1; attempt <= 3; attempt++) {
            const moveArgs = [
                sourceLoc,
                targetLoc,
                targetPerlin,
                targetLevel,
                maxDist,
                0n,
                0n,
                maxDist,
                0n,
                popMoved,
                0n,
                0n,
                0n,
                0n,
                false,
                timestamp,
                configs.snarkConfig,
                configs.planetDefaultStats,
                configs.worldConfig,
                configs.gameConfigCore,
                configs.planetLevelThresholds,
                configs.spaceJunkConfig,
                configs.tiers[0],
                configs.tiers[1],
                configs.tiers[2],
                configs.tiers[3],
                configs.artifactsConfig,
                source.planet,
                source.planetArtifacts,
                source.planetEvents,
                source.arrivals,
                source.artifacts,
                source.artifactLocations,
                target.planet,
                target.planetArtifacts,
                target.planetEvents,
                target.arrivals,
                target.artifacts,
                target.artifactLocations,
                liveWorld,
                artifactZero(),
                artifactZero(),
                artifactZero(),
            ] as const;
            try {
                console.log(
                    `   Move.move ${label} (attempt ${attempt}, popMoved=${popMoved})`
                );
                await Move.methods.move(...moveArgs).send(sendOpts(attacker));
                return;
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg.includes('Timestamp too old') && attempt < 3) {
                    await sendTimestampRefreshTx(ctx);
                    timestamp = await getL2BlockTimestamp(ctx);
                    continue;
                }
                throw e;
            }
        }
    }

    // Grow home if needed.
    let source = await loadPlanetBundle(ctx, sourceLoc);
    let pick = choosePopMoved(source);
    if (pick.popMoved === 0n) {
        console.log(
            `   home pop too low for move; advancing growth (min=${pick.minPopForArrival})...`
        );
        await advanceChainTime(ctx, 90n);
        source = await loadPlanetBundle(ctx, sourceLoc);
        pick = choosePopMoved(source);
    }
    if (pick.popMoved === 0n) {
        throw new Error(
            `Attacker user${attackerIndex + 1} home cannot fund a move`
        );
    }

    // --- Settle onto empty unique target ---
    console.log(`   settle move → ${settleLoc}`);
    const emptyTarget = {
        planet: planetZero(),
        planetEvents: planetEventsZero(),
        planetArtifacts: planetArtifactsZero(),
        arrivals: Array.from({ length: 20 }, () => arrivalZero()),
        artifacts: Array.from({ length: 20 }, () => artifactZero()),
        artifactLocations: Array.from({ length: 20 }, () =>
            artifactLocationZero()
        ),
    };
    await sendMove(
        'settle',
        source,
        settleLoc,
        emptyTarget,
        pick.popMoved,
        0,
        13
    );
    await advanceChainTime(ctx, 2n);

    // --- Contested: defender-owned planet ---
    console.log(`   contested target create+own → ${contestedLoc}`);
    await Admin.methods
        .create_planet({
            location: contestedLoc,
            perlin: 13,
            level: 0,
            planet_type: 0,
            require_valid_location_id: false,
        })
        .send(sendOpts(admin));
    let contestedPlanet =
        (await loadPlanetFromStorage(ctx, contestedLoc)) ??
        (await loadPlanet(ctx, contestedLoc));
    for (let i = 0; i < 20 && !contestedPlanet; i++) {
        await new Promise((r) => setTimeout(r, 400));
        contestedPlanet =
            (await loadPlanetFromStorage(ctx, contestedLoc)) ??
            (await loadPlanet(ctx, contestedLoc));
    }
    if (!contestedPlanet) {
        throw new Error('Contested target planet missing after create_planet');
    }
    await Admin.methods
        .set_owner(contestedLoc, contestedPlanet, defender)
        .send(sendOpts(admin));

    source = await loadPlanetBundle(ctx, sourceLoc);
    pick = choosePopMoved(source);
    if (pick.popMoved === 0n) {
        console.log('   growing home again for contested move...');
        await advanceChainTime(ctx, 90n);
        source = await loadPlanetBundle(ctx, sourceLoc);
        pick = choosePopMoved(source);
    }
    if (pick.popMoved === 0n) {
        throw new Error(
            `Not enough home population for contested move after settle`
        );
    }

    const contestedTarget = await loadPlanetBundle(ctx, contestedLoc);
    await sendMove(
        'contested',
        source,
        contestedLoc,
        contestedTarget,
        pick.popMoved,
        0,
        13
    );
    await advanceChainTime(ctx, 2n);
    console.log('   settle + contested moves committed');
}
