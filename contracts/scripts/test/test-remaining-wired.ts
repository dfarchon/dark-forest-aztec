/**
 * Fee harness for the remaining client-wired writes:
 *   safe_set_owner, prospect_planet, find_artifact,
 *   activate_artifact, deactivate_artifact,
 *   withdraw_artifact, deposit_artifact
 *
 * Prerequisites: deploy + bootstrap; user0 already initialize_player (optional —
 * this script only needs a funded admin + user account).
 *
 * Usage: pnpm exec tsx scripts/test/test-remaining-wired.ts [userIndex]
 */
import { getPublicEvents } from '@aztec-labs/aztec.js/events';
import { Fr } from '@aztec-labs/aztec.js/fields';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';

import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { unwrapSimulateResult } from '../utils/index.ts';
import {
    ensureZkDisabled,
    getTestContext,
    sendTimestampRefreshTx,
    type TestContext,
} from './test-setup.ts';
import {
    AZTEC_ZERO,
    getL2BlockTimestamp,
    loadPlanetArtifacts,
    loadPlayer,
    loadWorld,
    measureCall,
    otherUserIndex,
    parseUserIndex,
    planetArtifactsZero,
    toBigint,
    worldZero,
} from './testHelpers.ts';

function planetEventsZero() {
    return { events: Array(20).fill({ id: 0 }), count: 0, last_updated: 0 };
}

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

function emptyArrivals() {
    return Array.from({ length: 20 }, () => arrivalZero());
}
function emptyArtifacts() {
    return Array.from({ length: 20 }, () => artifactZero());
}
function emptyArtifactLocations() {
    return Array.from({ length: 20 }, () => artifactLocationZero());
}

async function loadPlanetEvents(ctx: TestContext, locationId: bigint) {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 30);
    const mod = await import('../artifacts/PlanetEventsStorage.ts');
    const raw = await getPublicEvents(
        ctx.node,
        mod.PlanetEventsStorageContract.events.PlanetEventsUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(latestBlock + 1),
            contractAddress: ctx.contracts['PlanetEventsStorage']?.address,
        }
    );
    const ev = raw.events
        .map((e) => e.event as { id: unknown; state?: Record<string, unknown> })
        .filter((e) => BigInt(String(e.id)) === locationId)
        .pop();
    return ev?.state ?? planetEventsZero();
}

async function loadArtifact(ctx: TestContext, artifactId: bigint) {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 30);
    const mod = await import('../artifacts/ArtifactStorage.ts');
    const raw = await getPublicEvents(
        ctx.node,
        mod.ArtifactStorageContract.events.ArtifactUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(latestBlock + 1),
            contractAddress: ctx.contracts['ArtifactStorage']?.address,
        }
    );
    return (
        raw.events
            .map(
                (e) =>
                    e.event as { id: unknown; state?: Record<string, unknown> }
            )
            .filter((e) => BigInt(String(e.id)) === artifactId)
            .pop()?.state ?? null
    );
}

async function loadArtifactLocation(ctx: TestContext, artifactId: bigint) {
    const latestBlock = Number(await ctx.node.getBlockNumber());
    const from = Math.max(0, latestBlock - 30);
    const mod = await import('../artifacts/ArtifactLocationStorage.ts');
    const raw = await getPublicEvents(
        ctx.node,
        mod.ArtifactLocationStorageContract.events.ArtifactLocationUpdate,
        {
            fromBlock: BlockNumber(from),
            toBlock: BlockNumber(latestBlock + 1),
            contractAddress: ctx.contracts['ArtifactLocationStorage']?.address,
        }
    );
    return (
        raw.events
            .map(
                (e) =>
                    e.event as { id: unknown; state?: Record<string, unknown> }
            )
            .filter((e) => BigInt(String(e.id)) === artifactId)
            .pop()?.state ?? artifactLocationZero()
    );
}

