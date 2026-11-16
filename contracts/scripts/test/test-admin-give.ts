/**
 * Fee harness: ArtifactVault.admin_give_artifact + admin_give_spaceship.
 *
 * Usage: pnpm exec tsx scripts/test/test-admin-give.ts [userIndex]
 */
import { Fr } from '@aztec-labs/aztec.js/fields';

import { exitIfAccountFundingRequired } from '../utils/feePayment.ts';
import { getTestContext } from './test-setup.ts';
import {
    homeLocationId,
    loadPlanet,
    loadPlanetArtifacts,
    measureCall,
    parseUserIndex,
    planetArtifactsZero,
} from './testHelpers.ts';

async function main() {
    const ctx = await getTestContext();
    const userIndex = parseUserIndex(process.argv, ctx.accounts.users.length);
    const Vault = ctx.contracts['ArtifactVault'];
    if (!Vault) throw new Error('ArtifactVault not loaded');

    const admin = ctx.accounts.admin;
    const user = ctx.accounts.users[userIndex]!;
    const locationId = homeLocationId(userIndex);
    const planet = await loadPlanet(ctx, locationId);
    if (!planet) {
        throw new Error('Home planet missing. Run initialize_player first.');
    }

    let planetArtifacts =
        (await loadPlanetArtifacts(ctx, locationId)) ?? planetArtifactsZero();

    const artifactArgs = {
        id: Fr.random().toBigInt(),
        discoverer: user,
        planet_id: locationId,
        rarity: 1,
        biome: 1,
        artifact_type: 1, // Pyramid
        controller: user,
    };

    await measureCall(
        'admin_give_artifact',
        ctx,
        Vault,
        'admin_give_artifact',
        [artifactArgs, planetArtifacts],
        admin,
        { refreshTimestamp: false }
    );

    planetArtifacts =
        (await loadPlanetArtifacts(ctx, locationId)) ?? planetArtifactsZero();
    const refreshedPlanet = (await loadPlanet(ctx, locationId)) ?? planet;

    const shipArgs = {
        id: Fr.random().toBigInt(),
        discoverer: user,
        planet_id: locationId,
        rarity: 1,
        biome: 1,
        artifact_type: 10, // ShipMothership
        controller: user,
    };

    await measureCall(
        'admin_give_spaceship',
        ctx,
        Vault,
        'admin_give_spaceship',
        [shipArgs, refreshedPlanet, planetArtifacts],
        admin,
        { refreshTimestamp: false }
    );
    console.log('✅ TEST SUCCESS — admin_give_artifact / admin_give_spaceship');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
