/**
 * Pure helpers for configure resume: CLI parsing and step status classification.
 * Config initialization always writes deployment defaults; later phases are
 * checked against on-chain state. Used by configure.ts and unit tests.
 */

export type ConfigurePhase = 1 | 2 | 3 | 4;

export type StepStatus = 'complete' | 'needed' | 'conflict';

export type ConfigureStepMeta = {
    id: string;
    index: number;
    phase: ConfigurePhase;
    label: string;
    /** Phase 1 Config writes always reset to deployment defaults. */
    isConfig: boolean;
};

export type ConfigureCliOptions = {
    fromToken?: string;
    /** Deprecated: bare numeric argv (e.g. `pnpm configure -- 17`). */
    legacyPositional?: number;
    help: boolean;
};

export type ParseConfigureArgsResult =
    | { ok: true; options: ConfigureCliOptions }
    | { ok: false; error: string };

/** Stable step catalog (order matches configure.ts). */
export const CONFIGURE_STEP_META: readonly ConfigureStepMeta[] = [
    {
        id: 'config.batch_1',
        index: 1,
        phase: 1,
        label: 'Config.set_default_configs_batch_1()',
        isConfig: true,
    },
    {
        id: 'config.batch_2',
        index: 2,
        phase: 1,
        label: 'Config.set_default_configs_batch_2()',
        isConfig: true,
    },
    {
        id: 'config.planet_weights_tier_0',
        index: 3,
        phase: 1,
        label: 'Config.set_default_game_config_planet_type_weights_tier(0)',
        isConfig: true,
    },
    {
        id: 'config.planet_weights_tier_1',
        index: 4,
        phase: 1,
        label: 'Config.set_default_game_config_planet_type_weights_tier(1)',
        isConfig: true,
    },
    {
        id: 'config.planet_weights_tier_2',
        index: 5,
        phase: 1,
        label: 'Config.set_default_game_config_planet_type_weights_tier(2)',
        isConfig: true,
    },
    {
        id: 'config.planet_weights_tier_3',
        index: 6,
        phase: 1,
        label: 'Config.set_default_game_config_planet_type_weights_tier(3)',
        isConfig: true,
    },
    {
        id: 'config.planet_stats_0_4',
        index: 7,
        phase: 1,
        label: 'Config.set_planet_default_stats_batch(0-4)',
        isConfig: true,
    },
    {
        id: 'config.planet_stats_5_9',
        index: 8,
        phase: 1,
        label: 'Config.set_planet_default_stats_batch(5-9)',
        isConfig: true,
    },
    {
        id: 'config.init_upgrades_defense',
        index: 9,
        phase: 1,
        label: 'Config.initialize_upgrades_defense()',
        isConfig: true,
    },
    {
        id: 'config.init_upgrades_range',
        index: 10,
        phase: 1,
        label: 'Config.initialize_upgrades_range()',
        isConfig: true,
    },
    {
        id: 'config.init_upgrades_speed',
        index: 11,
        phase: 1,
        label: 'Config.initialize_upgrades_speed()',
        isConfig: true,
    },
    {
        id: 'config.default_upgrade',
        index: 12,
        phase: 1,
        label: 'Config.set_default_upgrade_config()',
        isConfig: true,
    },
    {
        id: 'config.cumulative_rarities',
        index: 13,
        phase: 1,
        label: 'Config.initialize_cumulative_rarities()',
        isConfig: true,
    },
    {
        id: 'admin.set_storage',
        index: 14,
        phase: 2,
        label: 'Admin.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'core.set_storage',
        index: 15,
        phase: 2,
        label: 'Core.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'move.set_storage',
        index: 16,
        phase: 2,
        label: 'Move.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'auth.WorldStorage.phase3',
        index: 17,
        phase: 3,
        label: 'WorldStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.PlayerStorage.phase3',
        index: 18,
        phase: 3,
        label: 'PlayerStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.PlanetStorage.phase3',
        index: 19,
        phase: 3,
        label: 'PlanetStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.PlanetRevealedCoordsStorage.phase3',
        index: 20,
        phase: 3,
        label: 'PlanetRevealedCoordsStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.PlanetEventsStorage.phase3',
        index: 21,
        phase: 3,
        label: 'PlanetEventsStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.PlanetArtifactsStorage.phase3',
        index: 22,
        phase: 3,
        label: 'PlanetArtifactsStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.ArrivalStorage.phase3',
        index: 23,
        phase: 3,
        label: 'ArrivalStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.ArtifactStorage.phase3',
        index: 24,
        phase: 3,
        label: 'ArtifactStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'auth.ArtifactLocationStorage.phase3',
        index: 25,
        phase: 3,
        label: 'ArtifactLocationStorage.add_authorized_contracts_batch()',
        isConfig: false,
    },
    {
        id: 'ArtifactAction.set_storage',
        index: 26,
        phase: 4,
        label: 'ArtifactAction.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'ArtifactFind.set_storage',
        index: 27,
        phase: 4,
        label: 'ArtifactFind.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'ArtifactProspect.set_storage',
        index: 28,
        phase: 4,
        label: 'ArtifactProspect.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'ArtifactValut.set_storage',
        index: 29,
        phase: 4,
        label: 'ArtifactValut.set_all_storage_addresses()',
        isConfig: false,
    },
    {
        id: 'auth.WorldStorage.phase4_artifacts',
        index: 30,
        phase: 4,
        label: 'WorldStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
    {
        id: 'auth.PlayerStorage.phase4_artifacts',
        index: 31,
        phase: 4,
        label: 'PlayerStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
    {
        id: 'auth.PlanetStorage.phase4_artifacts',
        index: 32,
        phase: 4,
        label: 'PlanetStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
    {
        id: 'auth.PlanetArtifactsStorage.phase4_artifacts',
        index: 33,
        phase: 4,
        label: 'PlanetArtifactsStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
    {
        id: 'auth.PlanetEventsStorage.phase4_artifacts',
        index: 34,
        phase: 4,
        label: 'PlanetEventsStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
    {
        id: 'auth.ArtifactStorage.phase4_artifacts',
        index: 35,
        phase: 4,
        label: 'ArtifactStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
    {
        id: 'auth.ArtifactLocationStorage.phase4_artifacts',
        index: 36,
        phase: 4,
        label: 'ArtifactLocationStorage.add_authorized_contracts_batch(artifact systems)',
        isConfig: false,
    },
] as const;

export const TOTAL_CONFIGURE_STEPS = CONFIGURE_STEP_META.length;

/** Planet default stats written by configure (levels 0–9). */
export const PLANET_DEFAULT_STATS = [
    {
        level: 0,
        stats: {
            population_cap: 100000n,
            population_growth: 417n,
            range: 99n,
            speed: 75n,
            defense: 400n,
            silver_growth: 0n,
            silver_cap: 0n,
            barbarian_percentage: 0n,
        },
    },
    {
        level: 1,
        stats: {
            population_cap: 400000n,
            population_growth: 833n,
            range: 177n,
            speed: 75n,
            defense: 400n,
            silver_growth: 56n,
            silver_cap: 100000n,
            barbarian_percentage: 1n,
        },
    },
    {
        level: 2,
        stats: {
            population_cap: 1600000n,
            population_growth: 1250n,
            range: 315n,
            speed: 75n,
            defense: 300n,
            silver_growth: 167n,
            silver_cap: 500000n,
            barbarian_percentage: 2n,
        },
    },
    {
        level: 3,
        stats: {
            population_cap: 6000000n,
            population_growth: 1667n,
            range: 591n,
            speed: 75n,
            defense: 300n,
            silver_growth: 417n,
            silver_cap: 2500000n,
            barbarian_percentage: 3n,
        },
    },
    {
        level: 4,
        stats: {
            population_cap: 25000000n,
            population_growth: 2083n,
            range: 1025n,
            speed: 75n,
            defense: 300n,
            silver_growth: 833n,
            silver_cap: 12000000n,
            barbarian_percentage: 4n,
        },
    },
    {
        level: 5,
        stats: {
            population_cap: 100000000n,
            population_growth: 2500n,
            range: 1734n,
            speed: 75n,
            defense: 200n,
            silver_growth: 1667n,
            silver_cap: 50000000n,
            barbarian_percentage: 5n,
        },
    },
    {
        level: 6,
        stats: {
            population_cap: 300000000n,
            population_growth: 2917n,
            range: 2838n,
            speed: 75n,
            defense: 200n,
            silver_growth: 2778n,
            silver_cap: 100000000n,
            barbarian_percentage: 7n,
        },
    },
    {
        level: 7,
        stats: {
            population_cap: 500000000n,
            population_growth: 3333n,
            range: 4414n,
            speed: 75n,
            defense: 200n,
            silver_growth: 2778n,
            silver_cap: 200000000n,
            barbarian_percentage: 10n,
        },
    },
    {
        level: 8,
        stats: {
            population_cap: 700000000n,
            population_growth: 3750n,
            range: 6306n,
            speed: 75n,
            defense: 200n,
            silver_growth: 2778n,
            silver_cap: 300000000n,
            barbarian_percentage: 20n,
        },
    },
    {
        level: 9,
        stats: {
            population_cap: 800000000n,
            population_growth: 4167n,
            range: 8829n,
            speed: 75n,
            defense: 200n,
            silver_growth: 2778n,
            silver_cap: 400000000n,
            barbarian_percentage: 25n,
        },
    },
] as const;

export type UpgradeExpectation = {
    pop_cap_multiplier: bigint;
    pop_gro_multiplier: bigint;
    range_multiplier: bigint;
    speed_multiplier: bigint;
    def_multiplier: bigint;
};

/** Matches Config.initialize_upgrades_defense keys 0..3. */
export const EXPECTED_UPGRADE_DEFENSE: UpgradeExpectation = {
    pop_cap_multiplier: 120n,
    pop_gro_multiplier: 120n,
    range_multiplier: 100n,
    speed_multiplier: 100n,
    def_multiplier: 120n,
};

/** Matches Config.initialize_upgrades_range keys 10..13. */
export const EXPECTED_UPGRADE_RANGE: UpgradeExpectation = {
    pop_cap_multiplier: 120n,
    pop_gro_multiplier: 120n,
    range_multiplier: 125n,
    speed_multiplier: 100n,
    def_multiplier: 100n,
};

/** Matches Config.initialize_upgrades_speed keys 20..23. */
export const EXPECTED_UPGRADE_SPEED: UpgradeExpectation = {
    pop_cap_multiplier: 120n,
    pop_gro_multiplier: 120n,
    range_multiplier: 100n,
    speed_multiplier: 175n,
    def_multiplier: 100n,
};

/** Matches UpgradeConfig::zero() / set_default_upgrade_config. */
export const EXPECTED_UPGRADE_CONFIG = {
    silver_cost_percent: 20n,
    max_total_level_nebula: 3,
    max_total_level_space: 4,
    max_total_level_deep_space: 5,
    max_total_level_dead_space: 5,
    max_branch_level: 4,
} as const;

/** Matches WorldConfig::zero() distinctive fields. */
export const EXPECTED_WORLD_CONFIG_MARKERS = {
    time_factor_hundredths: 100,
    world_radius_min: 53000n,
    location_reveal_cooldown: 86400n,
    silver_score_value: 100n,
    planet_transfer_enabled: true,
    admin_can_add_planets: true,
} as const;

/** Matches GameConfigCore::zero() distinctive fields. */
export const EXPECTED_GAME_CONFIG_CORE_MARKERS = {
    max_natural_planet_level: 9,
    planet_rarity: 16384n,
    perlin_threshold_1: 14,
} as const;

/** Matches ArtifactsConfig::zero() distinctive fields. */
export const EXPECTED_ARTIFACTS_CONFIG_MARKERS = {
    token_mint_end_timestamp: 1798761600n,
    photoid_activation_delay: 14400n,
} as const;

/** Matches SpaceJunkConfig::zero() distinctive fields. */
export const EXPECTED_SPACE_JUNK_MARKERS = {
    space_junk_enabled: false,
    space_junk_limit: 10000n,
    abandon_speed_change_percent: 150n,
    abandon_range_change_percent: 150n,
} as const;

/** Matches CaptureZonesConfig::zero() distinctive fields. */
export const EXPECTED_CAPTURE_ZONES_MARKERS = {
    capture_zones_enabled: true,
    capture_zone_change_block_interval: 255n,
    capture_zone_radius: 1000n,
    capture_zone_hold_blocks_required: 255n,
    capture_zones_per_5000_world_radius: 3n,
} as const;

/** PlanetLevelThresholds::zero().thresholds */
export const EXPECTED_PLANET_LEVEL_THRESHOLDS = [
    16777216n,
    4194292n,
    1048561n,
    262128n,
    65520n,
    16368n,
    4080n,
    1008n,
    240n,
    48n,
] as const;

/** PlanetTypeWeightsTier::zero(tier).weights */
export const EXPECTED_PLANET_TYPE_WEIGHTS: ReadonlyArray<
    ReadonlyArray<ReadonlyArray<bigint>>
> = [
    [
        [1n, 0n, 0n, 0n, 0n],
        [13n, 2n, 0n, 1n, 0n],
        [13n, 2n, 0n, 1n, 0n],
        [13n, 2n, 0n, 0n, 1n],
        [13n, 2n, 0n, 0n, 1n],
        [13n, 2n, 0n, 0n, 1n],
        [13n, 2n, 0n, 0n, 1n],
        [13n, 2n, 0n, 0n, 1n],
        [13n, 2n, 0n, 0n, 1n],
        [13n, 2n, 0n, 0n, 1n],
    ],
    [
        [1n, 0n, 0n, 0n, 0n],
        [13n, 2n, 1n, 0n, 0n],
        [12n, 2n, 1n, 1n, 0n],
        [11n, 2n, 1n, 1n, 1n],
        [12n, 2n, 1n, 0n, 1n],
        [12n, 2n, 1n, 0n, 1n],
        [12n, 2n, 1n, 0n, 1n],
        [12n, 2n, 1n, 0n, 1n],
        [12n, 2n, 1n, 0n, 1n],
        [12n, 2n, 1n, 0n, 1n],
    ],
    [
        [1n, 0n, 0n, 0n, 0n],
        [10n, 4n, 2n, 0n, 0n],
        [10n, 4n, 1n, 1n, 0n],
        [8n, 4n, 1n, 2n, 1n],
        [8n, 4n, 1n, 2n, 1n],
        [8n, 4n, 1n, 2n, 1n],
        [8n, 4n, 1n, 2n, 1n],
        [8n, 4n, 1n, 2n, 1n],
        [8n, 4n, 1n, 2n, 1n],
        [8n, 4n, 1n, 2n, 1n],
    ],
    [
        [1n, 0n, 0n, 0n, 0n],
        [11n, 4n, 1n, 0n, 0n],
        [11n, 4n, 1n, 0n, 0n],
        [7n, 4n, 2n, 2n, 1n],
        [7n, 4n, 2n, 2n, 1n],
        [7n, 4n, 2n, 2n, 1n],
        [7n, 4n, 2n, 2n, 1n],
        [7n, 4n, 2n, 2n, 1n],
        [7n, 4n, 2n, 2n, 1n],
        [7n, 4n, 2n, 2n, 1n],
    ],
];

const ZERO_ADDRESS =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

export function computeExpectedCumulativeRarities(
    thresholds: readonly bigint[] = EXPECTED_PLANET_LEVEL_THRESHOLDS,
    planetRarity: bigint = 16384n
): bigint[] {
    const base = 1n << 24n;
    return thresholds.map((t) => {
        if (t === 0n) throw new Error('threshold must be nonzero');
        return (base / t) * planetRarity;
    });
}

export function formatConfigureUsage(): string {
    const lines = CONFIGURE_STEP_META.map(
        (s) => `  ${String(s.index).padStart(2)}. ${s.id}  (phase ${s.phase})`
    );
    return (
        'Usage:\n' +
        '  pnpm configure\n' +
        '  pnpm configure --from <step-id|number>\n' +
        '  pnpm configure --help\n\n' +
        'Steps:\n' +
        lines.join('\n') +
        '\n\nNotes:\n' +
        '  - Phase 1 Config steps always write deployment defaults.\n' +
        '  - --from skips execution before that step; Phase 2–4 prior steps are preflight-checked.\n' +
        '  - Legacy: `pnpm configure -- <number>` still works (prefer --from).\n'
    );
}

export function parseConfigureArgs(argv: string[]): ParseConfigureArgsResult {
    const args = argv.filter((a) => a !== '--');
    let fromToken: string | undefined;
    let help = false;
    let legacyPositional: number | undefined;
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--help' || arg === '-h') {
            help = true;
            continue;
        }
        if (arg === '--from') {
            const next = args[i + 1];
            if (!next || next.startsWith('-')) {
                return {
                    ok: false,
                    error:
                        '--from requires a step id or number\n\n' +
                        formatConfigureUsage(),
                };
            }
            fromToken = next;
            i++;
            continue;
        }
        if (arg.startsWith('--from=')) {
            fromToken = arg.slice('--from='.length);
            if (!fromToken) {
                return {
                    ok: false,
                    error:
                        '--from requires a step id or number\n\n' +
                        formatConfigureUsage(),
                };
            }
            continue;
        }
        if (arg.startsWith('-')) {
            return {
                ok: false,
                error: `Unknown option: ${arg}\n\n` + formatConfigureUsage(),
            };
        }
        positionals.push(arg);
    }

    if (positionals.length > 1) {
        return {
            ok: false,
            error:
                `Too many positional arguments: ${positionals.join(' ')}\n\n` +
                formatConfigureUsage(),
        };
    }

    if (positionals.length === 1) {
        const n = Number.parseInt(positionals[0]!, 10);
        if (!Number.isInteger(n) || String(n) !== positionals[0]) {
            return {
                ok: false,
                error:
                    `Invalid positional step number: ${positionals[0]}\n\n` +
                    formatConfigureUsage(),
            };
        }
        legacyPositional = n;
    }

    if (fromToken !== undefined && legacyPositional !== undefined) {
        return {
            ok: false,
            error:
                'Use either --from or a legacy positional step number, not both\n\n' +
                formatConfigureUsage(),
        };
    }

    return {
        ok: true,
        options: { fromToken, legacyPositional, help },
    };
}

export function resolveStartIndex(
    options: ConfigureCliOptions,
    steps: readonly ConfigureStepMeta[] = CONFIGURE_STEP_META
):
    | { ok: true; startIndex: number; legacy: boolean }
    | { ok: false; error: string } {
    const token =
        options.fromToken ??
        (options.legacyPositional !== undefined
            ? String(options.legacyPositional)
            : undefined);
    if (token === undefined) {
        return { ok: true, startIndex: 1, legacy: false };
    }

    const asNum = Number.parseInt(token, 10);
    if (Number.isInteger(asNum) && String(asNum) === token) {
        if (asNum < 1 || asNum > steps.length) {
            return {
                ok: false,
                error:
                    `Step number out of range: ${asNum} (valid 1–${steps.length})\n\n` +
                    formatConfigureUsage(),
            };
        }
        return {
            ok: true,
            startIndex: asNum,
            legacy: options.legacyPositional !== undefined,
        };
    }

    const found = steps.find((s) => s.id === token);
    if (!found) {
        return {
            ok: false,
            error: `Unknown step id: ${token}\n\n` + formatConfigureUsage(),
        };
    }
    return { ok: true, startIndex: found.index, legacy: false };
}

/** Normalize values from simulate results for deep equality (bigint/number/address). */
export function normalizeDeep(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return value;
        if (Number.isInteger(value)) return BigInt(value);
        return value;
    }
    if (typeof value === 'boolean' || typeof value === 'string') {
        if (
            typeof value === 'string' &&
            /^0x[0-9a-fA-F]+$/.test(value) &&
            value.length >= 42
        ) {
            return value.toLowerCase();
        }
        return value;
    }
    if (typeof value === 'object') {
        if (
            typeof (value as { toString?: () => string }).toString ===
                'function' &&
            Object.keys(value as object).length === 0
        ) {
            // AztecAddress / Fr-like
            const s = (value as { toString: () => string }).toString();
            if (/^0x[0-9a-fA-F]+$/.test(s)) return s.toLowerCase();
        }
        if (Array.isArray(value)) {
            return value.map(normalizeDeep);
        }
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = normalizeDeep(v);
        }
        return out;
    }
    return value;
}

export function deepEqualNormalized(a: unknown, b: unknown): boolean {
    return (
        JSON.stringify(normalizeDeep(a), jsonReplacer) ===
        JSON.stringify(normalizeDeep(b), jsonReplacer)
    );
}

function jsonReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

/** True if value is protocol-empty (0 / false / empty nested). */
export function isProtocolZero(value: unknown): boolean {
    const n = normalizeDeep(value);
    if (n === null || n === undefined) return true;
    if (typeof n === 'boolean') return n === false;
    if (typeof n === 'bigint') return n === 0n;
    if (typeof n === 'number') return n === 0;
    if (typeof n === 'string') {
        if (n === '' || n === '0x' || n.toLowerCase() === ZERO_ADDRESS)
            return true;
        if (/^0x0+$/i.test(n)) return true;
        return false;
    }
    if (Array.isArray(n)) return n.every(isProtocolZero);
    if (typeof n === 'object') {
        return Object.values(n as Record<string, unknown>).every(
            isProtocolZero
        );
    }
    return false;
}

export function isZeroHash(hash: unknown): boolean {
    if (hash === null || hash === undefined) return true;
    if (typeof hash === 'bigint') return hash === 0n;
    if (typeof hash === 'number') return hash === 0;
    if (typeof hash === 'string') {
        if (hash === '' || hash === '0x') return true;
        if (/^0x0+$/i.test(hash)) return true;
        if (hash === '0') return true;
        try {
            return BigInt(hash) === 0n;
        } catch {
            return false;
        }
    }
    if (
        typeof hash === 'object' &&
        typeof (hash as { toString?: () => string }).toString === 'function'
    ) {
        return isZeroHash((hash as { toString: () => string }).toString());
    }
    return false;
}

/**
 * Classify config slice vs expected defaults.
 * - equal expected → complete
 * - protocol-zero / uninitialized → needed
 * - anything else → conflict
 */
export function classifyConfigValue(
    actual: unknown,
    expected: unknown
): StepStatus {
    if (deepEqualNormalized(actual, expected)) return 'complete';
    if (isProtocolZero(actual)) return 'needed';
    return 'conflict';
}

/**
 * Like classifyConfigValue, but also treats hash===0 as uninitialized even when
 * values happen to look like defaults (defense for edge cases).
 */
export function classifyConfigWithHash(
    actual: unknown,
    expected: unknown,
    hash: unknown
): StepStatus {
    if (isZeroHash(hash)) {
        if (deepEqualNormalized(actual, expected)) {
            // Values match defaults but hash never written — treat as needed so we
            // still run the setter (writes hash). Rare; usually values are also zero.
            return 'needed';
        }
        if (isProtocolZero(actual)) return 'needed';
        return 'conflict';
    }
    return classifyConfigValue(actual, expected);
}

/** Pointers: complete iff every expected address matches; otherwise needed (safe overwrite). */
export function classifyPointers(
    onChain: Record<string, unknown>,
    expected: Record<string, string>,
    fieldNames: readonly string[]
): StepStatus {
    for (const field of fieldNames) {
        const raw = getFieldLoose(onChain, field);
        const got = normalizeAddressLoose(raw);
        const want = expected[field]?.toLowerCase();
        if (!want) continue;
        if (got !== want) return 'needed';
    }
    return 'complete';
}

export function classifyAuthorization(
    authorizedFlags: readonly boolean[]
): StepStatus {
    return authorizedFlags.every(Boolean) ? 'complete' : 'needed';
}

export type StepDecision =
    | { action: 'skip'; reason: 'before_from' | 'already_complete' }
    | { action: 'execute' }
    | {
          action: 'abort';
          reason: 'preflight_needed';
          message: string;
      };

/**
 * Decide what to do for a step given on-chain status and CLI options.
 * When index < startIndex: skip execution, but abort if status is 'needed'
 * (missing dependency). Phase 1 Config is intentionally exempt because
 * configure always overwrites it with deployment defaults.
 */
export function decideStepAction(args: {
    step: ConfigureStepMeta;
    status: StepStatus;
    startIndex: number;
}): StepDecision {
    const { step, status, startIndex } = args;

    if (step.index < startIndex) {
        if (step.isConfig) {
            return { action: 'skip', reason: 'before_from' };
        }
        if (status === 'needed') {
            return {
                action: 'abort',
                reason: 'preflight_needed',
                message:
                    `Cannot resume from step ${startIndex} (${stepIdAt(startIndex)}): ` +
                    `prior step ${step.index} (${step.id}) is not configured on-chain. ` +
                    `Run without --from, or use --from ${step.id}.`,
            };
        }
        return { action: 'skip', reason: 'before_from' };
    }

    if (status === 'complete') {
        return { action: 'skip', reason: 'already_complete' };
    }

    return { action: 'execute' };
}

function stepIdAt(index: number): string {
    return (
        CONFIGURE_STEP_META.find((s) => s.index === index)?.id ?? String(index)
    );
}

function snakeToCamel(s: string): string {
    return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function getFieldLoose(
    obj: Record<string, unknown>,
    field: string
): unknown {
    if (field in obj) return obj[field];
    const camel = snakeToCamel(field);
    if (camel in obj) return obj[camel];
    return undefined;
}

export function normalizeAddressLoose(value: unknown): string {
    if (value === null || value === undefined) return ZERO_ADDRESS;
    if (typeof value === 'string') return value.toLowerCase();
    if (typeof value === 'object' && value !== null && 'toString' in value) {
        return String(
            (value as { toString: () => string }).toString()
        ).toLowerCase();
    }
    return String(value).toLowerCase();
}

/** Pick nested path from full_config-like object (snake or camel). */
export function pickConfigPath(
    full: Record<string, unknown>,
    ...path: string[]
): unknown {
    let cur: unknown = full;
    for (const part of path) {
        if (cur === null || cur === undefined || typeof cur !== 'object') {
            return undefined;
        }
        const rec = cur as Record<string, unknown>;
        cur = getFieldLoose(rec, part);
    }
    return cur;
}

export function classifyBatch1(
    full: Record<string, unknown>,
    hashes: unknown[] | undefined
): StepStatus {
    const world = pickConfigPath(full, 'world_config');
    const core = pickConfigPath(full, 'game_config_core');
    const artifacts = pickConfigPath(full, 'artifacts_config');
    const worldHash = hashes?.[0];
    const coreHash = hashes?.[2];

    const worldStatus = classifyConfigWithHash(
        {
            time_factor_hundredths: pickConfigPath(
                world as Record<string, unknown>,
                'time_factor_hundredths'
            ),
            world_radius_min: pickConfigPath(
                world as Record<string, unknown>,
                'world_radius_min'
            ),
            location_reveal_cooldown: pickConfigPath(
                world as Record<string, unknown>,
                'location_reveal_cooldown'
            ),
            silver_score_value: pickConfigPath(
                world as Record<string, unknown>,
                'silver_score_value'
            ),
            planet_transfer_enabled: pickConfigPath(
                world as Record<string, unknown>,
                'planet_transfer_enabled'
            ),
            admin_can_add_planets: pickConfigPath(
                world as Record<string, unknown>,
                'admin_can_add_planets'
            ),
        },
        EXPECTED_WORLD_CONFIG_MARKERS,
        worldHash
    );
    if (worldStatus !== 'complete') return worldStatus;

    const coreStatus = classifyConfigWithHash(
        {
            max_natural_planet_level: pickConfigPath(
                core as Record<string, unknown>,
                'max_natural_planet_level'
            ),
            planet_rarity: pickConfigPath(
                core as Record<string, unknown>,
                'planet_rarity'
            ),
            perlin_threshold_1: pickConfigPath(
                core as Record<string, unknown>,
                'perlin_threshold_1'
            ),
        },
        EXPECTED_GAME_CONFIG_CORE_MARKERS,
        coreHash
    );
    if (coreStatus !== 'complete') return coreStatus;

    return classifyConfigWithHash(
        {
            token_mint_end_timestamp: pickConfigPath(
                artifacts as Record<string, unknown>,
                'token_mint_end_timestamp'
            ),
            photoid_activation_delay: pickConfigPath(
                artifacts as Record<string, unknown>,
                'photoid_activation_delay'
            ),
        },
        EXPECTED_ARTIFACTS_CONFIG_MARKERS,
        hashes?.[8]
    );
}

export function classifyBatch2(
    full: Record<string, unknown>,
    hashes: unknown[] | undefined
): StepStatus {
    const spaceJunk = (pickConfigPath(full, 'space_junk_config') ??
        {}) as Record<string, unknown>;
    const capture = (pickConfigPath(full, 'capture_zones_config') ??
        {}) as Record<string, unknown>;
    const junkHash = hashes?.[10];
    const captureHash = hashes?.[11];

    const junkStatus = classifyConfigWithHash(
        {
            space_junk_enabled: pickConfigPath(spaceJunk, 'space_junk_enabled'),
            space_junk_limit: pickConfigPath(spaceJunk, 'space_junk_limit'),
            abandon_speed_change_percent: pickConfigPath(
                spaceJunk,
                'abandon_speed_change_percent'
            ),
            abandon_range_change_percent: pickConfigPath(
                spaceJunk,
                'abandon_range_change_percent'
            ),
        },
        EXPECTED_SPACE_JUNK_MARKERS,
        junkHash
    );
    if (junkStatus !== 'complete') return junkStatus;

    return classifyConfigWithHash(
        {
            capture_zones_enabled: pickConfigPath(
                capture,
                'capture_zones_enabled'
            ),
            capture_zone_change_block_interval: pickConfigPath(
                capture,
                'capture_zone_change_block_interval'
            ),
            capture_zone_radius: pickConfigPath(capture, 'capture_zone_radius'),
            capture_zone_hold_blocks_required: pickConfigPath(
                capture,
                'capture_zone_hold_blocks_required'
            ),
            capture_zones_per_5000_world_radius: pickConfigPath(
                capture,
                'capture_zones_per_5000_world_radius'
            ),
        },
        EXPECTED_CAPTURE_ZONES_MARKERS,
        captureHash
    );
}

export function classifyPlanetWeightsTier(
    full: Record<string, unknown>,
    tier: 0 | 1 | 2 | 3,
    hashes: unknown[] | undefined
): StepStatus {
    const key = `planet_type_weights_tier_${tier}`;
    const tierObj = pickConfigPath(full, key);
    const weights = pickConfigPath(
        (tierObj as Record<string, unknown>) ?? {},
        'weights'
    );
    const hash = hashes?.[4 + tier];
    return classifyConfigWithHash(
        weights,
        EXPECTED_PLANET_TYPE_WEIGHTS[tier],
        hash
    );
}

export function classifyPlanetStatsRange(
    full: Record<string, unknown>,
    fromLevel: number,
    toLevel: number
): StepStatus {
    const statsArr = pickConfigPath(full, 'default_stats');
    if (!Array.isArray(statsArr)) {
        return 'needed';
    }
    let anyConflict = false;
    let anyNeeded = false;
    for (let level = fromLevel; level <= toLevel; level++) {
        const expected = PLANET_DEFAULT_STATS[level]!.stats;
        const actual = statsArr[level];
        const status = classifyConfigValue(actual, expected);
        if (status === 'conflict') anyConflict = true;
        if (status === 'needed') anyNeeded = true;
    }
    if (anyConflict) return 'conflict';
    if (anyNeeded) return 'needed';
    return 'complete';
}

export function classifyUpgradesBranch(
    full: Record<string, unknown>,
    branchIndex: 0 | 1 | 2,
    expected: UpgradeExpectation
): StepStatus {
    const upgrades = pickConfigPath(full, 'upgrades');
    if (!Array.isArray(upgrades) || !Array.isArray(upgrades[branchIndex])) {
        return 'needed';
    }
    const branch = upgrades[branchIndex] as unknown[];
    let anyConflict = false;
    let anyNeeded = false;
    for (let i = 0; i < 4; i++) {
        const status = classifyConfigValue(branch[i], expected);
        if (status === 'conflict') anyConflict = true;
        if (status === 'needed') anyNeeded = true;
    }
    if (anyConflict) return 'conflict';
    if (anyNeeded) return 'needed';
    return 'complete';
}

export function classifyUpgradeConfig(
    full: Record<string, unknown>,
    hashes: unknown[] | undefined
): StepStatus {
    const cfg = pickConfigPath(full, 'upgrade_config');
    return classifyConfigWithHash(cfg, EXPECTED_UPGRADE_CONFIG, hashes?.[12]);
}

export function classifyCumulativeRarities(
    full: Record<string, unknown>
): StepStatus {
    const actual = pickConfigPath(full, 'cumulative_rarities');
    const expected = computeExpectedCumulativeRarities();
    return classifyConfigValue(actual, expected);
}