async function waitPlanet(
    ctx: TestContext,
    location: bigint
): Promise<Record<string, unknown>> {
    for (let i = 0; i < 20; i++) {
        const latestBlock = Number(await ctx.node.getBlockNumber());
        const from = Math.max(0, latestBlock - 15);
        const mod = await import('../artifacts/PlanetStorage.ts');
        const raw = await getPublicEvents(
            ctx.node,
            mod.PlanetStorageContract.events.PlanetUpdate,
            {
                fromBlock: BlockNumber(from),
                toBlock: BlockNumber(latestBlock + 1),
                contractAddress: ctx.contracts['PlanetStorage']?.address,
            }
        );
        const state = raw.events
            .map(
                (e) =>
                    e.event as { id: unknown; state?: Record<string, unknown> }
            )
            .filter((e) => BigInt(String(e.id)) === location)
            .pop()?.state;
        if (state) return state;
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`PlanetUpdate missing for ${location}`);
}

async function createOwnedPlanet(
    ctx: TestContext,
    location: bigint,
    planetType: number,
    level: number,
    owner: ReturnType<typeof ctx.accounts.users>[0]
) {
    const Admin = ctx.contracts['Admin']!;
    const admin = ctx.accounts.admin;
    await Admin.methods
        .create_planet({
            location,
            perlin: 13,
            level,
            planet_type: planetType,
            require_valid_location_id: false,
        })
        .send(ctx.sendOpts(admin));
    let planet = await waitPlanet(ctx, location);
    await Admin.methods
        .set_owner(location, planet, owner)
        .send(ctx.sendOpts(admin));
    planet = await waitPlanet(ctx, location);
    return planet;
}

