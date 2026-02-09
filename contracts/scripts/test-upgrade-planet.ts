/**
 * Script for testing PlanetUpgrade.upgrade_planet.
 * Flow:
 * 1) Admin.create_planet(level=1, type=0)
 * 2) Fund silver in PlanetResourcesStorage for exactly one defense upgrade
 * 3) Call PlanetUpgrade.upgrade_planet(defense+1)
 * 4) Verify caps/resources updates from storage events
 *
 * Run: cd contracts && node --experimental-transform-types scripts/test-upgrade-planet.ts
 */
import type { EventMetadataDefinition } from '@aztec/stdlib/abi';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { PlanetCapsStorageContract } from './artifacts/PlanetCapsStorage.ts';
import { PlanetOwnerStorageContract } from './artifacts/PlanetOwnerStorage.ts';
import { PlanetResourcesStorageContract } from './artifacts/PlanetResourcesStorage.ts';
import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import { getTestContext, type TestContext } from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

type PlanetOwnerState = Record<string, unknown>;
type PlanetCapsState = {
    population_cap: bigint | number;
    population_growth: bigint | number;
    range: bigint | number;
    speed: bigint | number;
    defense: bigint | number;
    silver_cap: bigint | number;
    silver_growth: bigint | number;
};
type PlanetResourcesState = {
    population: bigint | number;
    silver: bigint | number;
    upgrade_state_0: bigint | number;
    upgrade_state_1: bigint | number;
    upgrade_state_2: bigint | number;
    last_updated: bigint | number;
};

type UpgradeState = {
    pop_cap_multiplier: bigint | number;
    pop_gro_multiplier: bigint | number;
    range_multiplier: bigint | number;
    speed_multiplier: bigint | number;
    def_multiplier: bigint | number;
};

type DecodedEvent<TState> = {
    id: unknown;
    block_number: bigint | number;
    state: TState;
};

function toBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(value);
    if (typeof value === 'string') return BigInt(value);
    if (value === undefined || value === null) return 0n;
    throw new Error(`Cannot convert value to bigint: ${String(value)}`);
}

function toNum(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') return Number(value);
    if (value === undefined || value === null) return 0;
    return Number(value);
}

function stringifyBigints<T>(value: T): T {
    return JSON.parse(
        JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v))
    ) as T;
}

function capSummary(caps: PlanetCapsState) {
    return {
        population_cap: String(toBigInt(caps.population_cap)),
        population_growth: String(toBigInt(caps.population_growth)),
        range: String(toBigInt(caps.range)),
        speed: String(toBigInt(caps.speed)),
        defense: String(toBigInt(caps.defense)),
        silver_cap: String(toBigInt(caps.silver_cap)),
        silver_growth: String(toBigInt(caps.silver_growth)),
    };
}

function resourceSummary(resources: PlanetResourcesState) {
    return {
        population: String(toBigInt(resources.population)),
        silver: String(toBigInt(resources.silver)),
        upgrade_state_0: String(toBigInt(resources.upgrade_state_0)),
        upgrade_state_1: String(toBigInt(resources.upgrade_state_1)),
        upgrade_state_2: String(toBigInt(resources.upgrade_state_2)),
        last_updated: String(toBigInt(resources.last_updated)),
    };
}

async function readStateFromEvent<TState>(
    ctx: TestContext,
    eventMetadata: EventMetadataDefinition,
    blockNumber: number,
    location: bigint,
    label: string
): Promise<TState> {
    const events = await getDecodedPublicEvents<DecodedEvent<TState>>(
        ctx.node,
        eventMetadata,
        blockNumber,
        1
    );

    const event = events.filter((e) => String(e.id) === String(location)).pop();

    if (!event) {
        throw new Error(
            `${label} event not found for location=${location.toString()} at/after block ${blockNumber}`
        );
    }

    return event.state;
}

function assertEq(label: string, actual: bigint, expected: bigint): void {
    if (actual !== expected) {
        throw new Error(
            `${label} mismatch: actual=${actual.toString()} expected=${expected.toString()}`
        );
    }
}

