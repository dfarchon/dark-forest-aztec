/**
 * Record or compare per-function bytecode sizes of the compiled contracts.
 *
 * Private functions report ACIR size, public functions report AVM bytecode
 * size, both after decompression. public_dispatch is the deployed public
 * bytecode of a contract. Sizes are a proxy for deployment cost and limits,
 * not for per-transaction gas.
 *
 * The baseline lives outside target/ so `pnpm clean:build` does not delete
 * it, and `snapshot` refuses to overwrite an existing baseline without
 * --force, since the pre-change numbers cannot be recovered without
 * recompiling the old code.
 *
 * Run from contracts after `pnpm build:compile`:
 *   pnpm check:bytecode:snapshot [file] [--force]   (default baselines/bytecode.json)
 *   pnpm check:bytecode:compare [file]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const CONTRACTS_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TARGET_DIR = path.join(CONTRACTS_ROOT, 'target');
const DEFAULT_BASELINE = path.join(
    CONTRACTS_ROOT,
    'baselines',
    'bytecode.json'
);
const LEGACY_BASELINE = path.join(TARGET_DIR, 'bytecode-baseline.json');

type Sizes = Record<string, Record<string, number>>;

type Meta = {
    createdAt: string;
    gitCommit: string;
    gitDirty: boolean;
    aztecVersion: string;
    newestArtifactAt: string;
};

type Baseline = { meta?: Meta; sizes: Sizes };

function rel(file: string): string {
    return path.relative(process.cwd(), file) || file;
}

function fail(lines: string[]): never {
    console.error(lines.join('\n'));
    process.exit(1);
}

function git(args: string): string {
    try {
        return execSync(`git ${args}`, {
            cwd: CONTRACTS_ROOT,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .toString()
            .trim();
    } catch {
        return '';
    }
}

function decompressedSize(base64: string): number {
    const raw = Buffer.from(base64, 'base64');
    try {
        return zlib.gunzipSync(raw).length;
    } catch {
        return raw.length;
    }
}

function artifactFiles(): string[] {
    if (!fs.existsSync(TARGET_DIR)) return [];
    return fs
        .readdirSync(TARGET_DIR)
        .filter((file) => file.endsWith('.json') && file.includes('-'))
        .sort()
        .map((file) => path.join(TARGET_DIR, file));
}

function readCurrent(): { sizes: Sizes; meta: Meta } {
    const files = artifactFiles();
    if (files.length === 0) {
        fail([
            `No compiled contract artifacts found in ${rel(TARGET_DIR)}/.`,
            '',
            'This command reads the output of a compile; it does not compile anything itself.',
            'Next step: run `pnpm build:compile` (slow, about 20 minutes for a full rebuild),',
            'then run this command again.',
        ]);
    }

    const sizes: Sizes = {};
    let newest = 0;
    let aztecVersion = 'unknown';
    for (const file of files) {
        const artifact = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!Array.isArray(artifact.functions)) continue;
        newest = Math.max(newest, fs.statSync(file).mtimeMs);
        if (typeof artifact.aztec_version === 'string') {
            aztecVersion = artifact.aztec_version;
        }
        const contract = path.basename(file).replace(/\.json$/, '');
        sizes[contract] = {};
        for (const fn of artifact.functions) {
            const kind = fn.is_unconstrained ? 'avm' : 'acir';
            const name = String(fn.name).replace(/^__aztec_nr_internals__/, '');
            sizes[contract][`${name} (${kind})`] = decompressedSize(
                fn.bytecode
            );
        }
    }

    return {
        sizes,
        meta: {
            createdAt: new Date().toISOString(),
            gitCommit: git('rev-parse --short HEAD') || 'unknown',
            gitDirty: git('status --porcelain -- .') !== '',
            aztecVersion,
            newestArtifactAt: new Date(newest).toISOString(),
        },
    };
}

function readBaseline(file: string): Baseline {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (parsed && typeof parsed === 'object' && 'sizes' in parsed) {
        return parsed as Baseline;
    }
    return { sizes: parsed as Sizes };
}

function countFunctions(sizes: Sizes): number {
    return Object.values(sizes).reduce(
        (sum, fns) => sum + Object.keys(fns).length,
        0
    );
}

function describe(meta: Meta | undefined): string[] {
    if (!meta) return ['  (old baseline format without metadata)'];
    return [
        `  created:        ${meta.createdAt}`,
        `  git commit:     ${meta.gitCommit}${meta.gitDirty ? ' (with uncommitted changes)' : ''}`,
        `  aztec version:  ${meta.aztecVersion}`,
        `  artifacts from: ${meta.newestArtifactAt}`,
    ];
}

function snapshot(file: string, force: boolean) {
    if (fs.existsSync(file) && !force) {
        const existing = readBaseline(file);
        fail([
            `Refusing to overwrite the existing baseline ${rel(file)}:`,
            ...describe(existing.meta),
            `  contracts:      ${Object.keys(existing.sizes).length}, functions: ${countFunctions(existing.sizes)}`,
            '',
            'A baseline should hold the numbers from BEFORE your change. Overwriting it with',
            'the current build makes every later compare report "no changes", and getting the',
            'old numbers back means checking out the old code and recompiling everything.',
            '',
            'What you probably want:',
            '  - Compare the current build with it:  pnpm check:bytecode:compare',
            '  - Keep it and save a new snapshot elsewhere:',
            '      pnpm check:bytecode:snapshot baselines/bytecode-<name>.json',
            '  - Really replace it:                  pnpm check:bytecode:snapshot --force',
        ]);
    }

    const current = readCurrent();
    if (current.meta.gitDirty) {
        console.warn(
            [
                'Warning: contracts/ has uncommitted changes. If this snapshot is meant to be',
                'the "before" baseline, make sure target/ was compiled before those changes.',
                '',
            ].join('\n')
        );
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    const baseline: Baseline = { meta: current.meta, sizes: current.sizes };
    fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
    console.log(
        [
            `${force ? 'Replaced' : 'Wrote'} baseline ${rel(file)}`,
            ...describe(current.meta),
            `  contracts:      ${Object.keys(current.sizes).length}, functions: ${countFunctions(current.sizes)}`,
            '',
            'Next: make your change, run `pnpm build:compile`, then `pnpm check:bytecode:compare`.',
        ].join('\n')
    );
}

function compare(file: string) {
    if (!fs.existsSync(file)) {
        const legacy = fs.existsSync(LEGACY_BASELINE)
            ? [
                  '',
                  `An older baseline exists at ${rel(LEGACY_BASELINE)}. Use it with:`,
                  `  pnpm check:bytecode:compare ${rel(LEGACY_BASELINE)}`,
              ]
            : [];
        fail([
            `Baseline ${rel(file)} not found.`,
            '',
            'compare needs sizes recorded BEFORE your change. To create one:',
            '  1. With the old code compiled in target/, run `pnpm check:bytecode:snapshot`.',
            '  2. Make your change and run `pnpm build:compile`.',
            '  3. Run `pnpm check:bytecode:compare`.',
            '',
            'If the old build is already gone, check out the old commit in a separate',
            'worktree (`git worktree add ../old <commit>`), compile there, and snapshot it:',
            `  pnpm exec tsx scripts/check/bytecode-snapshot.ts snapshot ${rel(file)}`,
            ...legacy,
        ]);
    }

    const baseline = readBaseline(file);
    const current = readCurrent();

    console.log(
        [
            `Baseline ${rel(file)}`,
            ...describe(baseline.meta),
            'Current target/',
            ...describe(current.meta).filter(
                (line) => !line.includes('created:')
            ),
            '',
        ].join('\n')
    );

    if (
        baseline.meta &&
        current.meta.newestArtifactAt <= baseline.meta.newestArtifactAt
    ) {
        console.warn(
            [
                'Warning: target/ has not been rebuilt since the baseline was recorded, so this',
                'compares the baseline with the same build. Run `pnpm build:compile` first.',
                '',
            ].join('\n')
        );
    }
    if (
        baseline.meta &&
        current.meta.aztecVersion !== baseline.meta.aztecVersion
    ) {
        console.warn(
            [
                `Warning: Aztec version changed (${baseline.meta.aztecVersion} -> ${current.meta.aztecVersion}).`,
                'Size differences include compiler changes, not only your code.',
                '',
            ].join('\n')
        );
    }

    const before = baseline.sizes;
    const after = current.sizes;
    const added = Object.keys(after).filter((name) => !(name in before));
    const removed = Object.keys(before).filter((name) => !(name in after));
    if (added.length > 0)
        console.log(`New contracts (not in baseline): ${added.join(', ')}`);
    if (removed.length > 0) {
        console.log(
            `Contracts missing from target/: ${removed.join(', ')}\n` +
                '  A failed or partial compile can cause this; check the build:compile output.'
        );
    }

    const rows: { name: string; before: number; after: number }[] = [];
    for (const contract of Object.keys({ ...before, ...after }).sort()) {
        if (!(contract in before) || !(contract in after)) continue;
        const fnsBefore = before[contract];
        const fnsAfter = after[contract];
        for (const fn of Object.keys({ ...fnsBefore, ...fnsAfter }).sort()) {
            if (fnsBefore[fn] === fnsAfter[fn]) continue;
            rows.push({
                name: `${contract.replace(/-.*$/, '')}.${fn}`,
                before: fnsBefore[fn] ?? 0,
                after: fnsAfter[fn] ?? 0,
            });
        }
    }

    if (rows.length === 0) {
        console.log(
            [
                'No bytecode size changes.',
                'If you expected changes: make sure `pnpm build:compile` finished without errors',
                'after your edit, and that the baseline was not re-recorded after the change.',
            ].join('\n')
        );
        return;
    }

    const width = Math.max(
        ...rows.map((row) => row.name.length),
        'Function'.length
    );
    console.log(
        `${'Function'.padEnd(width)}  ${'Before'.padStart(9)}  ${'After'.padStart(9)}  ${'Delta'.padStart(9)}  ${'%'.padStart(7)}`
    );
    let totalBefore = 0;
    let totalAfter = 0;
    for (const row of rows) {
        totalBefore += row.before;
        totalAfter += row.after;
        const delta = row.after - row.before;
        const pct = !row.before
            ? 'new'
            : !row.after
              ? 'removed'
              : ((delta / row.before) * 100).toFixed(1);
        console.log(
            `${row.name.padEnd(width)}  ${String(row.before).padStart(9)}  ${String(row.after).padStart(9)}  ${String(delta).padStart(9)}  ${pct.padStart(7)}`
        );
    }
    const totalDelta = totalAfter - totalBefore;
    const totalPct = totalBefore
        ? ((totalDelta / totalBefore) * 100).toFixed(1)
        : 'n/a';
    console.log(
        [
            '',
            `Changed functions: ${rows.length}, total delta ${totalDelta} bytes (${totalPct}%)`,
            '',
            'How to read this:',
            '  (avm)  public bytecode. Bigger code is not more gas: unrolled hashing grows code',
            '         but runs fewer instructions. Watch public_dispatch against the deploy limit',
            '         with `pnpm build:bytecode`.',
            '  (acir) private circuit size. Growth here usually means slower client-side proving.',
        ].join('\n')
    );
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const [mode, fileArg] = args.filter((arg) => !arg.startsWith('--'));
const file = fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_BASELINE;

if (mode === 'snapshot') {
    snapshot(file, force);
} else if (mode === 'compare') {
    compare(file);
} else {
    fail([
        `Unknown mode: ${mode ?? '(none)'}`,
        '',
        'Usage (from contracts/):',
        '  pnpm check:bytecode:snapshot [file] [--force]',
        '      Record current target/ sizes as the "before" baseline.',
        `      Default file: ${rel(DEFAULT_BASELINE)}. Refuses to overwrite without --force.`,
        '  pnpm check:bytecode:compare [file]',
        '      Compare current target/ against the baseline.',
    ]);
}