async function main() {
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);
    const user = ctx.accounts.users[userIndex]!;
    const admin = ctx.accounts.admin;
    const Admin = ctx.contracts['Admin']!;
    const Config = ctx.contracts['Config']!;
    const Prospect = ctx.contracts['ArtifactProspect']!;
    const Find = ctx.contracts['ArtifactFind']!;
    const Action = ctx.contracts['ArtifactAction']!;
    const Vault = ctx.contracts['ArtifactVault']!;
    if (!Admin || !Config || !Prospect || !Find || !Action || !Vault) {
        throw new Error('Required contracts not loaded');
    }

    await ensureZkDisabled(ctx);

    // Disable gear requirement so prospect/find don't need ShipGear.
    const ships = unwrapSimulateResult(
        await Config.methods.get_spaceships_config().simulate({ from: admin })
    ) as Record<string, unknown>;
    if (ships.gear) {
        console.log('Disabling spaceships_config.gear for test...');
        await Config.methods
            .set_spaceships_config({ ...ships, gear: false })
            .send(ctx.sendOpts(admin));
    }
    const spaceshipsConfig = unwrapSimulateResult(
        await Config.methods.get_spaceships_config().simulate({ from: admin })
    );

    const runTag = BigInt(Number(await ctx.node.getBlockNumber()) % 1_000_000);
    const safeLoc =
        ((60_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
        (255n << 64n);
    const ruinsLoc =
        ((61_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
        (255n << 64n);
    const postLoc =
        ((62_000_000n + BigInt(userIndex) * 1_000_000n + runTag) << 216n) |
        (255n << 64n);

    // ------------------------------------------------------------------ safe_set_owner
    // Create via Admin.create_planet first (bypasses location_id_valid), then
    // measure safe_set_owner on the existing-planet owner-change path.
    {
        console.log('Creating planet for safe_set_owner...');
        await Admin.methods
            .create_planet({
                location: safeLoc,
                perlin: 13,
                level: 1,
                planet_type: 0,
                require_valid_location_id: false,
            })
            .send(ctx.sendOpts(admin));
        const existing = await waitPlanet(ctx, safeLoc);
        const level = Number(existing.planet_level ?? 1);
        const snarkConfig = unwrapSimulateResult(
            await Config.methods.get_snark_config().simulate({ from: admin })
        );
        const planetDefaultStats = unwrapSimulateResult(
            await Config.methods
                .get_planet_default_stats(level)
                .simulate({ from: admin })
        );
        const worldConfig = unwrapSimulateResult(
            await Config.methods.get_world_config().simulate({ from: admin })
        );
        const gameConfigCore = unwrapSimulateResult(
            await Config.methods
                .get_game_config_core()
                .simulate({ from: admin })
        );
        const planetLevelThresholds = unwrapSimulateResult(
            await Config.methods
                .get_planet_level_thresholds()
                .simulate({ from: admin })
        );
        const spaceJunkConfig = unwrapSimulateResult(
            await Config.methods
                .get_space_junk_config()
                .simulate({ from: admin })
        );
        const tiers = [];
        for (let t = 0; t < 4; t++) {
            tiers.push(
                unwrapSimulateResult(
                    await Config.methods
                        .get_planet_type_weights_tier(t)
                        .simulate({ from: admin })
                )
            );
        }
        const world = (await loadWorld(ctx)) ?? worldZero();
        const timestamp = await getL2BlockTimestamp(ctx);
        const perlin = Number(existing.perlin ?? 13);
        const other =
            ctx.accounts.users[
                otherUserIndex(userIndex, ctx.accounts.users.length)
            ]!;

        await measureCall(
            'safe_set_owner',
            ctx,
            Admin,
            'safe_set_owner',
            [
                0n,
                0n,
                safeLoc,
                perlin,
                level,
                other,
                timestamp,
                snarkConfig,
                planetDefaultStats,
                worldConfig,
                gameConfigCore,
                planetLevelThresholds,
                spaceJunkConfig,
                tiers[0],
                tiers[1],
                tiers[2],
                tiers[3],
                world,
                existing,
            ],
            admin
        );
    }

    // ------------------------------------------------------------------ ruins + prospect + find
    console.log('\nCreating owned Ruins...');
    let ruins = await createOwnedPlanet(ctx, ruinsLoc, 2, 3, user);
    let ruinsEvents = await loadPlanetEvents(ctx, ruinsLoc);
    let ruinsArts =
        (await loadPlanetArtifacts(ctx, ruinsLoc)) ?? planetArtifactsZero();
    let world = (await loadWorld(ctx)) ?? worldZero();
    let timestamp = await getL2BlockTimestamp(ctx);

    await measureCall(
        'prospect_planet',
        ctx,
        Prospect,
        'prospect_planet',
        [
            ruinsLoc,
            timestamp,
            ruins,
            ruinsEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            ruinsArts,
            emptyArtifacts(),
            emptyArtifactLocations(),
            world,
            spaceshipsConfig,
        ],
        user
    );

    // Advance past prospected_block_number for find_artifact.
    await sendTimestampRefreshTx(ctx);

    ruins = await waitPlanet(ctx, ruinsLoc);
    ruinsEvents = await loadPlanetEvents(ctx, ruinsLoc);
    ruinsArts =
        (await loadPlanetArtifacts(ctx, ruinsLoc)) ?? planetArtifactsZero();
    world = (await loadWorld(ctx)) ?? worldZero();
    const player =
        (await loadPlayer(ctx, user.toString())) ??
        ({
            init_timestamp: 1,
            home_planet_id: 0n,
            last_reveal_timestamp: 0,
            score: 0n,
            space_junk: 0n,
            space_junk_limit: 0n,
            claimed_ships: false,
            last_updated: 0,
        } as Record<string, unknown>);

    // Player must be initialized for find (score write). Init user0 if needed.
    if (toBigint(player.init_timestamp) === 0n) {
        throw new Error(
            'Player not initialized. Run test-core-initialize-player first for this user.'
        );
    }

    const snarkConfig = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: user })
    );
    const gameConfigCore = unwrapSimulateResult(
        await Config.methods.get_game_config_core().simulate({ from: user })
    );
    const worldConfig = unwrapSimulateResult(
        await Config.methods.get_world_config().simulate({ from: user })
    );
    const artifactsConfig = unwrapSimulateResult(
        await Config.methods.get_artifacts_config().simulate({ from: user })
    );
    timestamp = await getL2BlockTimestamp(ctx);

    await measureCall(
        'find_artifact',
        ctx,
        Find,
        'find_artifact',
        [
            ruinsLoc,
            0n,
            0n,
            0, // biomebase (ZK off)
            timestamp,
            snarkConfig,
            gameConfigCore,
            worldConfig,
            artifactsConfig,
            spaceshipsConfig,
            player,
            ruins,
            ruinsEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            ruinsArts,
            emptyArtifacts(),
            emptyArtifactLocations(),
            world,
        ],
        user
    );

    // ------------------------------------------------------------------ trading post + activate/deactivate/withdraw/deposit
    console.log('\nCreating owned TradingPost...');
    let post = await createOwnedPlanet(ctx, postLoc, 3, 3, user);
    let postArts =
        (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();

    const monolithId = Fr.random().toBigInt();
    await Vault.methods
        .admin_give_artifact(
            {
                id: monolithId,
                discoverer: user,
                planet_id: postLoc,
                rarity: 0,
                biome: 1,
                artifact_type: 1, // Monolith — 0h cooldown
                controller: user,
            },
            postArts
        )
        .send(ctx.sendOpts(admin));

    // Reload after admin give
    for (let i = 0; i < 15; i++) {
        postArts =
            (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
        if (Number(postArts.count ?? 0) > 0) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    post = await waitPlanet(ctx, postLoc);
    let postEvents = await loadPlanetEvents(ctx, postLoc);
    let artifact = await loadArtifact(ctx, monolithId);
    if (!artifact) throw new Error('Monolith ArtifactUpdate missing');
    let artifactLoc = await loadArtifactLocation(ctx, monolithId);
    // World is not written by activate/deactivate/vault — reuse tip world.
    const worldForVault = (await loadWorld(ctx)) ?? world;
    world = worldForVault;
    const planetDefaultStats = unwrapSimulateResult(
        await Config.methods
            .get_planet_default_stats(3)
            .simulate({ from: user })
    );
    timestamp = await getL2BlockTimestamp(ctx);

    // planet_artifacts array aligned with ids
    const planetArtifactsArr = emptyArtifacts();
    planetArtifactsArr[0] = artifact;

    await measureCall(
        'activate_artifact',
        ctx,
        Action,
        'activate_artifact',
        [
            postLoc,
            monolithId,
            0n, // wormhole_to
            timestamp,
            post,
            postEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            postArts,
            artifact,
            artifactLoc,
            world,
            worldConfig,
            planetDefaultStats,
            planetArtifactsArr,
            {
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
                pausers: 0,
                energy_gro_doublers: 0,
                silver_gro_doublers: 0,
                hat_level: 0,
                space_junk: 0n,
                has_tried_finding_artifact: false,
                prospected_block_number: 0,
            },
        ],
        user
    );

    post = await waitPlanet(ctx, postLoc);
    postEvents = await loadPlanetEvents(ctx, postLoc);
    postArts =
        (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
    artifact = (await loadArtifact(ctx, monolithId))!;
    artifactLoc = await loadArtifactLocation(ctx, monolithId);
    timestamp = await getL2BlockTimestamp(ctx);

    await measureCall(
        'deactivate_artifact',
        ctx,
        Action,
        'deactivate_artifact',
        [
            postLoc,
            monolithId,
            timestamp,
            post,
            postEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            postArts,
            artifact,
            artifactLoc,
            world,
        ],
        user
    );

    post = await waitPlanet(ctx, postLoc);
    postEvents = await loadPlanetEvents(ctx, postLoc);
    postArts =
        (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
    artifact = (await loadArtifact(ctx, monolithId))!;
    artifactLoc = await loadArtifactLocation(ctx, monolithId);
    timestamp = await getL2BlockTimestamp(ctx);

    await measureCall(
        'withdraw_artifact',
        ctx,
        Vault,
        'withdraw_artifact',
        [
            postLoc,
            monolithId,
            timestamp,
            post,
            postArts,
            postEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            artifact,
            artifactLoc,
            world,
        ],
        user
    );

    post = await waitPlanet(ctx, postLoc);
    postEvents = await loadPlanetEvents(ctx, postLoc);
    postArts =
        (await loadPlanetArtifacts(ctx, postLoc)) ?? planetArtifactsZero();
    artifact = (await loadArtifact(ctx, monolithId))!;
    artifactLoc = await loadArtifactLocation(ctx, monolithId);
    timestamp = await getL2BlockTimestamp(ctx);

    await measureCall(
        'deposit_artifact',
        ctx,
        Vault,
        'deposit_artifact',
        [
            postLoc,
            monolithId,
            timestamp,
            post,
            postArts,
            postEvents,
            emptyArrivals(),
            emptyArtifacts(),
            emptyArtifactLocations(),
            artifact,
            artifactLoc,
            world,
        ],
        user
    );

    console.log('✅ TEST SUCCESS — remaining wired fee harness');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
