/**
 * Format generated Noir source exactly as `pnpm fmt:aztec` would.
 *
 * Generated files live inside the workspace, so `aztec-nargo fmt --workspace`
 * (run by `pnpm build`) rewrites them. Generators format their output first,
 * otherwise every build would make the committed file look out of date.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function formatNoir(source: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noir-fmt-'));
    try {
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(
            path.join(dir, 'Nargo.toml'),
            '[package]\nname = "fmt_tmp"\ntype = "lib"\n\n[dependencies]\n'
        );
        const file = path.join(dir, 'src', 'lib.nr');
        fs.writeFileSync(file, source);
        const result = spawnSync('aztec-nargo', ['fmt'], {
            cwd: dir,
            encoding: 'utf-8',
        });
        if (result.error || result.status !== 0) {
            throw new Error(
                `aztec-nargo fmt failed on generated source:\n${result.stderr ?? result.error}`
            );
        }
        return fs.readFileSync(file, 'utf-8');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
