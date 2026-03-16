/**
 * Test script for ArtifactSystem: prospect_planet (public) + find_artifact (private).
 *
 * Prerequisites:
 * - deploy + configure have been run (including ArtifactSystem wiring).
 * - .env contains ARTIFACT_SYSTEM_CONTRACT_ADDRESS and all storage addresses.
 * - At least one player initialized (test-core-initialize-player.ts).
 *
 * Flow:
 *   1. Admin creates a RUINS planet (planet_type = 2) owned by the test user.
 *   2. User calls ArtifactSystem.prospect_planet() (public) to record the prospected block.
 *   3. We wait for the next block so get_block_header_at can fetch it.
 *   4. User calls ArtifactSystem.find_artifact() (private) with refresh params (same as move:
 *      load planet_events, arrivals, artifacts, artifact_locations from events; find_artifact
 *      calls refresh_planet internally then runs find logic).
 *   5. Verify the artifact is stored in ArtifactStorage and PlanetArtifacts is updated.
 *
 * Usage (from contracts/ directory):
 *   pnpm exec tsx scripts/test-artifact.ts [userIndex]
 *   node --experimental-transform-types scripts/test-artifact.ts [userIndex]
 *
 * userIndex: 0 = user1, 1 = user2 (default 0).
 */
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import { getTestContext, type TestContext } from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const AZTEC_ZERO =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

// ---------------------------------------------------------------------------
// State zero helpers
// ---------------------------------------------------------------------------

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

function planetArtifactsZero(): Record<string, unknown> {
    return { ids: Array(20).fill(0n), count: 0, last_updated: 0 };
}

/** Zero PlanetEvents for Core.refresh_planet_private (no in-flight arrivals). */
function planetEventsZero(): Record<string, unknown> {
    return { events: Array(20).fill({ id: 0n }), count: 0, last_updated: 0 };
}

function arrivalZero(): Record<string, unknown> {
    return {
        id: 0n,
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

function artifactLocationZero(): Record<string, unknown> {
    return { planet_id: 0n, voyage_id: 0n, last_updated: 0 };
}

function artifactsArrayZero(): Record<string, unknown>[] {
    return Array(20).fill({
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
        controller: AZTEC_ZERO,
        last_updated: 0,
    });
}

function playerZero(): Record<string, unknown> {
    return {
        init_timestamp: 0,
        home_planet_id: 0n,
        last_reveal_timestamp: 0,
        score: 0n,
        space_junk: 0n,
        space_junk_limit: 0n,
        claimed_ships: false,
        last_updated: 0,
    };
}

// ---------------------------------------------------------------------------
// Event loaders
// ---------------------------------------------------------------------------

async function loadPlanetFromEvents(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 300);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/PlanetStorage.ts');
        const P = mod.PlanetStorageContract;
        if (!P?.events?.PlanetUpdate) return null;
        const events = await getDecodedPublicEvents<{
            id: unknown;
            state?: Record<string, unknown>;
        }>(ctx.node, P.events.PlanetUpdate, from, limit, {
            contractAddress: ctx.contracts['PlanetStorage']?.address,
        });
        return (
            events.filter((e) => String(e?.id) === String(locationId)).pop()
                ?.state ?? null
        );
    } catch {
        return null;
    }
}

async function loadPlanetArtifactsFromEvents(
    ctx: TestContext,
    locationId: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 300);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/PlanetArtifactsStorage.ts');
        const PA = mod.PlanetArtifactsStorageContract;
        if (!PA?.events?.PlanetArtifactsUpdate) return null;
        const events = await getDecodedPublicEvents<{
            id: unknown;
            state?: Record<string, unknown>;
        }>(ctx.node, PA.events.PlanetArtifactsUpdate, from, limit, {
            contractAddress: ctx.contracts['PlanetArtifactsStorage']?.address,
        });
        return (
            events.filter((e) => String(e?.id) === String(locationId)).pop()
                ?.state ?? null
        );
    } catch {
        return null;
    }
}

async function loadPlayerFromEvents(
    ctx: TestContext,
    playerAddr: string
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 300);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/PlayerStorage.ts');
        const PS = mod.PlayerStorageContract;
        if (!PS?.events?.PlayerUpdate) return null;
        const events = await getDecodedPublicEvents<{
            id: unknown;
            state?: Record<string, unknown>;
        }>(ctx.node, PS.events.PlayerUpdate, from, limit, {
            contractAddress: ctx.contracts['PlayerStorage']?.address,
        });
        return (
            events
                .filter((e) => String(e?.id).toLowerCase() === playerAddr.toLowerCase())
                .pop()?.state ?? null
        );
    } catch {
        return null;
    }
}

