/**
 * Bootstrap step catalog, CLI parsing, and on-chain status classifiers.
 */
import {
    CONFIGURE_STEP_META,
    formatConfigureUsage,
    parseConfigureArgs,
    type ParseConfigureArgsResult,
} from './classify.ts';

export {
    CONFIGURE_STEP_META as BOOTSTRAP_STEP_META,
    classifyAuthorization,
    classifyBatch1,
    classifyBatch2,
    classifyCumulativeRarities,
    classifyPlanetStatsRange,
    classifyPlanetWeightsTier,
    classifyPointers,
    classifyUpgradeConfig,
    classifyUpgradesBranch,
    decideStepAction,
    EXPECTED_UPGRADE_DEFENSE,
    EXPECTED_UPGRADE_RANGE,
    EXPECTED_UPGRADE_SPEED,
    normalizeAddressLoose,
    PLANET_DEFAULT_STATS,
    resolveStartIndex,
    type StepStatus,
    TOTAL_CONFIGURE_STEPS as TOTAL_BOOTSTRAP_STEPS,
} from './classify.ts';

function bootstrapWording(value: string): string {
    return value
        .replace(/deploy:configure/g, 'bootstrap')
        .replace(/configure/g, 'bootstrap');
}

export function formatBootstrapUsage(): string {
    return bootstrapWording(formatConfigureUsage());
}

export function parseBootstrapArgs(argv: string[]): ParseConfigureArgsResult {
    const result = parseConfigureArgs(argv);
    if (!result.ok) {
        return { ok: false, error: bootstrapWording(result.error) };
    }
    return result;
}

export const BOOTSTRAP_STEP_COUNT = CONFIGURE_STEP_META.length;
