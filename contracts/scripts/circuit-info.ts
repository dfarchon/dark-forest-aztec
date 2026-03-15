import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(__dirname, '..', 'target');

const BYTES_PER_FIELD = 31;
const MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS = 3000;
const MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES = 96000;

interface FunctionInfo {
    name: string;
    displayName: string;
    type: 'private' | 'public' | 'utility' | 'initializer';
    isConstrained: boolean;
    bytecodeBase64Len: number;
    bytecodeRawBytes: number;
    bytecodeDecompressedBytes: number;
}

interface ContractInfo {
    name: string;
    artifact: string;
    functions: FunctionInfo[];
    publicDispatchBytes: number;
    publicDispatchFields: number;
}

function getFunctionType(
    attrs: string[],
    isUnconstrained: boolean
): FunctionInfo['type'] {
    if (attrs.includes('abi_initializer')) return 'initializer';
    if (attrs.includes('abi_private') || !isUnconstrained) return 'private';
    if (attrs.includes('abi_utility')) return 'utility';
    return 'public';
}

function cleanFunctionName(name: string): string {
    return name.replace(/^__aztec_nr_internals__/, '').replace(/^__aztec_/, '');
}

function discoverArtifacts(): { name: string; artifact: string }[] {
    if (!fs.existsSync(targetDir)) return [];
    return fs
        .readdirSync(targetDir)
        .filter(
            (f) => f.endsWith('.json') && f.includes('-') && !f.endsWith('.bak')
        )
        .map((artifact) => ({
            name: artifact.replace(/\.json$/, ''),
            artifact,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function analyzeContract(artifactPath: string, name: string): ContractInfo {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    const functions: FunctionInfo[] = [];
    let publicDispatchBytes = 0;
    let publicDispatchFields = 0;

    for (const fn of artifact.functions || []) {
        const rawBuf = Buffer.from(fn.bytecode, 'base64');
        let decompressedBytes = rawBuf.length;
        try {
            decompressedBytes = zlib.gunzipSync(rawBuf).length;
        } catch {
            // not gzipped
        }

        const fnType = getFunctionType(
            fn.custom_attributes || [],
            fn.is_unconstrained
        );

        const info: FunctionInfo = {
            name: fn.name,
            displayName: cleanFunctionName(fn.name),
            type: fnType,
            isConstrained: !fn.is_unconstrained,
            bytecodeBase64Len: fn.bytecode.length,
            bytecodeRawBytes: rawBuf.length,
            bytecodeDecompressedBytes: decompressedBytes,
        };
        functions.push(info);

        if (fn.name === 'public_dispatch') {
            publicDispatchBytes = rawBuf.length;
            publicDispatchFields =
                1 + Math.ceil(rawBuf.length / BYTES_PER_FIELD);
        }
    }

    functions.sort((a, b) => {
        const typeOrder = { private: 0, public: 1, initializer: 2, utility: 3 };
        const diff = typeOrder[a.type] - typeOrder[b.type];
        if (diff !== 0) return diff;
        return b.bytecodeDecompressedBytes - a.bytecodeDecompressedBytes;
    });

    return {
        name,
        artifact: path.basename(artifactPath),
        functions,
        publicDispatchBytes,
        publicDispatchFields,
    };
}

function getTermWidth(): number {
    return Math.min(process.stdout.columns || 120, 120);
}

function formatBytes(bytes: number): string {
    if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(2) + ' MB';
    if (bytes >= 1_000) return (bytes / 1_000).toFixed(1) + ' KB';
    return bytes + ' B';
}

const TYPE_LABELS: Record<string, string> = {
    private: '🔒 private',
    public: '🌐 public',
    utility: '🔧 utility',
    initializer: '⚡ init',
};

// Emoji占2列宽但JS string.length只算1，手动补偿
const EMOJI_PAD = 1;

function typeTag(type: FunctionInfo['type'], isConstrained: boolean): string {
    if (isConstrained) return TYPE_LABELS['private'];
    return TYPE_LABELS[type] || type;
}

function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
}

function printContract(contract: ContractInfo) {
    const termW = getTermWidth();
    const contractLabel = contract.name.replace(/-.*$/, '');

    const privateFns = contract.functions.filter((f) => f.isConstrained);
    const publicFns = contract.functions.filter(
        (f) =>
            !f.isConstrained &&
            f.type === 'public' &&
            f.name !== 'public_dispatch'
    );
    const utilityFns = contract.functions.filter((f) => f.type === 'utility');
    const dispatchFn = contract.functions.find(
        (f) => f.name === 'public_dispatch'
    );

    const allVisible = [...privateFns, ...publicFns, ...utilityFns];
    if (dispatchFn) allVisible.push(dispatchFn);

    const typeCol = 12;
    const sizeCol = 10;
    const sep = '  ';
    const maxName = Math.max(
        'Function'.length,
        ...allVisible.map((f) => f.displayName.length)
    );
    const nameCol = Math.min(
        maxName + 2,
        termW - typeCol - sizeCol * 2 - sep.length * 3 - 2
    );
    const totalW = nameCol + sep.length * 3 + typeCol + sizeCol * 2;

    console.log(`\n${'═'.repeat(totalW + 2)}`);
    console.log(`  📦 ${contractLabel}`);
    console.log(`${'═'.repeat(totalW + 2)}`);

    const header =
        '  ' +
        'Function'.padEnd(nameCol) +
        sep +
        'Type'.padEnd(typeCol + EMOJI_PAD) +
        'Compressed'.padStart(sizeCol) +
        sep +
        'Decompressed'.padStart(sizeCol);
    console.log(header);
    console.log('  ' + '─'.repeat(totalW));

    const printFn = (fn: FunctionInfo) => {
        const name = truncate(fn.displayName, nameCol);
        const tag = typeTag(fn.type, fn.isConstrained);
        const row =
            '  ' +
            name.padEnd(nameCol) +
            sep +
            tag.padEnd(typeCol + EMOJI_PAD) +
            formatBytes(fn.bytecodeRawBytes).padStart(sizeCol) +
            sep +
            formatBytes(fn.bytecodeDecompressedBytes).padStart(sizeCol);
        console.log(row);
    };

    if (privateFns.length > 0) {
        privateFns.forEach(printFn);
    }
    if (publicFns.length > 0) {
        publicFns.forEach(printFn);
    }
    if (utilityFns.length > 0) {
        utilityFns.forEach(printFn);
    }

    if (dispatchFn) {
        console.log('  ' + '─'.repeat(totalW));
        printFn(dispatchFn);

        const ok =
            contract.publicDispatchFields <=
                MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS &&
            contract.publicDispatchBytes <= MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES;
        const pct = (
            (contract.publicDispatchFields /
                MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS) *
            100
        ).toFixed(1);
        console.log(
            `  └─ dispatch fields: ${contract.publicDispatchFields} / ${MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS} (${pct}%) ${ok ? '✓' : '⚠️  EXCEEDS LIMIT'}`
        );
    }
}

function printSummary(contracts: ContractInfo[]) {
    const termW = getTermWidth();

    const privateCol = 9;
    const publicCol = 9;
    const utilCol = 9;
    const dispatchCol = 14;
    const fieldsCol = 18;
    const maxLabel = Math.max(
        'Contract'.length,
        ...contracts.map((c) => c.name.replace(/-.*$/, '').length)
    );
    const nameCol = Math.min(
        maxLabel + 2,
        termW - privateCol - publicCol - utilCol - dispatchCol - fieldsCol - 2
    );
    const totalW =
        nameCol + privateCol + publicCol + utilCol + dispatchCol + fieldsCol;

    console.log(`\n${'═'.repeat(totalW + 2)}`);
    console.log('  📊 Summary — All Contracts');
    console.log(`${'═'.repeat(totalW + 2)}\n`);

    const header =
        '  ' +
        'Contract'.padEnd(nameCol) +
        'Private'.padStart(privateCol) +
        'Public'.padStart(publicCol) +
        'Utility'.padStart(utilCol) +
        'Dispatch'.padStart(dispatchCol) +
        'Fields (% cap)'.padStart(fieldsCol);
    console.log(header);
    console.log('  ' + '─'.repeat(totalW));

    let totalPrivate = 0;
    let totalPublic = 0;
    let totalUtility = 0;

    for (const c of contracts) {
        const label = truncate(c.name.replace(/-.*$/, ''), nameCol);
        const privateCnt = c.functions.filter((f) => f.isConstrained).length;
        const publicCnt = c.functions.filter(
            (f) =>
                !f.isConstrained &&
                f.type === 'public' &&
                f.name !== 'public_dispatch'
        ).length;
        const utilityCnt = c.functions.filter(
            (f) => f.type === 'utility'
        ).length;

        totalPrivate += privateCnt;
        totalPublic += publicCnt;
        totalUtility += utilityCnt;

        const dispatchSize =
            c.publicDispatchBytes > 0
                ? formatBytes(c.publicDispatchBytes)
                : '-';
        const fieldsPct =
            c.publicDispatchFields > 0
                ? `${c.publicDispatchFields} (${((c.publicDispatchFields / MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS) * 100).toFixed(1)}%)`
                : '-';

        const ok =
            c.publicDispatchFields <=
                MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS &&
            c.publicDispatchBytes <= MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES;
        const status = c.publicDispatchFields > 0 ? (ok ? '' : ' ⚠️') : '';

        console.log(
            '  ' +
                label.padEnd(nameCol) +
                String(privateCnt).padStart(privateCol) +
                String(publicCnt).padStart(publicCol) +
                String(utilityCnt).padStart(utilCol) +
                dispatchSize.padStart(dispatchCol) +
                (fieldsPct + status).padStart(fieldsCol)
        );
    }

    console.log('  ' + '─'.repeat(totalW));
    console.log(
        '  ' +
            'TOTAL'.padEnd(nameCol) +
            String(totalPrivate).padStart(privateCol) +
            String(totalPublic).padStart(publicCol) +
            String(totalUtility).padStart(utilCol)
    );

    console.log(
        `\n  Limits: ${MAX_PACKED_PUBLIC_BYTECODE_SIZE_IN_FIELDS} fields / ${formatBytes(MAX_PUBLIC_BYTECODE_SIZE_IN_BYTES)}`
    );
}

const SYSTEM_CONTRACTS = new Set([
    'admin',
    'core',
    'move',
    'artifact_action',
    'artifact_find',
    'artifact_prospect',
    'artifact_valut',
]);

const SKIP_PRIVATE_FNS = new Set(['safe_set_owner', 'constructor']);

function isKeyFunction(fn: FunctionInfo, contractLabel: string): boolean {
    if (!SYSTEM_CONTRACTS.has(contractLabel)) return false;
    if (
        fn.name === 'public_dispatch' ||
        fn.name === 'process_message' ||
        fn.name === 'sync_state'
    )
        return false;
    if (SKIP_PRIVATE_FNS.has(fn.displayName)) return false;
    if (fn.isConstrained) return true;
    if (fn.type === 'public' && fn.displayName.match(/_public$/)) return true;
    return false;
}

interface KeyFnEntry {
    contract: string;
    fn: FunctionInfo;
    pairedPublicFn?: FunctionInfo;
}

function printKeyFunctions(contracts: ContractInfo[]) {
    const entries: KeyFnEntry[] = [];

    for (const c of contracts) {
        const label = c.name.replace(/-.*$/, '');
        if (!SYSTEM_CONTRACTS.has(label)) continue;

        const privateFns = c.functions.filter(
            (f) => isKeyFunction(f, label) && f.isConstrained
        );
        for (const fn of privateFns) {
            const publicName = fn.displayName + '_public';
            const pairedPublicFn = c.functions.find(
                (f) => f.displayName === publicName
            );
            entries.push({ contract: label, fn, pairedPublicFn });
        }
    }

    if (entries.length === 0) return;

    entries.sort(
        (a, b) =>
            b.fn.bytecodeDecompressedBytes - a.fn.bytecodeDecompressedBytes
    );

    const sep = '  ';
    const contractCol =
        Math.max('Contract'.length, ...entries.map((e) => e.contract.length)) +
        2;
    const fnCol =
        Math.max(
            'Function'.length,
            ...entries.map((e) => e.fn.displayName.length)
        ) + 2;
    const sizeCol = 10;
    const barCol = 32;
    const totalW = contractCol + fnCol + sizeCol * 2 + barCol + sep.length * 4;

    console.log(`\n${'═'.repeat(totalW + 2)}`);
    console.log('  ⚡ Key System Functions — Private Circuit Size Comparison');
    console.log(`${'═'.repeat(totalW + 2)}`);

    const maxDecompressed = entries[0].fn.bytecodeDecompressedBytes;

    const header =
        '  ' +
        'Contract'.padEnd(contractCol) +
        sep +
        'Function'.padEnd(fnCol) +
        sep +
        'Compressed'.padStart(sizeCol) +
        sep +
        'ACIR Size'.padStart(sizeCol) +
        sep +
        '';
    console.log(header);
    console.log('  ' + '─'.repeat(totalW));

    for (const entry of entries) {
        const ratio = entry.fn.bytecodeDecompressedBytes / maxDecompressed;
        const barLen = Math.max(1, Math.round(ratio * barCol));
        const bar = '█'.repeat(barLen) + '░'.repeat(barCol - barLen);
        const row =
            '  ' +
            entry.contract.padEnd(contractCol) +
            sep +
            entry.fn.displayName.padEnd(fnCol) +
            sep +
            formatBytes(entry.fn.bytecodeRawBytes).padStart(sizeCol) +
            sep +
            formatBytes(entry.fn.bytecodeDecompressedBytes).padStart(sizeCol) +
            sep +
            bar;
        console.log(row);
    }

    console.log('  ' + '─'.repeat(totalW));

    // Show paired public functions
    const publicEntries = entries.filter((e) => e.pairedPublicFn);
    if (publicEntries.length > 0) {
        publicEntries.sort(
            (a, b) =>
                b.pairedPublicFn!.bytecodeDecompressedBytes -
                a.pairedPublicFn!.bytecodeDecompressedBytes
        );

        const pubFnCol =
            Math.max(
                'Function'.length,
                ...publicEntries.map(
                    (e) => e.pairedPublicFn!.displayName.length
                )
            ) + 2;
        const pubTotalW =
            contractCol + pubFnCol + sizeCol * 2 + barCol + sep.length * 4;

        console.log();
        console.log('  📡 Corresponding Public Functions (AVM bytecode)');
        console.log('  ' + '─'.repeat(pubTotalW));

        const pubHeader =
            '  ' +
            'Contract'.padEnd(contractCol) +
            sep +
            'Function'.padEnd(pubFnCol) +
            sep +
            'Compressed'.padStart(sizeCol) +
            sep +
            'AVM Size'.padStart(sizeCol) +
            sep +
            '';
        console.log(pubHeader);
        console.log('  ' + '─'.repeat(pubTotalW));

        const maxPubDecompressed =
            publicEntries[0].pairedPublicFn!.bytecodeDecompressedBytes;

        for (const entry of publicEntries) {
            const pub = entry.pairedPublicFn!;
            const ratio = pub.bytecodeDecompressedBytes / maxPubDecompressed;
            const barLen = Math.max(1, Math.round(ratio * barCol));
            const bar = '▓'.repeat(barLen) + '░'.repeat(barCol - barLen);
            const row =
                '  ' +
                entry.contract.padEnd(contractCol) +
                sep +
                pub.displayName.padEnd(pubFnCol) +
                sep +
                formatBytes(pub.bytecodeRawBytes).padStart(sizeCol) +
                sep +
                formatBytes(pub.bytecodeDecompressedBytes).padStart(sizeCol) +
                sep +
                bar;
            console.log(row);
        }
        console.log('  ' + '─'.repeat(pubTotalW));
    }
}

function main() {
    const filterContract = process.argv[2];
    const artifacts = discoverArtifacts();

    if (artifacts.length === 0) {
        console.error('No compiled artifacts found in', targetDir);
        console.error('Run `pnpm compile-contracts` first.');
        process.exit(1);
    }

    console.log('🔍 Aztec Contract Circuit Info');
    console.log(`   Artifacts: ${targetDir}`);
    console.log(`   Contracts: ${artifacts.length}`);

    const contracts: ContractInfo[] = [];

    for (const { name, artifact } of artifacts) {
        if (
            filterContract &&
            !name.toLowerCase().includes(filterContract.toLowerCase())
        ) {
            continue;
        }
        const artifactPath = path.join(targetDir, artifact);
        const info = analyzeContract(artifactPath, name);
        contracts.push(info);
        printContract(info);
    }

    if (contracts.length > 1) {
        printKeyFunctions(contracts);
        printSummary(contracts);
    }

    console.log();
}

main();
