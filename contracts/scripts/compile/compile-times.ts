/**
 * Compile each contract separately into contracts/target and print wall-clock time.
 *
 * `aztec-nargo compile --package` writes that package's artifact into the
 * workspace target/ (for example target/config-Config.json). Postprocess is
 * done directly: `aztec-bb aztec_process`, then the same aztec_version stamp
 * `aztec compile` writes.
 *
 * A second run must not call nargo for an unchanged package. nargo rewrites
 * the already-transpiled JSON back into compiler output, which forces bb to
 * process it again. Skip when a content hash of that package, its local path
 * dependencies, the workspace Nargo.toml, and the Aztec toolchain version
 * matches the hash stored at the last successful compile.
 * `pnpm build` formats first, and that rewrites `.nr` files even when the
 * text is unchanged, so modification time is not a reliable signal.
 * Git dependencies are ignored, same as `aztec compile`.
 *
 * Incremental cache is kept (no --force). Packages run one at a time.
 *
 * Run from contracts: pnpm build:compile
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const CONTRACTS_PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORKSPACE_TOML = path.join(CONTRACTS_PACKAGE_ROOT, 'Nargo.toml');
const TARGET_DIR = path.join(CONTRACTS_PACKAGE_ROOT, 'target');
const CACHE_FILE = path.join(TARGET_DIR, '.compile-cache.json');

type PackageTiming = {
    name: string;
    member: string;
    ms: number;
    exitCode: number;
    skipped: boolean;
};

type CompileCache = {
    packages: Record<string, string>;
};

function workspaceMembers(toml: string): string[] {
    const block = toml.match(/members\s*=\s*\[([\s\S]*?)\]/);
    if (!block) return [];
    return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function packageMeta(toml: string): { name?: string; type?: string } {
    return {
        name: toml.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1],
        type: toml.match(/^\s*type\s*=\s*"([^"]+)"/m)?.[1],
    };
}

function discoverContracts(): { name: string; member: string }[] {
    const members = workspaceMembers(fs.readFileSync(WORKSPACE_TOML, 'utf-8'));
    const contracts: { name: string; member: string }[] = [];
    for (const member of members) {
        const tomlPath = path.join(
            CONTRACTS_PACKAGE_ROOT,
            member,
            'Nargo.toml'
        );
        if (!fs.existsSync(tomlPath)) {
            console.error(`Missing ${path.relative(process.cwd(), tomlPath)}`);
            process.exit(1);
        }
        const meta = packageMeta(fs.readFileSync(tomlPath, 'utf-8'));
        if (meta.type !== 'contract') continue;
        if (!meta.name) {
            console.error(`Missing package name in ${member}/Nargo.toml`);
            process.exit(1);
        }
        contracts.push({ name: meta.name, member });
    }
    return contracts;
}

function pathDependencies(toml: string, packageDir: string): string[] {
    return [...toml.matchAll(/path\s*=\s*"([^"]+)"/g)].map((match) =>
        path.resolve(packageDir, match[1])
    );
}

function listNoirSources(dir: string): string[] {
    const files: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name === 'target' || entry.name === 'node_modules') {
                continue;
            }
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (entry.name === 'Nargo.toml' || entry.name.endsWith('.nr')) {
                files.push(full);
            }
        }
    };
    walk(dir);
    return files;
}

function collectSources(
    packageDir: string,
    seen = new Set<string>()
): string[] {
    const resolved = path.resolve(packageDir);
    if (seen.has(resolved)) return [];
    seen.add(resolved);
    const tomlPath = path.join(resolved, 'Nargo.toml');
    if (!fs.existsSync(tomlPath)) return [];
    const files = listNoirSources(resolved);
    const toml = fs.readFileSync(tomlPath, 'utf-8');
    for (const dep of pathDependencies(toml, resolved)) {
        files.push(...collectSources(dep, seen));
    }
    return files;
}

function packageArtifacts(name: string): string[] {
    if (!fs.existsSync(TARGET_DIR)) return [];
    const prefix = `${name}-`;
    return fs
        .readdirSync(TARGET_DIR)
        .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
        .map((file) => path.join(TARGET_DIR, file));
}

function relativeSourcePath(filePath: string): string {
    return path
        .relative(CONTRACTS_PACKAGE_ROOT, filePath)
        .split(path.sep)
        .join('/');
}

function packageDigest(member: string, version: string): string {
    const files = new Set(
        collectSources(path.join(CONTRACTS_PACKAGE_ROOT, member))
    );
    files.add(WORKSPACE_TOML);

    const hash = crypto.createHash('sha256');
    hash.update('aztec_version\0');
    hash.update(version);
    hash.update('\0');
    for (const filePath of [...files].sort()) {
        hash.update(relativeSourcePath(filePath));
        hash.update('\0');
        hash.update(fs.readFileSync(filePath));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function emptyCache(): CompileCache {
    return { packages: {} };
}

function readCache(): CompileCache {
    if (!fs.existsSync(CACHE_FILE)) return emptyCache();
    try {
        const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as {
            packages?: unknown;
        };
        if (
            parsed.packages === null ||
            typeof parsed.packages !== 'object' ||
            Array.isArray(parsed.packages)
        ) {
            return emptyCache();
        }
        const packages: Record<string, string> = {};
        for (const [name, digest] of Object.entries(parsed.packages)) {
            if (typeof digest === 'string' && digest.length > 0) {
                packages[name] = digest;
            }
        }
        return { packages };
    } catch {
        return emptyCache();
    }
}

function writeCache(cache: CompileCache): void {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmp, CACHE_FILE);
}

function removeLegacyStamps(): void {
    const stampDir = path.join(TARGET_DIR, '.compile-stamps');
    if (fs.existsSync(stampDir)) {
        fs.rmSync(stampDir, { recursive: true, force: true });
    }
}

function hasTranspiledArtifacts(name: string): boolean {
    const artifacts = packageArtifacts(name);
    if (artifacts.length === 0) return false;
    for (const filePath of artifacts) {
        let parsed: { functions?: unknown; transpiled?: unknown };
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            return false;
        }
        if (!Array.isArray(parsed.functions) || parsed.transpiled !== true) {
            return false;
        }
    }
    return true;
}

function isUpToDate(
    name: string,
    digest: string,
    cache: CompileCache
): boolean {
    return cache.packages[name] === digest && hasTranspiledArtifacts(name);
}

/**
 * Noir's "Brillig function call isn't properly covered by a manual constraint"
 * check is a heuristic. aztec-nr deliberately leaves a few oracle hints
 * unconstrained in-circuit (the kernel validates them), so every private
 * function trips the check inside the dependency. Those blocks are noise we
 * cannot act on. Drop a `bug:` block only when its source location is an
 * absolute path outside this workspace, so a `bug:` in our own .nr files, and
 * every warning/error, still prints. Set SHOW_DEP_BUGS=1 to see everything.
 */
