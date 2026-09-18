/**
 * Offline checks for configure resume helpers (CLI, classify, decideStepAction).
 * Run: pnpm test:configure-resume
 */
import {
    classifyAuthorization,
    classifyBatch1,
    classifyConfigValue,
    classifyConfigWithHash,
    classifyCumulativeRarities,
    classifyPlanetStatsRange,
    classifyPointers,
    computeExpectedCumulativeRarities,
    CONFIGURE_STEP_META,
    decideStepAction,
    deepEqualNormalized,
    EXPECTED_WORLD_CONFIG_MARKERS,
    formatConfigureUsage,
    isProtocolZero,
    isZeroHash,
    parseConfigureArgs,
    PLANET_DEFAULT_STATS,
    resolveStartIndex,
    TOTAL_CONFIGURE_STEPS,
} from '../deploy/configureResume.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
    if (cond) {
        passed++;
        console.log(`  ✅ ${msg}`);
    } else {
        failed++;
        console.error(`  ❌ ${msg}`);
    }
}

function assertEq<T>(actual: T, expected: T, msg: string) {
    const ok =
        JSON.stringify(actual, (_k, v) =>
            typeof v === 'bigint' ? v.toString() : v
        ) ===
        JSON.stringify(expected, (_k, v) =>
            typeof v === 'bigint' ? v.toString() : v
        );
    assert(ok, `${msg} (got ${String(actual)})`);
}

console.log('\n=== step catalog ===');
assert(TOTAL_CONFIGURE_STEPS === 36, '36 steps');
assert(CONFIGURE_STEP_META.length === 36, 'meta length 36');
assert(
    CONFIGURE_STEP_META.every((s, i) => s.index === i + 1),
    'indices 1..36 contiguous'
);
assert(
    CONFIGURE_STEP_META[0]!.id === 'config.batch_1',
    'first id config.batch_1'
);
assert(
    CONFIGURE_STEP_META[16]!.id === 'auth.WorldStorage.phase3',
    'phase3 starts at 17'
);
assert(
    CONFIGURE_STEP_META[25]!.id === 'ArtifactAction.set_storage',
    'phase4 pointers start at 26'
);

console.log('\n=== CLI parsing ===');
{
    const r = parseConfigureArgs([]);
    assert(r.ok === true, 'empty args ok');
    if (r.ok) {
        assert(r.options.fromToken === undefined, 'no from');
        assert(r.options.help === false, 'no help');
    }
}
{
    const r = parseConfigureArgs(['--help']);
    assert(r.ok && r.options.help, '--help');
}
{
    const r = parseConfigureArgs(['--from', 'auth.WorldStorage.phase3']);
    assert(
        r.ok && r.options.fromToken === 'auth.WorldStorage.phase3',
        '--from id'
    );
}
{
    const r = parseConfigureArgs(['--from=14']);
    assert(r.ok && r.options.fromToken === '14', '--from=number');
}
{
    const r = parseConfigureArgs(['--force-config']);
    assert(!r.ok, '--force-config is no longer supported');
}
{
    const r = parseConfigureArgs(['17']);
    assert(r.ok && r.options.legacyPositional === 17, 'legacy positional');
}
{
    const r = parseConfigureArgs(['--bogus']);
    assert(!r.ok, 'unknown flag fails');
}
{
    const r = parseConfigureArgs(['--from']);
    assert(!r.ok, '--from without value fails');
}
{
    const r = parseConfigureArgs(['--from', '17', '18']);
    assert(!r.ok, 'from + extra positional fails');
}
{
    const r = parseConfigureArgs(['--from', '17', '17']);
    // actually --from 17 and positional 17
    assert(!r.ok, 'from + positional fails');
}
{
    const r = parseConfigureArgs(['not-a-number']);
    assert(!r.ok, 'non-numeric positional fails');
}
assert(formatConfigureUsage().includes('config.batch_1'), 'usage lists steps');

