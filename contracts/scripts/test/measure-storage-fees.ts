/**
 * Run the shared gameplay fee scenario and merge one section into
 * docs/benchmarks/storage-style-fees.json.
 *
 * Usage (from contracts/):
 *   pnpm test:measure-fees current        # baseline on gasMainRound2 before gas work ("pre")
 *   pnpm test:measure-fees currentPost    # same scenario after gas work
 *   pnpm exec tsx scripts/test/measure-storage-fees.ts <section>
 *
 * Section is any name matching [A-Za-z][A-Za-z0-9_-]*. Historical V52 sections
 * (devkit, devkitMain, aztec520, devkitV52, ...) are kept in the JSON and never touched
 * unless you pass their name.
 *
 * Requires a fresh local Aztec network with contracts deployed (`pnpm deploy:run`) and
 * bootstrapped (`pnpm bootstrap`), `networks/<AZTEC_NETWORK>.env` filled in, and fresh
 * `pnpm build:contracts` artifacts. Each step runs as its own `pnpm exec tsx` child process.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const section = process.argv[2];
if (!section || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(section)) {
    console.error(
        'Usage: measure-storage-fees.ts <section>   (e.g. current, currentPost)'
    );
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

const steps: { name: string; script: string; args: string[] }[] = [
    {
        name: 'initialize_player',
        script: 'scripts/test/test-core-initialize-player.ts',
        args: ['0'],
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
];

function parseFeeLine(text: string, name: string): FeeRow | null {
    const line = text
        .split('\n')
        .reverse()
        .find((row) => row.includes(`FEE_MEASURE name=${name} `));
    if (!line) return null;
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
    return {
        name,
        total_da: fields.total_da ?? '',
        total_l2: fields.total_l2 ?? '',
        public_da: fields.public_da ?? '',
        public_l2: fields.public_l2 ?? '',
        billed_da: fields.billed_da ?? '',
        billed_l2: fields.billed_l2 ?? '',
        teardown_da: fields.teardown_da ?? '',
        teardown_l2: fields.teardown_l2 ?? '',
        fee: fields.fee ?? '',
    };
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
    // move and upgrade use user 1, who must already be initialized.
    const ordered = [
        steps[0],
        {
            name: 'initialize_player_user1',
            script: 'scripts/test/test-core-initialize-player.ts',
            args: ['1'],
        },
        steps[1],
        steps[2],
        steps[3],
        steps[4],
    ];

    const rows: FeeRow[] = [];
    for (const step of ordered) {
        console.log(`\n===== ${step.name} =====\n`);
        try {
            const output = await runStep(step.script, step.args);
            if (step.name === 'initialize_player_user1') continue;
            const row = parseFeeLine(output, step.name);
            rows.push(
                row ?? {
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
                }
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (step.name !== 'initialize_player_user1') {
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
            }
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
        functions: rows,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(existing, null, 2) + '\n');
    console.log(`\nWrote ${outPath} section ${section}`);
    if (rows.some((row) => row.error)) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