async function loadArtifactFromEvents(
    ctx: TestContext,
    artifactId: bigint
): Promise<Record<string, unknown> | null> {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 300);
    const limit = latestBlock - from + 1;
    try {
        const mod = await import('./artifacts/ArtifactStorage.ts');
        const A = mod.ArtifactStorageContract;
        if (!A?.events?.ArtifactUpdate) return null;
        const events = await getDecodedPublicEvents<{
            id: unknown;
            state?: Record<string, unknown>;
        }>(ctx.node, A.events.ArtifactUpdate, from, limit, {
            contractAddress: ctx.contracts['ArtifactStorage']?.address,
        });
        return (
            events
                .filter((e) => String(e?.id) === String(artifactId))
                .pop()?.state ?? null
        );
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

async function getCurrentBlockNumber(ctx: TestContext): Promise<number> {
    return Number(await ctx.node.getBlockNumber());
}

/** L2 block timestamp for contract (timestamp <= actual and within 300s). */
async function getTimestampForContract(ctx: TestContext): Promise<bigint> {
    try {
        const node = ctx.node as unknown as {
            getBlock: (n: number | 'latest') => Promise<
                | { header?: { globalVariables?: { timestamp?: unknown } }; timestamp?: number }
                | undefined
            >;
        };
        const block = await node.getBlock('latest');
        let ts: bigint | undefined;
        if (block?.header?.globalVariables?.timestamp != null) {
            const raw = block.header.globalVariables.timestamp;
            ts = typeof raw === 'bigint' ? raw : BigInt(String(raw).replace(/n$/, ''));
        } else if (block?.timestamp != null) {
            ts = BigInt(Number(block.timestamp));
        }
        if (ts != null) return ts;
    } catch {
        /* ignore */
    }
    return BigInt(Math.floor(Date.now() / 1000));
}

/** Poll until block number advances past `targetBlock`. */
async function waitForBlock(
    ctx: TestContext,
    targetBlock: number,
    timeoutMs = 120_000
): Promise<void> {
    const start = Date.now();
    console.log(`   Waiting for block > ${targetBlock}...`);
    while (Date.now() - start < timeoutMs) {
        const current = await getCurrentBlockNumber(ctx);
        if (current > targetBlock) {
            console.log(`   Block advanced to ${current}.`);
            return;
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Timed out waiting for block > ${targetBlock}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const userIndex = (() => {
        const arg = process.argv[2];
        if (arg === undefined) return 0;
        const n = parseInt(arg, 10);
        return n === 0 || n === 1 ? n : 0;
    })();

    console.log('Loading test context...\n');
    const ctx = await getTestContext();

    const ArtifactSystem = ctx.contracts['ArtifactSystem'];
    const Admin = ctx.contracts['Admin'];

    if (!ArtifactSystem) {
        throw new Error(
            'ArtifactSystem contract not loaded. ' +
                'Make sure ARTIFACT_SYSTEM_CONTRACT_ADDRESS is in .env and configure has been run.'
        );
    }
    if (!Admin) throw new Error('Admin contract not loaded');

    const { admin, users } = ctx.accounts;
    const sendOpts = ctx.sendOpts;
    const user = users[userIndex];
    const userLabel = userIndex === 0 ? 'user1' : 'user2';

    console.log('ArtifactSystem at:', ArtifactSystem.address.toString());
    console.log(`Player (${userLabel}):`, user.toString());

    // ------------------------------------------------------------------
    // Step 1: Create a RUINS planet (planet_type=2) owned by the test user
    // ------------------------------------------------------------------
    // planet_level=3 so that artifacts can have rarity > 0.
    // Biome seed (biomebase) 38 falls in OCEAN for NEBULA space_type=1.
    const ruinsLocationId =
        ((20_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
    const ruinsLevel = 3;
    const ruinsPerlin = 13; // space_type NEBULA

    console.log('\n--- Step 1: Admin creates RUINS planet ---');
    console.log('   location_id:', String(ruinsLocationId));

    // Check if planet already exists from a previous run
    let existingPlanet = await loadPlanetFromEvents(ctx, ruinsLocationId);
    if (existingPlanet && toBigint(existingPlanet.planet_type) === 2n) {
        console.log('   Planet already exists (reusing from previous run).');
    } else {
        // Admin.create_planet sets up an initialized planet
        // planet_type=2 (RUINS), owner=user
        const tx = await Admin.methods
            .create_planet({
                location: ruinsLocationId,
                perlin: ruinsPerlin,
                level: ruinsLevel,
                planet_type: 2, // RUINS
                require_valid_location_id: false,
            })
            .send(sendOpts(admin));
        await tx.wait();
        console.log('   Planet created.');

        // Admin.set_owner to transfer ownership to the test user
        const tx2 = await Admin.methods
            .set_owner(ruinsLocationId, user)
            .send(sendOpts(admin));
        await tx2.wait();
        console.log('   Ownership transferred to', user.toString());

        existingPlanet = await loadPlanetFromEvents(ctx, ruinsLocationId);
    }

    if (!existingPlanet) {
        throw new Error('Failed to load planet after creation');
    }
    console.log(
        '   Planet type:', String(existingPlanet.planet_type),
        '| Level:', String(existingPlanet.planet_level),
        '| Owner:', String(existingPlanet.owner)
    );

    // ------------------------------------------------------------------
    // Step 2: Load all current state needed for prospect_planet
    // ------------------------------------------------------------------
    console.log('\n--- Step 2: Loading planet state for prospect ---');

    const planet = existingPlanet;
    const planetArtifacts =
        (await loadPlanetArtifactsFromEvents(ctx, ruinsLocationId)) ??
        planetArtifactsZero();
    const artifacts = artifactsArrayZero();

    console.log(
        '   prospected_block_number:',
        String(planet.prospected_block_number)
    );

    // ------------------------------------------------------------------
    // Step 3: Prospect the planet (public) if not already prospected
    // ------------------------------------------------------------------
    let prospectedBlock: number;

    if (
        planet.has_tried_finding_artifact === true ||
        planet.has_tried_finding_artifact === 1
    ) {
        throw new Error(
            'Planet already had find_artifact run. Use a different location_id or redeploy.'
        );
    }

    if (
        toBigint(planet.prospected_block_number) !== 0n
    ) {
        prospectedBlock = Number(planet.prospected_block_number);
        console.log(
            `\n--- Step 3: Planet already prospected at block ${prospectedBlock} (skipping) ---`
        );
    } else {
        console.log('\n--- Step 3: prospect_planet (public, with refresh like L1) ---');

        const planetEvents = planetEventsZero();
        const arrivals = Array(20).fill(null).map(() => arrivalZero());
        const artifactLocations = Array(20).fill(null).map(() => artifactLocationZero());
        const prospectTimestamp = await getTimestampForContract(ctx);

        try {
            await ArtifactSystem.methods
                .prospect_planet(
                    ruinsLocationId,
                    planet,
                    planetArtifacts,
                    planetEvents,
                    arrivals,
                    artifacts,
                    artifactLocations,
                    artifacts, // planet_artifacts_artifacts (no artifacts on planet yet)
                    prospectTimestamp,
                )
                .simulate({ from: user });
            console.log('   Simulate passed.');
        } catch (e) {
            console.error('   Simulate failed:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }

        const tx = await ArtifactSystem.methods
            .prospect_planet(
                ruinsLocationId,
                planet,
                planetArtifacts,
                planetEvents,
                arrivals,
                artifacts,
                artifactLocations,
                artifacts,
                prospectTimestamp,
            )
            .send(sendOpts(user));
        const receipt = await tx.wait();
        console.log(
            '   prospect_planet tx:',
            (receipt as unknown as { txHash?: unknown })?.txHash ?? '(unknown)'
        );

        // Reload planet to get the prospected_block_number written on-chain
        const prospectedPlanet = await loadPlanetFromEvents(ctx, ruinsLocationId);
        if (!prospectedPlanet || toBigint(prospectedPlanet.prospected_block_number) === 0n) {
            throw new Error('prospected_block_number not set after prospect_planet');
        }
        prospectedBlock = Number(prospectedPlanet.prospected_block_number);
        console.log('   Prospected at block:', prospectedBlock);
    }

    // ------------------------------------------------------------------
    // Step 4: Wait for at least one block so get_block_header_at succeeds
    // ------------------------------------------------------------------
    console.log('\n--- Step 4: Wait for block header to be available ---');
    await waitForBlock(ctx, prospectedBlock);

    // ------------------------------------------------------------------
    // Step 4: Load state and config for find_artifact (same pattern as move: pass refresh params)
    // ------------------------------------------------------------------
    const freshPlanet =
        (await loadPlanetFromEvents(ctx, ruinsLocationId)) ??
        planetZero();
    const freshPlanetArtifacts =
        (await loadPlanetArtifactsFromEvents(ctx, ruinsLocationId)) ??
        planetArtifactsZero();
    const freshPlayer =
        (await loadPlayerFromEvents(ctx, user.toString())) ??
        playerZero();

    const Config = ctx.contracts['Config'];
    if (!Config) {
        throw new Error('Config contract not loaded (needed for find_artifact config params)');
    }
    const gameConfigCore = await Config.methods.get_game_config_core().simulate({ from: user });
    const snarkConfig = await Config.methods.get_snark_config().simulate({ from: user });
    const spaceshipsConfig = await Config.methods.get_spaceships_config().simulate({ from: user });

    const currentBlockNumber = await getCurrentBlockNumber(ctx);
    const timestamp = await getTimestampForContract(ctx);

    const planetEvents = planetEventsZero();
    const arrivals = Array(20).fill(null).map(() => arrivalZero());
    const artifactsForRefresh = artifactsArrayZero();
    const artifactLocations = Array(20).fill(null).map(() => artifactLocationZero());
    const planetArtifactsArtifacts = artifactsArrayZero();

    const findArgs = {
        planet_id: ruinsLocationId,
        biomebase: 38n,
        core_address: ArtifactSystem.address,
        snark_perlin_planethash_key: snarkConfig.planethash_key ?? 6279n,
        snark_perlin_biomebase_key: snarkConfig.biomebase_key ?? 6271n,
        snark_perlin_length_scale: snarkConfig.perlin_length_scale ?? 16384n,
        snark_perlin_mirror_x: snarkConfig.perlin_mirror_x ? 1 : 0,
        snark_perlin_mirror_y: snarkConfig.perlin_mirror_y ? 1 : 0,
    };

    console.log('\n--- Step 5: find_artifact (private, with refresh params like move) ---');
    console.log(
        '   has_tried_finding_artifact:', freshPlanet.has_tried_finding_artifact,
        '| prospected_block:', String(freshPlanet.prospected_block_number)
    );

    try {
        await ArtifactSystem.methods
            .find_artifact(
                findArgs,
                freshPlanet,
                freshPlanetArtifacts,
                planetEvents,
                arrivals,
                artifactsForRefresh,
                artifactLocations,
                freshPlayer,
                gameConfigCore,
                snarkConfig,
                currentBlockNumber,
                spaceshipsConfig,
                planetArtifactsArtifacts,
                timestamp,
            )
            .simulate({ from: user });
        console.log('   Simulate passed.');
    } catch (e) {
        console.error('   Simulate failed:', e instanceof Error ? e.message : String(e));
        if (e instanceof Error && e.stack) console.error(e.stack);
        process.exit(1);
    }

    const findTx = await ArtifactSystem.methods
        .find_artifact(
            findArgs,
            freshPlanet,
            freshPlanetArtifacts,
            planetEvents,
            arrivals,
            artifactsForRefresh,
            artifactLocations,
            freshPlayer,
            gameConfigCore,
            snarkConfig,
            currentBlockNumber,
            spaceshipsConfig,
            planetArtifactsArtifacts,
            timestamp,
        )
        .send(sendOpts(user));
    const findReceipt = await findTx.wait();
    const findTxHash = (findReceipt as unknown as { txHash?: unknown })?.txHash;

    console.log('\n' + '='.repeat(60));
    console.log('TEST SUCCESS — find_artifact committed');
    console.log('='.repeat(60));
    console.log('  Transaction:', findTxHash ?? '(unknown)');
    console.log('  Player:', user.toString());
    console.log('  RUINS planet location_id:', String(ruinsLocationId));

    // ------------------------------------------------------------------
    // Step 6: Verify on-chain state (optional label)
    // ------------------------------------------------------------------
    console.log('\n--- Verifying on-chain state ---');

    const updatedPlanet = await loadPlanetFromEvents(ctx, ruinsLocationId);
    if (updatedPlanet) {
        const found = updatedPlanet.has_tried_finding_artifact;
        console.log(
            '  planet.has_tried_finding_artifact:',
            found,
            found ? '(PASS)' : '(FAIL - should be true)'
        );
    } else {
        console.warn('  Could not load updated planet from events.');
    }

    const updatedArtifacts = await loadPlanetArtifactsFromEvents(ctx, ruinsLocationId);
    if (updatedArtifacts) {
        const count = Number(updatedArtifacts.count ?? 0);
        console.log(
            '  planet_artifacts.count:',
            count,
            count > 0 ? '(PASS)' : '(FAIL - should be > 0)'
        );

        const ids = (updatedArtifacts.ids ?? []) as unknown[];
        const artifactId = toBigint(ids[0]);
        console.log('  artifact_id (ids[0]):', String(artifactId));

        if (artifactId !== 0n) {
            const artifact = await loadArtifactFromEvents(ctx, artifactId);
            if (artifact) {
                console.log('  Artifact found in ArtifactStorage:');
                console.log('    artifact_type:', artifact.artifact_type);
                console.log('    rarity:', artifact.rarity);
                console.log('    planet_biome:', artifact.planet_biome);
                console.log('    discoverer:', artifact.discoverer);
            } else {
                console.warn('  Artifact not found in ArtifactStorage events (may need more blocks).');
            }
        }
    } else {
        console.warn('  Could not load PlanetArtifacts from events.');
    }

    const updatedPlayer = await loadPlayerFromEvents(ctx, user.toString());
    if (updatedPlayer) {
        console.log('  player.score:', String(updatedPlayer.score));
    }

    console.log('\n' + '='.repeat(60));
    console.log('All artifact test steps completed.');
    console.log('='.repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