class DiagnosticFilter {
    private pending = '';
    private block: string[] = [];
    dropped = 0;

    constructor(private readonly out: NodeJS.WriteStream) {}

    write(chunk: Buffer | string): void {
        this.pending += chunk.toString();
        let newline = this.pending.indexOf('\n');
        while (newline !== -1) {
            this.line(this.pending.slice(0, newline));
            this.pending = this.pending.slice(newline + 1);
            newline = this.pending.indexOf('\n');
        }
    }

    end(): void {
        if (this.pending.length > 0) {
            this.line(this.pending);
            this.pending = '';
        }
        this.flush();
    }

    private line(text: string): void {
        if (text.trim() === '') {
            // A dropped block takes its trailing blank separator with it.
            if (!this.flush()) this.out.write('\n');
            return;
        }
        this.block.push(text);
    }

    /** Emits the buffered block; returns true when the block was dropped. */
    private flush(): boolean {
        if (this.block.length === 0) return false;
        const drop = this.isDependencyBug(this.block);
        if (drop) {
            this.dropped += 1;
        } else {
            this.out.write(`${this.block.join('\n')}\n`);
        }
        this.block = [];
        return drop;
    }

    private isDependencyBug(lines: string[]): boolean {
        if (!lines[0].startsWith('bug:')) return false;
        const location = lines.find((line) => line.includes('┌─'));
        if (!location) return false;
        const file = location.slice(location.indexOf('┌─') + 2).trim();
        return (
            path.isAbsolute(file) &&
            !file.startsWith(`${CONTRACTS_PACKAGE_ROOT}${path.sep}`)
        );
    }
}

function run(
    command: string,
    args: string[],
    filterStderr = false
): Promise<{ ms: number; exitCode: number }> {
    const started = Date.now();
    const filter =
        filterStderr && process.env.SHOW_DEP_BUGS !== '1'
            ? new DiagnosticFilter(process.stderr)
            : undefined;
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: CONTRACTS_PACKAGE_ROOT,
            stdio: ['inherit', 'inherit', filter ? 'pipe' : 'inherit'],
        });
        if (filter && child.stderr) {
            child.stderr.on('data', (chunk: Buffer) => filter.write(chunk));
        }
        child.on('error', (err) => {
            console.error(`Failed to start ${command}:`, err);
            resolve({ ms: Date.now() - started, exitCode: 1 });
        });
        child.on('close', (code) => {
            if (filter) {
                filter.end();
                if (filter.dropped > 0) {
                    console.error(
                        `(hid ${filter.dropped} "bug:" diagnostic(s) from dependency code; SHOW_DEP_BUGS=1 to show)`
                    );
                }
            }
            resolve({ ms: Date.now() - started, exitCode: code ?? 1 });
        });
    });
}

