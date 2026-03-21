/**
 * Test script for move proof and location proof validation.
 *
 * - Move proof: (x1,y1)->(x2,y2) → sourceHash, targetHash, perlin (matches move_proof circuit).
 * - Location proof: (x,y) → locationHash, perlin (matches reveal_proof / init_proof for
 *   reveal_location and initialize_player).
 *
 * Usage (from repo root recommended so workspace deps resolve):
 *   pnpm run test:moveProof              — multiple move + reveal/init location proof tests
 *   pnpm run test:moveProof [x1] [y1] [x2] [y2]  — single move test + reveal/init tests
 *
 * With --from-chain: loads SnarkConfig from Config contract (requires deploy + configure).
 */

/** [x1, y1, x2, y2] — all valid for r=100, distMax=50 (dest in radius, dist² ≤ distMax²). */
const MULTI_TEST_CASES: [number, number, number, number][] = [
    [0, 0, 50, 0],
    [0, 0, 0, 50],
    [0, 0, 30, 40],
    [10, 10, 40, 40],
    [-10, -10, 20, 20],
    [50, 0, 0, 0],
    [5, -5, -5, 5],
    [-20, 0, 20, 0],
];

/** [x, y] — coords for reveal_location / initialize_player location-proof tests. */
const LOCATION_PROOF_COORDS: [number, number][] = [
    [0, 0],
    [50, 0],
    [0, 50],
    [30, 40],
    [-10, -10],
    [99, 0],
    [0, -70],
];

import { unwrapSimulateResult } from '../utils/index.ts';
import {
    buildLocationProofInputs,
    buildMoveProofInputs,
    computeLocationProofOutputs,
    computeMoveProofOutputs,
    validateLocationProofOutputs,
    validateMoveProofOutputs,
} from '../utils/moveProofValidation.ts';
import { getTestContext } from './test-setup.ts';

function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

type SnarkConfig = {
    planethash_key: bigint | number;
    spacetype_key: bigint | number;
    perlin_length_scale: bigint | number;
    perlin_mirror_x: boolean;
    perlin_mirror_y: boolean;
};

const r = 100n;
const distMax = 50n;

function checkConstraints(
    x1: number,
    y1: number,
    x2: number,
    y2: number
): string | null {
    const distSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    const distMaxSq = Number(distMax) ** 2;
    const rSq = Number(r) ** 2;
    const destDistSq = x2 * x2 + y2 * y2;
    if (destDistSq >= rSq)
        return `Destination radius check FAIL: (${x2},${y2}) x2²+y2² >= r²`;
    if (distSq > distMaxSq)
        return `Distance check FAIL: dist² ${distSq} > distMax² ${distMaxSq}`;
    return null;
}

async function runOneMoveProofTest(
    snarkConfig: SnarkConfig,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    verbose: boolean
): Promise<string | null> {
    const fail = checkConstraints(x1, y1, x2, y2);
    if (fail) return fail;

    const inputs = buildMoveProofInputs(
        snarkConfig,
        r,
        distMax,
        x1,
        y1,
        x2,
        y2
    );
    const outputs = await computeMoveProofOutputs(inputs);

    const validation = validateMoveProofOutputs(
        outputs.sourceHash,
        outputs.targetHash,
        outputs.perlin,
        outputs
    );
    if (!validation.valid)
        return `Move proof validation: ${validation.mismatches.join('; ')}`;

    const locInputs = buildLocationProofInputs(snarkConfig, x2, y2);
    const locOutputs = await computeLocationProofOutputs(locInputs);
    if (locOutputs.locationHash !== outputs.targetHash)
        return 'Location hash != move targetHash for same coords';
    if (Math.floor(locOutputs.perlin) !== Math.floor(outputs.perlin))
        return 'Location perlin != move targetPerlin for same coords';

    const locValidation = validateLocationProofOutputs(
        locOutputs.locationHash,
        locOutputs.perlin,
        locOutputs
    );
    if (!locValidation.valid)
        return `Location proof: ${locValidation.mismatches.join('; ')}`;

    const srcLocOutputs = await computeLocationProofOutputs(
        buildLocationProofInputs(snarkConfig, x1, y1)
    );
    if (srcLocOutputs.locationHash !== outputs.sourceHash)
        return 'Source locationHash != move sourceHash for same coords';

    if (verbose) {
        console.log('   sourceHash:', outputs.sourceHash.toString());
        console.log('   targetHash:', outputs.targetHash.toString());
        console.log('   perlin:', outputs.perlin);
    }
    return null;
}

/** Single location proof (reveal_location / initialize_player). Returns error string or null. */
async function runOneLocationProofTest(
    snarkConfig: SnarkConfig,
    x: number,
    y: number
): Promise<string | null> {
    const inputs = buildLocationProofInputs(snarkConfig, x, y);
    const outputs = await computeLocationProofOutputs(inputs);
    const validation = validateLocationProofOutputs(
        outputs.locationHash,
        outputs.perlin,
        outputs
    );
    if (!validation.valid)
        return `Location proof: ${validation.mismatches.join('; ')}`;
    return null;
}

