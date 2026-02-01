import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(__dirname, 'artifacts');

// From @aztec/constants - deployment uses bufferAsFields which chunks bytecode into 31-byte fields
const MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS = 3000;
const MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES = 96000;
const BYTES_PER_FIELD = 31; // Fr.SIZE_IN_BYTES - 1

// Discover contract artifacts: {package}-{Contract}.json (e.g. config-Config.json, main-Main.json)
function discoverArtifacts(): { name: string; artifact: string }[] {
    if (!fs.existsSync(artifactsDir)) return [];
    return fs
        .readdirSync(artifactsDir)
        .filter((f) => f.endsWith('.json') && f.includes('-'))
        .map((artifact) => ({
            name: artifact.replace(/\.json$/, ''),
            artifact,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function getBytecodeStats(artifactPath: string): { bytes: number; fields: number } | null {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    const dispatch = (artifact.functions || []).find((fn: { name: string }) => fn.name === 'public_dispatch');
    if (!dispatch?.bytecode) return null;

    const bytecode = Buffer.from(dispatch.bytecode, 'base64');
    const bytes = bytecode.length;
    const fields = 1 + Math.ceil(bytes / BYTES_PER_FIELD);
    return { bytes, fields };
}

function checkBytecode() {
    const contracts = discoverArtifacts();
    if (contracts.length === 0) {
        console.error('No contract artifacts found in', artifactsDir);
        return;
    }

    console.log('Public bytecode (public_dispatch - used at deployment)\n');

    const results: { name: string; bytes: number; fields: number }[] = [];
    let totalBytes = 0;
    let totalFields = 0;

    for (const { name, artifact } of contracts) {
        const artifactPath = path.join(artifactsDir, artifact);
        if (!fs.existsSync(artifactPath)) {
            console.log(`${name}: artifact not found (${artifact})\n`);
            continue;
        }

        const stats = getBytecodeStats(artifactPath);
        if (!stats) {
            console.log(`${name}: public_dispatch not found\n`);
            continue;
        }

        results.push({ name, ...stats });
        totalBytes += stats.bytes;
        totalFields += stats.fields;

        const ok =
            stats.fields <= MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS &&
            stats.bytes <= MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES;

        console.log(`${name}:`);
        console.log(`  Bytes:  ${stats.bytes.toLocaleString()}`);
        console.log(`  Fields: ${stats.fields} (1 + ceil(${stats.bytes}/${BYTES_PER_FIELD}))`);
        console.log(`  Status: ${ok ? '✓ OK' : '⚠️ EXCEEDS LIMIT'}\n`);
    }

    if (results.length >= 2) {
        console.log('─'.repeat(50));
        console.log('Comparison (by size):');
        const sorted = [...results].sort((a, b) => b.bytes - a.bytes);
        sorted.forEach((r, i) => {
            const diff = i === 0 ? '' : ` (-${(sorted[0].bytes - r.bytes).toLocaleString()} vs ${sorted[0].name})`;
            console.log(`  ${i + 1}. ${r.name}: ${r.bytes.toLocaleString()} bytes${diff}`);
        });
        console.log(`  Total: ${totalBytes.toLocaleString()} bytes, ${totalFields} fields\n`);
    }

    console.log('Limits (from @aztec/constants):');
    console.log(`  Max fields: ${MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS}`);
    console.log(`  Max bytes:  ${MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES}`);

    const anyExceeded = results.some(
        (r) =>
            r.fields > MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS || r.bytes > MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES
    );
    console.log(anyExceeded ? '\n⚠️  Some contract(s) exceed limit - deployment will fail' : '\n✓ All within limit');
}

checkBytecode();
