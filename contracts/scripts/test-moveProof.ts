/**
 * Test script for move proof validation.
 *
 * Computes move circuit outputs (source_hash, target_hash, perlin) using client
 * logic (Poseidon2 + perlin) and validates consistency. Prepares for contract
 * proof verification when ZK checks are enabled.
 *
 * Usage:
 *   node --experimental-transform-types scripts/test-moveProof.ts [x1] [y1] [x2] [y2]
 *
 * Default coords: (0, 0) -> (50, 0) (same as test-move)
 *
 * With --from-chain: loads SnarkConfig from Config contract (requires deploy + configure).
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { getTestContext } from './test-setup.ts';
import {
    buildLocationProofInputs,
    buildMoveProofInputs,
    computeLocationProofOutputs,
    computeMoveProofOutputs,
    validateLocationProofOutputs,
    validateMoveProofOutputs,
} from './utils/moveProofValidation.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function toBigint(v: unknown): bigint {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return BigInt(String(v ?? 0));
}

async function main() {
    const args = process.argv.slice(2);
    const fromChain = args.includes('--from-chain');
    const rest = args.filter((a) => a !== '--from-chain');

    const x1 = rest[0] != null ? Number(rest[0]) : 0;
    const y1 = rest[1] != null ? Number(rest[1]) : 0;
    const x2 = rest[2] != null ? Number(rest[2]) : 50;
    const y2 = rest[3] != null ? Number(rest[3]) : 0;

    const r = 100n; // spawn radius
    const distMax = 50n;

    let snarkConfig: {
        planethash_key: bigint | number;
        spacetype_key: bigint | number;
        perlin_length_scale: bigint | number;
        perlin_mirror_x: boolean;
        perlin_mirror_y: boolean;
    };

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
        const raw = await Config.methods
            .get_snark_config()
            .simulate({ from: user });
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

    const inputs = buildMoveProofInputs(
        snarkConfig,
        r,
        distMax,
        x1,
        y1,
        x2,
        y2
    );

    console.log('\n📊 Move proof inputs:');
    console.log('   (x1, y1):', x1, y1, '(source)');
    console.log('   (x2, y2):', x2, y2, '(destination)');
    console.log('   r:', r, ', distMax:', distMax);

    // Circuit constraints (same as move.nr)
    const distSq = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    const distMaxSq = Number(distMax) ** 2;
    const rSq = Number(r) ** 2;
    const destDistSq = x2 * x2 + y2 * y2;

    if (destDistSq >= rSq) {
        console.error(
            '\n❌ Destination radius check FAIL: x2²+y2² >= r². Move would be invalid.'
        );
        process.exit(1);
    }
    if (distSq > distMaxSq) {
        console.error(
            '\n❌ Distance check FAIL: (x1-x2)²+(y1-y2)² > distMax². Move would be invalid.'
        );
        process.exit(1);
    }
    console.log('   ✓ Radius check: x2²+y2² < r²');
    console.log('   ✓ Distance check: (x1-x2)²+(y1-y2)² <= distMax²');

    console.log('\n🔄 Computing move proof outputs...');
    const outputs = await computeMoveProofOutputs(inputs);

    console.log('\n📤 Move proof outputs (match circuit move_proof return):');
    console.log('   sourceHash (sourceLoc):', outputs.sourceHash.toString());
    console.log('   targetHash (targetLoc):', outputs.targetHash.toString());
    console.log('   perlin (destination):', outputs.perlin);

    // Self-consistency: validate outputs against themselves
    const validation = validateMoveProofOutputs(
        outputs.sourceHash,
        outputs.targetHash,
        outputs.perlin,
        outputs
    );

    if (validation.valid) {
        console.log('\n✅ Move proof validation PASSED');
    } else {
        console.error('\n❌ Move proof validation FAILED:');
        validation.mismatches.forEach((m) => console.error('   -', m));
        process.exit(1);
    }

    console.log('\n💡 Use these values for Move.move() args:');
    console.log('   sourceLoc:', outputs.sourceHash.toString());
    console.log('   targetLoc:', outputs.targetHash.toString());
    console.log('   targetPerlin:', Math.floor(outputs.perlin));

    // -----------------------------------------------------------------------
    // Location proof (single-location: init / reveal / safe_set_owner)
    // -----------------------------------------------------------------------
    console.log('\n' + '='.repeat(60));
    console.log('Location proof (single-location) tests');
    console.log('='.repeat(60));

    const locInputs = buildLocationProofInputs(snarkConfig, x2, y2);
    console.log('\n🔄 Computing location proof for (%d, %d)...', x2, y2);
    const locOutputs = await computeLocationProofOutputs(locInputs);

    console.log('   locationHash:', locOutputs.locationHash.toString());
    console.log('   perlin:', locOutputs.perlin);

    // The location hash should match the move proof's target hash (same coords)
    if (locOutputs.locationHash !== outputs.targetHash) {
        console.error(
            '\n❌ Location hash != move target hash for same coords!'
        );
        process.exit(1);
    }
    console.log('   ✓ locationHash matches move targetHash for same coords');

    if (Math.floor(locOutputs.perlin) !== Math.floor(outputs.perlin)) {
        console.error(
            '\n❌ Location perlin != move target perlin for same coords!'
        );
        process.exit(1);
    }
    console.log('   ✓ perlin matches move targetPerlin for same coords');

    const locValidation = validateLocationProofOutputs(
        locOutputs.locationHash,
        locOutputs.perlin,
        locOutputs
    );
    if (locValidation.valid) {
        console.log('\n✅ Location proof validation PASSED');
    } else {
        console.error('\n❌ Location proof validation FAILED:');
        locValidation.mismatches.forEach((m) => console.error('   -', m));
        process.exit(1);
    }

    // Test source coords too
    const srcLocInputs = buildLocationProofInputs(snarkConfig, x1, y1);
    const srcLocOutputs = await computeLocationProofOutputs(srcLocInputs);
    if (srcLocOutputs.locationHash !== outputs.sourceHash) {
        console.error(
            '\n❌ Source location hash != move source hash for same coords!'
        );
        process.exit(1);
    }
    console.log(
        '   ✓ source locationHash matches move sourceHash for (%d, %d)',
        x1,
        y1
    );

    console.log('\n✅ All proof tests PASSED');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
