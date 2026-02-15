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

function getBytecodeStats(
    artifactPath: string
): { bytes: number; fields: number } | null {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    const dispatch = (artifact.functions || []).find(
        (fn: { name: string }) => fn.name === 'public_dispatch'
    );
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

    // Collect all stats first
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
    }

    // Print as table
    if (results.length > 0) {
        const maxNameLen = Math.max(
            ...results.map((r) => r.name.length),
            'Contract'.length
        );
        const maxBytesLen = Math.max(
            ...results.map((r) => r.bytes.toLocaleString().length),
            'Bytes'.length
        );
        const maxFieldsLen = Math.max(
            ...results.map((r) => r.fields.toString().length),
            'Fields'.length
        );

        // Column widths (internal content width)
        const col1 = maxNameLen;
        const col2 = maxBytesLen + 4; // Add extra width for Bytes column
        const col3 = maxFieldsLen + 4; // Add extra width for Fields column
        const col4 = 8;

        const line = (left: string, mid: string, right: string) =>
            left +
            '─'.repeat(col1 + 2) +
            mid +
            '─'.repeat(col2 + 2) +
            mid +
            '─'.repeat(col3 + 2) +
            mid +
            '─'.repeat(col4 + 2) +
            right;

        console.log(line('┌', '┬', '┐'));
        console.log(
            '│ ' +
                'Contract'.padEnd(col1) +
                ' │ ' +
                'Bytes'.padStart(col2) +
                ' │ ' +
                'Fields'.padStart(col3) +
                ' │ ' +
                'Status'.padEnd(col4) +
                ' │'
        );
        console.log(line('├', '┼', '┤'));

        results.forEach((r) => {
            const ok =
                r.fields <= MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS &&
                r.bytes <= MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES;
            const name = r.name.padEnd(col1);
            const bytes = r.bytes.toLocaleString().padStart(col2);
            const fields = r.fields.toString().padStart(col3);
            const status = (ok ? '✓ OK' : '⚠️  LIMIT').padEnd(col4);
            console.log(`│ ${name} │ ${bytes} │ ${fields} │ ${status} │`);
        });

        console.log(line('├', '┼', '┤'));
        console.log(
            '│ ' +
                'TOTAL'.padEnd(col1) +
                ' │ ' +
                totalBytes.toLocaleString().padStart(col2) +
                ' │ ' +
                totalFields.toString().padStart(col3) +
                ' │ ' +
                ''.padEnd(col4) +
                ' │'
        );
        console.log(line('└', '┴', '┘'));
        console.log();
    }

    console.log('Limits (from @aztec/constants):');
    console.log(`  Max fields: ${MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS}`);
    console.log(`  Max bytes:  ${MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES}`);

    const anyExceeded = results.some(
        (r) =>
            r.fields > MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS ||
            r.bytes > MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES
    );
    console.log(
        anyExceeded
            ? '\n⚠️  Some contract(s) exceed limit - deployment will fail'
            : '\n✓ All within limit'
    );
}

checkBytecode();