/** Run reveal_location / initialize_player location-proof tests. Returns number of failures. */
async function runRevealInitLocationProofTests(
    snarkConfig: SnarkConfig
): Promise<number> {
    console.log('\n' + '='.repeat(60));
    console.log('Reveal location / Init player (location proof) tests');
    console.log('='.repeat(60));
    console.log(
        '   %d coords (locationHash + perlin)',
        LOCATION_PROOF_COORDS.length
    );
    let failed = 0;
    for (let i = 0; i < LOCATION_PROOF_COORDS.length; i++) {
        const [x, y] = LOCATION_PROOF_COORDS[i];
        const err = await runOneLocationProofTest(snarkConfig, x, y);
        if (err) {
            console.error('   ❌ (%d,%d): %s', x, y, err);
            failed++;
        } else {
            console.log('   ✓ (%d,%d)', x, y);
        }
    }
    return failed;
}

async function main() {
    const args = process.argv.slice(2);
    const fromChain = args.includes('--from-chain');
    const rest = args.filter((a) => a !== '--from-chain');

    const singleCoords =
        rest.length >= 4 &&
        rest.every((a) => a !== '' && !Number.isNaN(Number(a)))
            ? ([
                  Number(rest[0]),
                  Number(rest[1]),
                  Number(rest[2]),
                  Number(rest[3]),
              ] as [number, number, number, number])
            : null;

    let snarkConfig: SnarkConfig;

    if (fromChain) {
        console.log('📥 Loading SnarkConfig from chain...');
        const ctx = await getTestContext();
        const Config = ctx.contracts['Config'];
        const user = ctx.accounts.users[0];
        if (!Config || !user) {
            throw new Error(
                'Config or user not loaded. Run deploy + configure first.'
            );
        }
        const raw = unwrapSimulateResult(
            await Config.methods.get_snark_config().simulate({ from: user })
        ) as {
            planethash_key: unknown;
            spacetype_key: unknown;
            perlin_length_scale: unknown;
            perlin_mirror_x: unknown;
            perlin_mirror_y: unknown;
        };
        snarkConfig = {
            planethash_key: toBigint(raw.planethash_key),
            spacetype_key: toBigint(raw.spacetype_key),
            perlin_length_scale: toBigint(raw.perlin_length_scale),
            perlin_mirror_x: Boolean(raw.perlin_mirror_x),
            perlin_mirror_y: Boolean(raw.perlin_mirror_y),
        };
        console.log('   planethash_key:', snarkConfig.planethash_key);
        console.log('   spacetype_key:', snarkConfig.spacetype_key);
        console.log('   perlin_length_scale:', snarkConfig.perlin_length_scale);
    } else {
        // Default SnarkConfig (matches SnarkConfig::zero() in Noir)
        snarkConfig = {
            planethash_key: 6279,
            spacetype_key: 6280,
            perlin_length_scale: 16384,
            perlin_mirror_x: false,
            perlin_mirror_y: false,
        };
        console.log('📋 Using default SnarkConfig (SnarkConfig::zero())');
    }

    if (singleCoords) {
        const [x1, y1, x2, y2] = singleCoords;
        console.log(
            '\n📊 Single move proof test: (%d, %d) -> (%d, %d)',
            x1,
            y1,
            x2,
            y2
        );
        console.log('   r:', r, ', distMax:', distMax);
        const err = await runOneMoveProofTest(
            snarkConfig,
            x1,
            y1,
            x2,
            y2,
            true
        );
        if (err) {
            console.error('\n❌', err);
            process.exit(1);
        }
        console.log('\n✅ Move proof validation PASSED');
        console.log(
            '\n💡 Use sourceLoc / targetLoc / targetPerlin for Move.move() args.'
        );
        const singleLocFailed =
            await runRevealInitLocationProofTests(snarkConfig);
        if (singleLocFailed > 0) {
            console.error(
                '\n❌ %d reveal/init location proof tests FAILED',
                singleLocFailed
            );
            process.exit(1);
        }
        console.log('\n✅ All reveal/init location proof tests PASSED');
        return;
    }

    console.log(
        '\n📊 Multiple move proof tests (%d cases)',
        MULTI_TEST_CASES.length
    );
    console.log('   r:', r, ', distMax:', distMax);
    let failed = 0;
    for (let i = 0; i < MULTI_TEST_CASES.length; i++) {
        const [x1, y1, x2, y2] = MULTI_TEST_CASES[i];
        const err = await runOneMoveProofTest(
            snarkConfig,
            x1,
            y1,
            x2,
            y2,
            false
        );
        if (err) {
            console.error(
                '   ❌ Case %d (%d,%d)->(%d,%d): %s',
                i + 1,
                x1,
                y1,
                x2,
                y2,
                err
            );
            failed++;
        } else {
            console.log('   ✓ Case %d (%d,%d)->(%d,%d)', i + 1, x1, y1, x2, y2);
        }
    }
    if (failed > 0) {
        console.error(
            '\n❌ %d of %d move proof tests FAILED',
            failed,
            MULTI_TEST_CASES.length
        );
        process.exit(1);
    }
    console.log('\n✅ All %d move proof tests PASSED', MULTI_TEST_CASES.length);

    const locFailed = await runRevealInitLocationProofTests(snarkConfig);
    if (locFailed > 0) {
        console.error(
            '\n❌ %d of %d reveal/init location proof tests FAILED',
            locFailed,
            LOCATION_PROOF_COORDS.length
        );
        process.exit(1);
    }
    console.log(
        '\n✅ All %d reveal/init location proof tests PASSED',
        LOCATION_PROOF_COORDS.length
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