function untranspiledArtifacts(packageName: string): string[] {
    const paths: string[] = [];
    for (const filePath of packageArtifacts(packageName)) {
        let parsed: { functions?: unknown; transpiled?: unknown };
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            continue;
        }
        if (Array.isArray(parsed.functions) && parsed.transpiled !== true) {
            paths.push(filePath);
        }
    }
    return paths;
}

function stampAztecVersion(filePaths: string[], version: string): void {
    for (const filePath of filePaths) {
        const artifact = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
            aztec_version?: string;
        };
        artifact.aztec_version = version;
        fs.writeFileSync(
            filePath,
            `${JSON.stringify(artifact, null, 2)}\n`,
            'utf-8'
        );
    }
}

async function compilePackage(
    name: string,
    member: string,
    version: string,
    cache: CompileCache
): Promise<{ ms: number; exitCode: number; skipped: boolean }> {
    const digest = packageDigest(member, version);
    if (isUpToDate(name, digest, cache)) {
        console.log('unchanged, skipping');
        return { ms: 0, exitCode: 0, skipped: true };
    }

    const started = Date.now();
    const compiled = await run(
        'aztec-nargo',
        ['compile', '--package', name],
        true
    );
    if (compiled.exitCode !== 0) {
        return {
            ms: Date.now() - started,
            exitCode: compiled.exitCode,
            skipped: false,
        };
    }

    const fresh = untranspiledArtifacts(name);
    if (fresh.length === 0) {
        if (hasTranspiledArtifacts(name)) {
            cache.packages[name] = digest;
            writeCache(cache);
        }
        return { ms: Date.now() - started, exitCode: 0, skipped: false };
    }

    const post = await run('aztec-bb', [
        'aztec_process',
        ...fresh.flatMap((filePath) => ['-i', filePath]),
    ]);
    if (post.exitCode !== 0) {
        return {
            ms: Date.now() - started,
            exitCode: post.exitCode,
            skipped: false,
        };
    }
    stampAztecVersion(fresh, version);
    cache.packages[name] = digest;
    writeCache(cache);
    return { ms: Date.now() - started, exitCode: 0, skipped: false };
}

function formatSeconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

async function readAztecVersion(): Promise<string> {
    const version = await new Promise<string>((resolve, reject) => {
        const child = spawn('aztec', ['--version'], {
            cwd: CONTRACTS_PACKAGE_ROOT,
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`aztec --version exited ${code}`));
                return;
            }
            resolve(stdout.trim());
        });
    });
    if (!version) throw new Error('aztec --version returned an empty version');
    return version;
}

async function main() {
    const contracts = discoverContracts();
    if (contracts.length === 0) {
        console.error(
            'No type = "contract" packages found in Nargo.toml members.'
        );
        process.exit(1);
    }

    const version = await readAztecVersion();
    removeLegacyStamps();
    const cache = readCache();
    console.log(
        `Compiling ${contracts.length} contracts into target/ (incremental cache kept).`
    );
    console.log(
        'Unchanged packages are skipped. A changed package recompiles itself and every contract that depends on it.\n'
    );

    const timings: PackageTiming[] = [];
    for (const pkg of contracts) {
        console.log(`\n--- ${pkg.name} (${pkg.member}) ---`);
        const result = await compilePackage(
            pkg.name,
            pkg.member,
            version,
            cache
        );
        timings.push({ ...pkg, ...result });
        const status = result.skipped
            ? 'skipped'
            : result.exitCode === 0
              ? `${formatSeconds(result.ms)} (ok)`
              : `${formatSeconds(result.ms)} (exit ${result.exitCode})`;
        console.log(`--- ${pkg.name}: ${status} ---`);
    }

    const totalMs = timings.reduce((sum, timing) => sum + timing.ms, 0);
    const nameWidth = Math.max(
        ...timings.map((timing) => timing.name.length),
        'total'.length
    );
    const sorted = [...timings].sort((a, b) => b.ms - a.ms);

    console.log('\nCompile times (wall clock, current cache)\n');
    for (const timing of sorted) {
        const pct = totalMs === 0 ? 0 : (timing.ms / totalMs) * 100;
        const status = timing.skipped
            ? '  skipped'
            : timing.exitCode === 0
              ? ''
              : '  FAIL';
        console.log(
            `  ${timing.name.padEnd(nameWidth)}  ${formatSeconds(timing.ms).padStart(7)}  ${pct.toFixed(0).padStart(3)}%${status}`
        );
    }
    console.log(
        `  ${'total'.padEnd(nameWidth)}  ${formatSeconds(totalMs).padStart(7)}  sum of packages`
    );

    if (timings.some((timing) => timing.exitCode !== 0)) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