async function main() {
    console.log('🔗 Loading test context...\n');
    const ctx = await getTestContext();

    const Admin = ctx.contracts['Admin'];
    const PlanetUpgrade = ctx.contracts['PlanetUpgrade'];
    const PlanetOwnerStorage = ctx.contracts['PlanetOwnerStorage'];
    const PlanetResourcesStorage = ctx.contracts['PlanetResourcesStorage'];
    const Config = ctx.contracts['Config'];

    if (
        !Admin ||
        !PlanetUpgrade ||
        !PlanetOwnerStorage ||
        !PlanetResourcesStorage ||
        !Config
    ) {
        throw new Error(
            'Missing required contract instance(s): Admin, PlanetUpgrade, PlanetOwnerStorage, PlanetResourcesStorage, Config'
        );
    }

    const { admin } = ctx.accounts;
    const sendOpts = ctx.sendOpts;

    const location = 100n;
    const createArgs = {
        location,
        perlin: 13,
        level: 1,
        planet_type: 0,
        require_valid_location_id: false,
    };

    console.log('🪐 Step 1: create planet');
    const createTx = await Admin.methods
        .create_planet(createArgs)
        .send(sendOpts(admin));
    const createReceipt = await createTx.wait();
    const createBlock = Number(
        (createReceipt as { blockNumber?: number }).blockNumber ?? 0
    );

    console.log(`   ✅ Planet created in block ${createBlock}`);

    const ownerBefore = await readStateFromEvent<PlanetOwnerState>(
        ctx,
        PlanetOwnerStorageContract.events.PlanetOwnerUpdated,
        createBlock,
        location,
        'PlanetOwnerUpdated'
    );
    const capsBefore = await readStateFromEvent<PlanetCapsState>(
        ctx,
        PlanetCapsStorageContract.events.PlanetCapsUpdated,
        createBlock,
        location,
        'PlanetCapsUpdated'
    );
    const resourcesBefore = await readStateFromEvent<PlanetResourcesState>(
        ctx,
        PlanetResourcesStorageContract.events.PlanetResourcesUpdated,
        createBlock,
        location,
        'PlanetResourcesUpdated'
    );

    console.log('   owner (before):', String(ownerBefore.owner));
    console.log('   caps (before):', capSummary(capsBefore));
    console.log('   resources (before):', resourceSummary(resourcesBefore));

    let ownerForUpgrade = ownerBefore;
    if (String(ownerBefore.owner) !== admin.toString()) {
        console.log(
            '\n🧭 Step 1.5: set planet owner to admin for upgrade validation'
        );
        const updatedOwnerState: PlanetOwnerState = {
            ...ownerBefore,
            owner: admin,
        };
        const ownerTx = await PlanetOwnerStorage.methods
            .set(location, updatedOwnerState)
            .send(sendOpts(admin));
        const ownerReceipt = await ownerTx.wait();
        const ownerBlock = Number(
            (ownerReceipt as { blockNumber?: number }).blockNumber ?? 0
        );

        ownerForUpgrade = await readStateFromEvent<PlanetOwnerState>(
            ctx,
            PlanetOwnerStorageContract.events.PlanetOwnerUpdated,
            ownerBlock,
            location,
            'PlanetOwnerUpdated (owner set)'
        );
        console.log('   ✅ owner (after):', String(ownerForUpgrade.owner));
    }

    console.log('\n⛏️  Step 2: fund silver for one defense upgrade');

    const isAdminAuthorized = await PlanetResourcesStorage.methods
        .is_authorized_unconstrained(admin)
        .simulate({ from: admin });

    if (!isAdminAuthorized) {
        const authTx = await PlanetResourcesStorage.methods
            .add_authorized_contract(admin)
            .send(sendOpts(admin));
        await authTx.wait();
        console.log(
            '   ✅ Admin added to PlanetResourcesStorage authorized list'
        );
    } else {
        console.log(
            '   ℹ️  Admin already authorized for PlanetResourcesStorage'
        );
    }

    const upgradeConfig = (await Config.methods
        .get_upgrade_config_public()
        .simulate({ from: admin })) as {
        silver_cost_percent?: Array<bigint | number>;
    };

    const firstCostPercent = toBigInt(
        upgradeConfig.silver_cost_percent?.[0] ?? 20n
    );
    const silverCap = toBigInt(capsBefore.silver_cap);
    const requiredSilver = (silverCap * firstCostPercent) / 100n;

    const fundedResources: PlanetResourcesState = {
        ...resourcesBefore,
        silver: requiredSilver,
    };

    const fundTx = await PlanetResourcesStorage.methods
        .set(location, fundedResources)
        .send(sendOpts(admin));
    const fundReceipt = await fundTx.wait();
    const fundBlock = Number(
        (fundReceipt as { blockNumber?: number }).blockNumber ?? 0
    );

    const resourcesFunded = await readStateFromEvent<PlanetResourcesState>(
        ctx,
        PlanetResourcesStorageContract.events.PlanetResourcesUpdated,
        fundBlock,
        location,
        'PlanetResourcesUpdated (funding)'
    );

    console.log(
        `   ✅ Funded silver=${toBigInt(resourcesFunded.silver).toString()} (cost percent=${firstCostPercent.toString()}%)`
    );

    console.log('\n⬆️  Step 3: call PlanetUpgrade.upgrade_planet(defense +1)');

    const upgradeTx = await PlanetUpgrade.methods
        .upgrade_planet(
            location,
            1,
            0,
            0,
            ownerForUpgrade,
            capsBefore,
            resourcesFunded
        )
        .send(sendOpts(admin));
    const upgradeReceipt = await upgradeTx.wait();
    const upgradeBlock = Number(
        (upgradeReceipt as { blockNumber?: number }).blockNumber ?? 0
    );

    const capsAfter = await readStateFromEvent<PlanetCapsState>(
        ctx,
        PlanetCapsStorageContract.events.PlanetCapsUpdated,
        upgradeBlock,
        location,
        'PlanetCapsUpdated (upgrade)'
    );
    const resourcesAfter = await readStateFromEvent<PlanetResourcesState>(
        ctx,
        PlanetResourcesStorageContract.events.PlanetResourcesUpdated,
        upgradeBlock,
        location,
        'PlanetResourcesUpdated (upgrade)'
    );

    console.log(`   ✅ Upgrade committed in block ${upgradeBlock}`);

    const defenseUpgrade = (await Config.methods
        .get_upgrade_by_branch_level_public(0, 0)
        .simulate({ from: admin })) as UpgradeState;

    const popCapMultiplier = toBigInt(defenseUpgrade.pop_cap_multiplier);
    const popGroMultiplier = toBigInt(defenseUpgrade.pop_gro_multiplier);
    const rangeMultiplier = toBigInt(defenseUpgrade.range_multiplier);
    const speedMultiplier = toBigInt(defenseUpgrade.speed_multiplier);
    const defenseMultiplier = toBigInt(defenseUpgrade.def_multiplier);

    const expectedPopulationCap =
        (toBigInt(capsBefore.population_cap) * popCapMultiplier) / 100n;
    const expectedPopulationGrowth =
        (toBigInt(capsBefore.population_growth) * popGroMultiplier) / 100n;
    const expectedRange = (toBigInt(capsBefore.range) * rangeMultiplier) / 100n;
    const expectedSpeed = (toBigInt(capsBefore.speed) * speedMultiplier) / 100n;
    const expectedDefense =
        (toBigInt(capsBefore.defense) * defenseMultiplier) / 100n;

    const actualPopulationCap = toBigInt(capsAfter.population_cap);
    const actualPopulationGrowth = toBigInt(capsAfter.population_growth);
    const actualRange = toBigInt(capsAfter.range);
    const actualSpeed = toBigInt(capsAfter.speed);
    const actualDefense = toBigInt(capsAfter.defense);

    assertEq('population_cap', actualPopulationCap, expectedPopulationCap);
    assertEq(
        'population_growth',
        actualPopulationGrowth,
        expectedPopulationGrowth
    );
    assertEq('range', actualRange, expectedRange);
    assertEq('speed', actualSpeed, expectedSpeed);
    assertEq('defense', actualDefense, expectedDefense);

    const expectedSilverAfter =
        toBigInt(resourcesFunded.silver) - requiredSilver;
    const actualSilverAfter = toBigInt(resourcesAfter.silver);
    assertEq('silver', actualSilverAfter, expectedSilverAfter);

    assertEq(
        'upgrade_state_0',
        toBigInt(resourcesAfter.upgrade_state_0),
        toBigInt(resourcesFunded.upgrade_state_0) + 1n
    );
    assertEq(
        'upgrade_state_1',
        toBigInt(resourcesAfter.upgrade_state_1),
        toBigInt(resourcesFunded.upgrade_state_1)
    );
    assertEq(
        'upgrade_state_2',
        toBigInt(resourcesAfter.upgrade_state_2),
        toBigInt(resourcesFunded.upgrade_state_2)
    );

    console.log('\n📊 Before/After comparison');
    console.log(
        stringifyBigints({
            upgradeMultipliersDefenseLevel0: defenseUpgrade,
            capsBefore: capSummary(capsBefore),
            capsAfter: capSummary(capsAfter),
            resourcesBefore: resourceSummary(resourcesFunded),
            resourcesAfter: resourceSummary(resourcesAfter),
            computed: {
                silverCostPercentLevel0: firstCostPercent,
                silverCostApplied: requiredSilver,
                expectedSilverAfter,
                expectedPopulationCap,
                expectedPopulationGrowth,
                expectedRange,
                expectedSpeed,
                expectedDefense,
            },
        })
    );

    const maybe120 =
        popCapMultiplier === 120n &&
        popGroMultiplier === 120n &&
        defenseMultiplier === 120n;
    console.log(
        `\n✅ Validation passed. Defense branch level 0 multipliers are ${maybe120 ? '120% for pop_cap/pop_gro/defense' : `${popCapMultiplier}%/${popGroMultiplier}%/${defenseMultiplier}%`} on this config.`
    );

    // Keep toNum referenced to avoid lint failures if strict unused checks are enabled later.
    if (toNum(resourcesAfter.upgrade_state_0) < 1) {
        throw new Error('Unexpected upgrade_state_0 after upgrade');
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
