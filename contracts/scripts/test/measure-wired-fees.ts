/**
 * Full fee measurement for every client-wired write that has a harness.
 *
 * Usage (from contracts/):
 *   FEE_MEASURE_COMMIT="$(git rev-parse HEAD)" pnpm exec tsx scripts/test/measure-wired-fees.ts currentWired
 *
 * Requires fresh local network + `pnpm deploy:run` + `pnpm bootstrap` with current artifacts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const section = process.argv[2] ?? 'currentWired';
if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(section)) {
    console.error('Usage: measure-wired-fees.ts <section>');
    process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '../..');
const outPath = path.resolve(
    contractsDir,
    '../docs/benchmarks/storage-style-fees.json'
);

type FeeRow = {
    name: string;
    total_da: string;
    total_l2: string;
    public_da: string;
    public_l2: string;
    billed_da: string;
    billed_l2: string;
    teardown_da: string;
    teardown_l2: string;
    fee: string;
    error?: string;
};

/** Ordered scenario covering all wired methods that have a fee harness. */
const steps: {
    name: string;
    script: string;
    args: string[];
    record?: boolean;
}[] = [
    {
        name: 'initialize_player',
        script: 'scripts/test/test-core-initialize-player.ts',
        args: ['0'],
    },
    {
        name: 'initialize_player_user1',
        script: 'scripts/test/test-core-initialize-player.ts',
        args: ['1'],
        record: false,
    },
    {
        name: 'give_spaceships',
        script: 'scripts/test/test-give-spaceships.ts',
        args: ['0'],
    },
    {
        name: 'move',
        script: 'scripts/test/test-move.ts',
        args: ['1'],
    },
    {
        name: 'upgrade_planet',
        script: 'scripts/test/test-upgrade.ts',
        args: ['1'],
    },
    {
        name: 'withdraw_silver',
        script: 'scripts/test/test-withdraw.ts',
        args: ['0'],
    },
    {
        name: 'buy_hat',
        script: 'scripts/test/test-buy-hat.ts',
        args: ['0'],
    },
    {
        name: 'create_planet',
        script: 'scripts/test/test-create-planet.ts',
        args: [],
    },
    {
        name: 'transfer_planet',
        script: 'scripts/test/test-transfer-planet.ts',
        args: ['0'],
    },
    {
        name: 'reveal_location',
        script: 'scripts/test/test-reveal-location.ts',
        args: ['0'],
    },
    {
        name: 'admin_give_artifact',
        script: 'scripts/test/test-admin-give.ts',
        args: ['0'],
    },
    // admin_give also emits admin_give_spaceship FEE_MEASURE in the same script
    {
        name: 'set_world_config',
        script: 'scripts/test/test-set-world-config.ts',
        args: [],
    },
    {
        name: 'admin_set_world_radius',
        script: 'scripts/test/test-admin-radius.ts',
        args: [],
    },
    {
        name: 'pause',
        script: 'scripts/test/test-pause-unpause.ts',
        args: [],
    },
    {
        name: 'remaining_wired',
        script: 'scripts/test/test-remaining-wired.ts',
        args: ['0'],
    },
];

function parseAllFeeLines(text: string): FeeRow[] {
    const rows: FeeRow[] = [];
    for (const line of text.split('\n')) {
        if (!line.includes('FEE_MEASURE name=')) continue;
        const fields = Object.fromEntries(
            line
                .trim()
                .split(/\s+/)
                .slice(1)
                .map((part) => {
                    const idx = part.indexOf('=');
                    return [part.slice(0, idx), part.slice(idx + 1)];
                })
        );
        rows.push({
            name: fields.name ?? '',
            total_da: fields.total_da ?? '',
            total_l2: fields.total_l2 ?? '',
            public_da: fields.public_da ?? '',
            public_l2: fields.public_l2 ?? '',
            billed_da: fields.billed_da ?? '',
            billed_l2: fields.billed_l2 ?? '',
            teardown_da: fields.teardown_da ?? '',
            teardown_l2: fields.teardown_l2 ?? '',
            fee: fields.fee ?? '',
        });
    }
    return rows;
}

function runStep(script: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn('pnpm', ['exec', 'tsx', script, ...args], {
            cwd: contractsDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (buf: Buffer) => {
            const text = buf.toString();
            out += text;
            process.stdout.write(text);
        });
        child.stderr.on('data', (buf: Buffer) => {
            const text = buf.toString();
            out += text;
            process.stderr.write(text);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(out);
            else
                reject(
                    new Error(`${script} exited ${code}\n${out.slice(-4000)}`)
                );
        });
    });
}

async function main() {
    const rows: FeeRow[] = [];
    for (const step of steps) {
        console.log(`\n===== ${step.name} =====\n`);
        try {
            const output = await runStep(step.script, step.args);
            if (step.record === false) continue;
            const parsed = parseAllFeeLines(output);
            if (parsed.length === 0) {
                rows.push({
                    name: step.name,
                    total_da: '',
                    total_l2: '',
                    public_da: '',
                    public_l2: '',
                    billed_da: '',
                    billed_l2: '',
                    teardown_da: '',
                    teardown_l2: '',
                    fee: '',
                    error: 'FEE_MEASURE line missing',
                });
            } else {
                rows.push(...parsed);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            rows.push({
                name: step.name,
                total_da: '',
                total_l2: '',
                public_da: '',
                public_l2: '',
                billed_da: '',
                billed_l2: '',
                teardown_da: '',
                teardown_l2: '',
                fee: '',
                error: message.slice(0, 2000),
            });
            console.error(`step ${step.name} failed`);
        }
    }

    const existing = fs.existsSync(outPath)
        ? (JSON.parse(fs.readFileSync(outPath, 'utf8')) as Record<
              string,
              unknown
          >)
        : {};
    existing[section] = {
        commit: process.env.FEE_MEASURE_COMMIT ?? '',
        measured_at: new Date().toISOString(),
        note: 'Full wired-function fee suite covering all 22 client ContractResolver write methods.',
        functions: rows,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(existing, null, 2) + '\n');
    console.log(`\nWrote ${outPath} section ${section}`);
    console.log(
        rows
            .map(
                (r) =>
                    `${r.name.padEnd(24)} billed_l2=${r.billed_l2 || 'ERR'} ${r.error ? r.error.slice(0, 80) : ''}`
            )
            .join('\n')
    );
    if (rows.some((row) => row.error)) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