console.log('\n=== resolveStartIndex ===');
{
    const r = resolveStartIndex({ help: false });
    assert(r.ok && r.startIndex === 1, 'default start 1');
}
{
    const r = resolveStartIndex({
        help: false,
        fromToken: '14',
    });
    assert(r.ok && r.startIndex === 14 && !r.legacy, 'from number');
}
{
    const r = resolveStartIndex({
        help: false,
        fromToken: 'admin.set_storage',
    });
    assert(r.ok && r.startIndex === 14, 'from id');
}
{
    const r = resolveStartIndex({
        help: false,
        legacyPositional: 17,
    });
    assert(r.ok && r.startIndex === 17 && r.legacy, 'legacy');
}
{
    const r = resolveStartIndex({
        help: false,
        fromToken: '999',
    });
    assert(!r.ok, 'out of range fails');
}
{
    const r = resolveStartIndex({
        help: false,
        fromToken: 'no.such.step',
    });
    assert(!r.ok, 'unknown id fails');
}

console.log('\n=== normalize / zero helpers ===');
assert(deepEqualNormalized(100n, 100), 'bigint/number equal');
assert(deepEqualNormalized({ a: 1n }, { a: 1 }), 'nested bigint/number');
assert(isProtocolZero(0n), '0n is zero');
assert(isProtocolZero({ x: 0n, y: false }), 'nested zero');
assert(!isProtocolZero({ x: 100n }), 'non-zero object');
assert(isZeroHash(0n), 'hash 0n');
assert(isZeroHash('0x0000'), 'hash 0x0000');
assert(!isZeroHash(123n), 'hash nonzero');

console.log('\n=== classifyConfigValue tri-state ===');
assertEq(
    classifyConfigValue(
        EXPECTED_WORLD_CONFIG_MARKERS,
        EXPECTED_WORLD_CONFIG_MARKERS
    ),
    'complete',
    'equal → complete'
);
assertEq(
    classifyConfigValue(
        {
            time_factor_hundredths: 0,
            world_radius_min: 0n,
            location_reveal_cooldown: 0n,
            silver_score_value: 0n,
            planet_transfer_enabled: false,
            admin_can_add_planets: false,
        },
        EXPECTED_WORLD_CONFIG_MARKERS
    ),
    'needed',
    'uninitialized → needed'
);
assertEq(
    classifyConfigValue(
        { ...EXPECTED_WORLD_CONFIG_MARKERS, time_factor_hundredths: 1000 },
        EXPECTED_WORLD_CONFIG_MARKERS
    ),
    'conflict',
    'customized → conflict'
);

console.log('\n=== classifyConfigWithHash ===');
assertEq(
    classifyConfigWithHash(
        EXPECTED_WORLD_CONFIG_MARKERS,
        EXPECTED_WORLD_CONFIG_MARKERS,
        0n
    ),
    'needed',
    'matching values but hash 0 → needed'
);
assertEq(
    classifyConfigWithHash(
        EXPECTED_WORLD_CONFIG_MARKERS,
        EXPECTED_WORLD_CONFIG_MARKERS,
        999n
    ),
    'complete',
    'matching + hash set → complete'
);

console.log('\n=== classifyBatch1 ===');
{
    const empty = {
        world_config: {},
        game_config_core: {},
        artifacts_config: {},
    };
    assertEq(
        classifyBatch1(empty, Array(13).fill(0n)),
        'needed',
        'empty batch1'
    );
}
{
    const full = {
        world_config: { ...EXPECTED_WORLD_CONFIG_MARKERS },
        game_config_core: {
            max_natural_planet_level: 9,
            planet_rarity: 16384n,
            perlin_threshold_1: 14,
        },
        artifacts_config: {
            token_mint_end_timestamp: 1798761600n,
            photoid_activation_delay: 14400n,
        },
    };
    const hashes = Array(13).fill(1n);
    assertEq(classifyBatch1(full, hashes), 'complete', 'defaults batch1');
    assertEq(
        classifyBatch1(
            {
                ...full,
                world_config: {
                    ...EXPECTED_WORLD_CONFIG_MARKERS,
                    time_factor_hundredths: 1000,
                },
            },
            hashes
        ),
        'conflict',
        'fast preset → conflict'
    );
}

