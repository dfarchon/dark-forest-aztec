import { inspect } from 'node:util';

import { unwrapSimulateResult } from '../../../client/src/utils/unwrapSimulateResult.ts';

export { unwrapSimulateResult };

const INSPECT_OPTS = {
    depth: null as const,
    colors: false,
    maxArrayLength: null,
    breakLength: 100,
};

/** Full-depth terminal dump (avoids console.log collapsing nested arrays to `[Array]`). */
export function formatSimulatedValue(value: unknown): string {
    return inspect(unwrapSimulateResult(value), INSPECT_OPTS);
}
