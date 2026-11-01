/**
 * Fail when contract code bypasses the shared macros.
 *
 * - Struct hashes use `x.state_hash()` (#[::macros::state_hash]), not
 *   `poseidon2_hash(x.serialize())`. Raw arrays such as
 *   `poseidon2_hash([key, x, y])` are fine.
 * - Storage contracts write state through `encode_update`
 *   (#[::macros::state_update]), not `self.emit`.
 * - Contracts use `#[::macros::world_contract]`, not a bare `#[aztec]`.
 *
 * `mod tests` blocks, the macros crate and tests/ are skipped because they
 * compare against poseidon2_hash on purpose.
 *
 * Run from contracts: pnpm check:style
 */
import fs from 'fs';
import path from 'path';

const CONTRACTS_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'target', 'macros', 'tests']);

type Rule = {
    id: string;
    pattern: RegExp;
    only?: string;
    why: string;
    fix: string[];
};

const RULES: Rule[] = [
    {
        id: 'struct-hash',
        pattern: /poseidon2_hash\(\s*[\w.[\]]+\s*\.serialize\(\)\s*\)/,
        why: 'Struct hashes go through StateHash so public code gets the unrolled sponge and every caller hashes the same way.',
        fix: [
            'Replace `poseidon2_hash(x.serialize())` with `x.state_hash()` and add `use ::macros::StateHash;`.',
            'If the type has no StateHash yet, add `#[::macros::state_hash]` after its #[derive(...)] in types/,',
            'then run `pnpm check:hash:nr` to confirm it matches poseidon2_hash.',
        ],
    },
    {
        id: 'storage-emit',
        pattern: /self\.emit\(/,
        only: `storage${path.sep}`,
        why: 'Storage writes compute the state root and the event log from one field expansion via encode_update.',
        fix: [
            'Add `#[::macros::state_update]` under `#[event]` on the XxxUpdate struct, then write:',
            '  let (root, log) = XxxUpdate::encode_update(id, block_number, state);',
            '  self.storage.state_roots.at(id).write(root);',
            '  unsafe { aztec::oracle::avm::emit_public_log(log.as_vector()); }',
        ],
    },
    {
        id: 'bare-aztec',
        pattern: /^#\[aztec\]/,
        why: 'world_contract wraps #[aztec] and rewrites storage calls to the cheaper direct AVM calls.',
        fix: [
            'Replace `#[aztec]` (and its `use ::aztec::macros::aztec;`) with `#[::macros::world_contract]`,',
            'and add `macros = { path = "..." }` to the package Nargo.toml if it is missing.',
        ],
    },
];

function noirFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...noirFiles(full));
        else if (entry.name.endsWith('.nr')) files.push(full);
    }
    return files;
}

const files = noirFiles(CONTRACTS_ROOT);
const hits = new Map<Rule, string[]>();
for (const file of files) {
    const relative = path.relative(CONTRACTS_ROOT, file);
    const lines = fs
        .readFileSync(file, 'utf-8')
        .split(/\nmod tests \{/)[0]
        .split('\n');
    for (const rule of RULES) {
        if (rule.only && !relative.startsWith(rule.only)) continue;
        lines.forEach((line, index) => {
            if (rule.pattern.test(line)) {
                const list = hits.get(rule) ?? [];
                list.push(`    ${relative}:${index + 1}  ${line.trim()}`);
                hits.set(rule, list);
            }
        });
    }
}

if (hits.size === 0) {
    console.log(
        `Hash style check passed (${files.length} .nr files, ${RULES.length} rules; macros/ and tests/ skipped).`
    );
    process.exit(0);
}

let total = 0;
for (const [rule, list] of hits) {
    total += list.length;
    console.error(
        [
            `[${rule.id}] ${list.length} occurrence(s)`,
            ...list,
            `  Why: ${rule.why}`,
            '  Fix:',
            ...rule.fix.map((line) => `    ${line}`),
            '',
        ].join('\n')
    );
}
console.error(
    [
        `${total} style violation(s). Fix them, then rerun \`pnpm check:style\`.`,
        'Comparing against poseidon2_hash on purpose? Put that code in a `mod tests` block or under tests/.',
    ].join('\n')
);
process.exit(1);