console.log('\n=== planet stats / cumulative ===');
{
    const stats = PLANET_DEFAULT_STATS.map((p) => ({ ...p.stats }));
    assertEq(
        classifyPlanetStatsRange({ default_stats: stats }, 0, 4),
        'complete',
        'stats 0-4 complete'
    );
    stats[0] = {
        ...stats[0]!,
        population_cap: 1n as never,
    };
    assertEq(
        classifyPlanetStatsRange({ default_stats: stats }, 0, 4),
        'conflict',
        'stats conflict'
    );
    assertEq(
        classifyPlanetStatsRange({ default_stats: Array(10).fill({}) }, 0, 4),
        'needed',
        'stats needed'
    );
}
{
    const expected = computeExpectedCumulativeRarities();
    assertEq(
        classifyCumulativeRarities({ cumulative_rarities: expected }),
        'complete',
        'cumulative complete'
    );
    assertEq(
        classifyCumulativeRarities({ cumulative_rarities: Array(10).fill(0n) }),
        'needed',
        'cumulative needed'
    );
    const tweaked = [...expected];
    tweaked[0] = 1n;
    assertEq(
        classifyCumulativeRarities({ cumulative_rarities: tweaked }),
        'conflict',
        'cumulative conflict'
    );
}

console.log('\n=== pointers / auth ===');
{
    const expected = {
        config_storage_address:
            '0x00000000000000000000000000000000000000000000000000000000000000aa',
        world_storage_address:
            '0x00000000000000000000000000000000000000000000000000000000000000bb',
    };
    assertEq(
        classifyPointers(
            {
                config_storage_address: expected.config_storage_address,
                world_storage_address: expected.world_storage_address,
            },
            expected,
            ['config_storage_address', 'world_storage_address']
        ),
        'complete',
        'pointers match'
    );
    assertEq(
        classifyPointers(
            {
                config_storage_address:
                    '0x0000000000000000000000000000000000000000000000000000000000000000',
                world_storage_address: expected.world_storage_address,
            },
            expected,
            ['config_storage_address', 'world_storage_address']
        ),
        'needed',
        'pointers partial → needed'
    );
}
assertEq(classifyAuthorization([true, true]), 'complete', 'auth complete');
assertEq(classifyAuthorization([true, false]), 'needed', 'auth partial');

console.log('\n=== decideStepAction ===');
{
    const step = CONFIGURE_STEP_META[0]!; // config.batch_1
    assertEq(
        decideStepAction({
            step,
            status: 'complete',
            startIndex: 1,
        }).action,
        'skip',
        'complete → skip'
    );
    assertEq(
        decideStepAction({
            step,
            status: 'needed',
            startIndex: 1,
        }).action,
        'execute',
        'needed → execute'
    );
    assertEq(
        decideStepAction({
            step,
            status: 'conflict',
            startIndex: 1,
        }).action,
        'execute',
        'conflict executes and restores defaults'
    );
}
{
    const prior = CONFIGURE_STEP_META[0]!;
    const abort = decideStepAction({
        step: prior,
        status: 'needed',
        startIndex: 17,
    });
    assert(
        abort.action === 'skip',
        'Phase 1 is skipped by --from without preflight'
    );
    assertEq(
        decideStepAction({
            step: prior,
            status: 'conflict',
            startIndex: 17,
        }).action,
        'skip',
        'Phase 1 conflict skipped by --from'
    );
    assertEq(
        decideStepAction({
            step: prior,
            status: 'complete',
            startIndex: 17,
        }).action,
        'skip',
        'preflight skip complete'
    );
}
{
    // Partial auth batch resume: step itself needed → execute (inner batch skips authorized)
    const authStep = CONFIGURE_STEP_META[16]!;
    assertEq(
        decideStepAction({
            step: authStep,
            status: 'needed',
            startIndex: 17,
        }).action,
        'execute',
        'partial auth step executes'
    );
}

console.log(`\n=== results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
