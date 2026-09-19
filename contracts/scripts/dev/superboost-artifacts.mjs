// Reproducible build inventory. Bytecode sizes are not gas measurements.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const contracts = fileURLToPath(new URL('../../', import.meta.url));
const target = resolve(contracts, 'target');
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/dev/superboost-artifacts.mjs OUTPUT.json');
const entries = readdirSync(target).filter(name => name.endsWith('.json') && name.includes('-')).sort();
const workspace = readFileSync(resolve(contracts, 'Nargo.toml'), 'utf8');
const members = [...workspace.matchAll(/"([^"]+)"/g)].map(match => match[1]);
const expected = members.flatMap(member => {
    const manifest = readFileSync(resolve(contracts, member, 'Nargo.toml'), 'utf8');
    return /type\s*=\s*"contract"/.test(manifest)
        ? [manifest.match(/name\s*=\s*"([^"]+)"/)[1]] : [];
});
const artifacts = entries.map(name => {
    const bytes = readFileSync(resolve(target, name));
    const artifact = JSON.parse(bytes);
    if (artifact.transpiled !== true || artifact.aztec_version !== '5.0.1') {
        throw new Error(`${name}: requires completed Aztec 5.0.1 postprocessing`);
    }
    return {
        file: name,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        functions: artifact.functions.map(fn => ({
            name: fn.name,
            attributes: fn.custom_attributes,
            bytecodeBytes: Buffer.from(fn.bytecode, 'base64').length,
        })),
    };
});
for (const name of expected) {
    if (!entries.some(entry => entry.startsWith(`${name}-`))) {
        throw new Error(`Missing contract artifact: ${name}`);
    }
}
const report = {
    schemaVersion: 1,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: contracts, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: contracts, encoding: 'utf8' }).trim().length > 0,
    aztecVersion: '5.0.1',
    nodeVersion: process.version,
    measurement: 'compiled-artifact-inventory-only',
    artifacts,
};
writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
console.log(`Recorded ${artifacts.length} compiled artifacts in ${resolve(output)}`);
