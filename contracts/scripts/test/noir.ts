/**
 * Run `aztec-nargo test` only on workspace packages that contain `#[test]`.
 *
 * `aztec-nargo test --workspace` compiles every contract, including large
 * ones such as system/core that have no tests, which is slow enough to stall.
 * Dependencies of the tested packages are still compiled and covered.
 *
 * Extra arguments are forwarded to nargo, e.g. a test name filter.
 *
 * Run from contracts: pnpm test:nr [-- <nargo args>]
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CONTRACTS_ROOT = path.resolve(import.meta.dirname, '..', '..');

function readToml(dir: string): string {
    return fs.readFileSync(
        path.join(CONTRACTS_ROOT, dir, 'Nargo.toml'),
        'utf-8'
    );
}

function workspaceMembers(): string[] {
    const block = readToml('.').match(/members\s*=\s*\[([^\]]*)\]/);
    if (!block) throw new Error('No workspace members found in Nargo.toml');
    return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function packageName(dir: string): string {
    const name = readToml(dir).match(/^name\s*=\s*"([^"]+)"/m);
    if (!name) throw new Error(`No package name in ${dir}/Nargo.toml`);
    return name[1];
}

function hasTests(dir: string): boolean {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && hasTests(full)) return true;
        if (
            entry.name.endsWith('.nr') &&
            /^\s*#\[test\b/m.test(fs.readFileSync(full, 'utf-8'))
        )
            return true;
    }
    return false;
}

const packages = workspaceMembers()
    .filter((dir) => hasTests(path.join(CONTRACTS_ROOT, dir, 'src')))
    .map(packageName);

console.log(
    `Testing ${packages.length} package(s) with #[test]: ${packages.join(', ')}`
);

for (const name of packages) {
    const result = spawnSync(
        'aztec-nargo',
        ['test', '--package', name, ...process.argv.slice(2)],
        {
            cwd: CONTRACTS_ROOT,
            stdio: 'inherit',
        }
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
}
