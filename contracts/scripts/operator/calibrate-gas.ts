/**
 * Measures what sponsored transactions actually cost, so the paymaster's
 * per-transaction ceiling is derived from evidence rather than guessed.
 *
 *   pnpm --filter contracts run calibrate-fpc-gas -- --fpc 0x… --target 0x… --method move
 *
 * Why this exists: the ceiling is immutable once deployed. Set it too low and
 * sponsorship silently stops working the first time the network gets busy; set
 * it too high and a single transaction can cost far more than intended. Both
 * failures are expensive and neither is fixable without redeploying.
 *
 * Two things are measured separately, because they differ materially:
 *   - the FIRST sponsored transaction of a user's day (claims a seat, opens the
 *     allowance note — the heavier path), and
 *   - every subsequent one.
 */
import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';

/** Multiplier applied to measured cost to absorb normal fee movement. */
const DEFAULT_HEADROOM = 3;

interface Measurement {
    /** Which sponsored path this was: the heavier first-of-day, or a later one. */
    label: string;
    /** The fee the paymaster actually paid, in wei. */
    feeWei: string;
}

function parseArgs(argv: string[]) {
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i === -1 ? undefined : argv[i + 1];
    };
    const fpc = get('--fpc');
    if (!fpc) {
        throw new Error(
            'Usage: calibrate-gas --fpc <address> [--headroom <n>] [--json <out.json>]'
        );
    }
    // Fail before doing any work if the address is malformed.
    if (!/^0x[0-9a-fA-F]{64}$/.test(fpc)) {
        throw new Error(`--fpc is not a 32-byte address: ${fpc}`);
    }
    return {
        fpc,
        headroom: Number(get('--headroom') ?? DEFAULT_HEADROOM),
        jsonOut: get('--json'),
    };
}

/**
 * The ceiling a set of measurements implies: the costliest observed path times
 * headroom. Headroom matters because the ceiling is fixed at deployment while
 * network fees float — too tight and sponsorship stops the first time the
 * network gets busy.
 */
export function ceilingFromMeasurements(
    measurements: Measurement[],
    headroom: number
): bigint {
    const costliest = measurements.reduce(
        (max, m) => (BigInt(m.feeWei) > max ? BigInt(m.feeWei) : max),
        0n
    );
    return costliest * BigInt(Math.ceil(headroom));
}

async function main() {
    const { fpc, headroom, jsonOut } = parseArgs(process.argv.slice(2));
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const fees = await node.getCurrentMinFees();

    console.log(`\nCalibrating against ${nodeUrl}`);
    console.log(`  paymaster            ${fpc}`);
    console.log(`  current fee per DA   ${fees.feePerDaGas}`);
    console.log(`  current fee per L2   ${fees.feePerL2Gas}`);
    console.log(`  headroom multiplier  ${headroom}x`);

    // Measurements come from the integration suite, which sends real sponsored
    // transactions and records the gas each phase consumed. Running the suite
    // with QUOTA_FPC_MEASURE=1 writes them here rather than duplicating the
    // whole sandbox setup in this script.
    const measurementsPath = getOptionalEnv('QUOTA_FPC_MEASUREMENTS');
    if (!measurementsPath) {
        console.log(
            `\nNo measurements supplied.\n` +
                `Run the integration suite against a sandbox with QUOTA_FPC_MEASURE=1 to\n` +
                `produce them, then re-run with QUOTA_FPC_MEASUREMENTS=<file>.\n` +
                `Until then the config's maxFeeWei stays a placeholder and must not be\n` +
                `used for a funded deployment.\n`
        );
        process.exit(3);
    }

    const fs = await import('node:fs');
    const measurements: Measurement[] = JSON.parse(
        fs.readFileSync(measurementsPath, 'utf-8')
    );
    if (measurements.length === 0) {
        throw new Error(`No measurements in ${measurementsPath}`);
    }

    console.log(`\nMeasured (${measurements.length} sponsored transactions)`);
    const byLabel = new Map<string, bigint[]>();
    for (const m of measurements) {
        const list = byLabel.get(m.label) ?? [];
        list.push(BigInt(m.feeWei));
        byLabel.set(m.label, list);
    }
    for (const [label, fees_] of byLabel) {
        const max = fees_.reduce((a, b) => (b > a ? b : a), 0n);
        const min = fees_.reduce((a, b) => (b < a ? b : a), fees_[0]);
        console.log(
            `  ${label.padEnd(16)} n=${fees_.length}  min=${min}  max=${max}`
        );
    }
    const ceiling = ceilingFromMeasurements(measurements, headroom);

    // The ceiling must cover the most expensive sponsored path, not the average.
    console.log(`\nmaxFeeWei = ${ceiling}   (costliest path x ${headroom})`);
    console.log(`Put this in the config's policy.maxFeeWei, then re-check the`);
    console.log(
        `worst-case-per-day figure against your accepted maximum loss.\n`
    );

    if (jsonOut) {
        fs.writeFileSync(
            jsonOut,
            `${JSON.stringify({ maxFeeWei: ceiling.toString(), headroom, measurements }, null, 2)}\n`
        );
        console.log(`Written to ${jsonOut}\n`);
    }
}

if (process.argv[1]?.includes('calibrate-gas')) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
