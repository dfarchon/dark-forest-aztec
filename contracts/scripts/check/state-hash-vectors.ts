/**
 * Generate cross-language state hash vectors for contracts/tests/state_hash.
 *
 * Struct layouts are parsed from types/src/storage/*.nr. Each sample is built
 * by field name, hashed with the client serializers in
 * client/src/Session/TxExecutor/stateHash.ts plus poseidon2Hash, and written
 * out as Noir struct literals with the expected hash. The Noir tests then
 * assert that poseidon2_hash(serialize()), state_hash() and encode_update all
 * reproduce that hash, so a change in the Aztec hash, in a Noir struct, or in
 * the TypeScript field order fails the check.
 *
 * Samples come from a fixed seed, so the output only changes when the hash
 * function or a struct layout changes. `--check` fails in that case instead
 * of rewriting the file: changed hashes no longer match roots already stored
 * on chain.
 *
 * Run from contracts:
 *   pnpm check:hash          (verify vectors are current, then run Noir tests)
 *   pnpm check:hash:update   (rewrite vectors after an intended layout change)
 */
import fs from 'fs';
import path from 'path';

import * as stateHash from '../../../client/src/Session/TxExecutor/stateHash.ts';
import {
    HIGH_LEVEL_PLANET,
    HIGH_LEVEL_PLANET_LABEL,
} from './high-level-planet-sample.ts';
import { formatNoir } from './noir-format.ts';

const CONTRACTS_ROOT = path.resolve(import.meta.dirname, '..', '..');
const STORAGE_TYPES_DIR = path.join(CONTRACTS_ROOT, 'types', 'src', 'storage');
const OUTPUT = path.join(
    CONTRACTS_ROOT,
    'tests',
    'state_hash',
    'src',
    'vectors.nr'
);

const SAMPLES_PER_TYPE = 3;
const SEED = 0x5eed_d0d0_cafe_f00dn;

// The client serializers convert u64 with Number(), so values must stay
// below 2^53 to hash the same as Noir.
const U64_SAMPLE_BITS = 48n;

// Top-level storage states with a client serializer, and the event struct
// that the state_hash test crate declares for each of them.
const STATES: { name: string; event: string }[] = [
    { name: 'Planet', event: 'PlanetUpdate' },
    { name: 'PlanetRevealedCoords', event: 'PlanetRevealedCoordsUpdate' },
    { name: 'PlanetEvents', event: 'PlanetEventsUpdate' },
    { name: 'PlanetArtifacts', event: 'PlanetArtifactsUpdate' },
    { name: 'Arrival', event: 'ArrivalUpdate' },
    { name: 'Artifact', event: 'ArtifactUpdate' },
    { name: 'ArtifactLocation', event: 'ArtifactLocationUpdate' },
    { name: 'Player', event: 'PlayerUpdate' },
    { name: 'World', event: 'WorldUpdate' },
];

// Hand-written samples appended after the random ones, so random rows stay stable.
const FIXED_SAMPLES: Record<
    string,
    { label: string; values: Record<string, unknown> }[]
> = {
    Planet: [{ label: HIGH_LEVEL_PLANET_LABEL, values: HIGH_LEVEL_PLANET }],
};

type FieldDef = { name: string; type: string };
type StructDef = { name: string; module: string; fields: FieldDef[] };

function parseStructs(): Map<string, StructDef> {
    const structs = new Map<string, StructDef>();
    for (const file of fs.readdirSync(STORAGE_TYPES_DIR).sort()) {
        if (!file.endsWith('.nr') || file === 'mod.nr') continue;
        const module = file.replace(/\.nr$/, '');
        const source = fs.readFileSync(
            path.join(STORAGE_TYPES_DIR, file),
            'utf-8'
        );
        for (const match of source.matchAll(
            /pub struct (\w+)\s*\{([\s\S]*?)\n\}/g
        )) {
            const fields: FieldDef[] = [];
            for (const line of match[2].split('\n')) {
                const field = line
                    .replace(/\/\/.*$/, '')
                    .match(/^\s*pub (\w+):\s*(.+?),?\s*$/);
                if (field) fields.push({ name: field[1], type: field[2] });
            }
            structs.set(match[1], { name: match[1], module, fields });
        }
    }
    return structs;
}

class Rng {
    private state: bigint;

    constructor(seed: bigint) {
        this.state = seed;
    }

    next64(): bigint {
        // xorshift64*
        const mask = (1n << 64n) - 1n;
        let x = this.state;
        x ^= x >> 12n;
        x ^= (x << 25n) & mask;
        x ^= x >> 27n;
        this.state = x;
        return (x * 0x2545f4914f6cdd1dn) & mask;
    }

    bits(count: bigint): bigint {
        let value = 0n;
        for (let filled = 0n; filled < count; filled += 64n) {
            value = (value << 64n) | this.next64();
        }
        return value & ((1n << count) - 1n);
    }
}

type Sample = { js: unknown; noir: string };

function sample(
    type: string,
    structs: Map<string, StructDef>,
    rng: Rng
): Sample {
    const array = type.match(/^\[(.+);\s*(\d+)\]$/);
    if (array) {
        const items = Array.from({ length: Number(array[2]) }, () =>
            sample(array[1].trim(), structs, rng)
        );
        return {
            js: items.map((item) => item.js),
            noir: `[${items.map((item) => item.noir).join(', ')}]`,
        };
    }
    switch (type) {
        case 'bool': {
            const value = rng.bits(1n) === 1n;
            return { js: value, noir: String(value) };
        }
        case 'u8':
        case 'u32':
        case 'u128': {
            const value = rng.bits(BigInt(type.slice(1)));
            return { js: value, noir: value.toString() };
        }
        case 'u64': {
            const value = rng.bits(U64_SAMPLE_BITS);
            return { js: value, noir: value.toString() };
        }
        case 'Field': {
            const value = rng.bits(248n);
            return { js: value, noir: `0x${value.toString(16)}` };
        }
        case 'AztecAddress': {
            const hex = `0x${rng.bits(248n).toString(16)}`;
            return { js: hex, noir: `AztecAddress::from_field(${hex})` };
        }
    }
    const struct = structs.get(type);
    if (!struct) throw new Error(`Unsupported field type: ${type}`);
    const js: Record<string, unknown> = {};
    const members: string[] = [];
    for (const field of struct.fields) {
        const value = sample(field.type, structs, rng);
        js[field.name] = value.js;
        members.push(`${field.name}: ${value.noir}`);
    }
    return { js, noir: `${type} { ${members.join(', ')} }` };
}

/** Noir literal for a flat struct whose field values are given by name. */
function literal(struct: StructDef, values: Record<string, unknown>): string {
    const members = struct.fields.map((field) => {
        if (!(field.name in values)) {
            throw new Error(
                `Fixed ${struct.name} sample is missing field ${field.name}.`
            );
        }
        const value = values[field.name];
        switch (field.type) {
            case 'bool':
                return `${field.name}: ${String(value)}`;
            case 'u8':
            case 'u32':
            case 'u64':
            case 'u128':
                return `${field.name}: ${BigInt(value as bigint).toString()}`;
            case 'Field':
                return `${field.name}: 0x${BigInt(value as string).toString(16)}`;
            case 'AztecAddress':
                return `${field.name}: AztecAddress::from_field(0x${BigInt(value as string).toString(16)})`;
        }
        throw new Error(
            `Fixed samples only support flat structs; ${struct.name}.${field.name} is ${field.type}.`
        );
    });
    return `${struct.name} { ${members.join(', ')} }`;
}

function referencedStructs(
    name: string,
    structs: Map<string, StructDef>,
    found: Set<string>
) {
    if (found.has(name)) return;
    found.add(name);
    for (const field of structs.get(name)!.fields) {
        const inner = field.type.match(/^\[(.+);/)?.[1].trim() ?? field.type;
        if (structs.has(inner)) referencedStructs(inner, structs, found);
    }
}

function snakeCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

async function generate(): Promise<string> {
    const structs = parseStructs();
    const rng = new Rng(SEED);
    const used = new Set<string>();
    const sections: string[] = [];

    for (const { name } of STATES) {
        if (!structs.has(name)) {
            throw new Error(
                `Struct ${name} was not found in ${path.relative(process.cwd(), STORAGE_TYPES_DIR)}.\n` +
                    'If it was renamed or moved, update STATES in this script and the event structs in\n' +
                    'tests/state_hash/src/lib.nr, then run `pnpm check:hash:update`.'
            );
        }
        referencedStructs(name, structs, used);
        const hashFn = (
            stateHash as unknown as Record<
                string,
                (
                    state: Record<string, unknown>
                ) => Promise<{ toString(): string }>
            >
        )[`compute${name}Hash`];
        if (!hashFn) {
            throw new Error(
                `client/src/Session/TxExecutor/stateHash.ts has no compute${name}Hash.\n` +
                    'Every storage state needs a client serializer so the frontend can build the same\n' +
                    'state hashes as the contracts. Add one there, then run `pnpm check:hash:update`.'
            );
        }

        const rows: string[] = [];
        for (let i = 0; i < SAMPLES_PER_TYPE; i++) {
            const value = sample(name, structs, rng);
            const hash = await hashFn(value.js as Record<string, unknown>);
            rows.push(`        (${value.noir}, ${hash.toString()}),`);
        }
        const fixed = FIXED_SAMPLES[name] ?? [];
        for (const { label, values } of fixed) {
            const hash = await hashFn(values);
            rows.push(`        // ${label}`);
            rows.push(
                `        (${literal(structs.get(name)!, values)}, ${hash.toString()}),`
            );
        }
        sections.push(
            [
                `pub fn ${snakeCase(name)}() -> [(${name}, Field); ${SAMPLES_PER_TYPE + fixed.length}] {`,
                '    [',
                ...rows,
                '    ]',
                '}',
            ].join('\n')
        );
    }

    const imports = new Map<string, string[]>();
    for (const name of [...used].sort()) {
        const module = structs.get(name)!.module;
        imports.set(module, [...(imports.get(module) ?? []), name]);
    }
    const importLines = [...imports.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
            ([module, names]) =>
                `use ::types::storage::${module}::{${names.join(', ')}};`
        );

    return formatNoir(
        [
            '// Generated by scripts/check/state-hash-vectors.ts. Do not edit.',
            '// Expected hashes come from the client serializers and poseidon2Hash.',
            'use ::aztec::protocol::{address::AztecAddress, traits::FromField};',
            ...importLines,
            '',
            sections.join('\n\n'),
            '',
        ].join('\n')
    );
}

function sections(source: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const match of source.matchAll(/pub fn (\w+)\(\)[\s\S]*?\n\}/g)) {
        result.set(match[1], match[0]);
    }
    return result;
}

async function main() {
    const check = process.argv.includes('--check');
    const output = await generate();
    const relOutput = path.relative(process.cwd(), OUTPUT);
    const exists = fs.existsSync(OUTPUT);
    const current = exists ? fs.readFileSync(OUTPUT, 'utf-8') : '';

    if (check) {
        if (!exists) {
            console.error(
                [
                    `${relOutput} does not exist yet.`,
                    'Generate it once with `pnpm check:hash:update`, review it, and commit it.',
                    'Later runs of `pnpm check:hash` compare against that committed file.',
                ].join('\n')
            );
            process.exit(1);
        }
        if (current !== output) {
            const before = sections(current);
            const after = sections(output);
            const changed = [
                ...new Set([...before.keys(), ...after.keys()]),
            ].filter((name) => before.get(name) !== after.get(name));
            console.error(
                [
                    `${relOutput} is out of date.`,
                    changed.length > 0
                        ? `Changed state types: ${changed.join(', ')}`
                        : 'Only the header (imports) differs.',
                    '',
                    'Possible causes:',
                    '  1. A storage struct in types/src/storage/ changed (field added, removed,',
                    '     reordered or retyped). Hashes of that type change, so roots already stored',
                    '     on chain stop matching. Plan a migration or a fresh deployment.',
                    '  2. The client serializer in client/src/Session/TxExecutor/stateHash.ts changed.',
                    '     It must keep the exact field order of the Noir struct.',
                    '  3. @aztec-labs/foundation was upgraded and poseidon2Hash now returns different',
                    '     values. If only this changed, every stored root is affected: do not deploy',
                    '     until the Noir side is confirmed to match (`pnpm check:hash:nr`).',
                    '',
                    'If the change is intended, run `pnpm check:hash:update`, check the diff of',
                    `${relOutput}, and commit it.`,
                ].join('\n')
            );
            process.exit(1);
        }
        console.log(
            `State hash vectors are up to date (${STATES.length} state types, ${SAMPLES_PER_TYPE} random samples each, plus fixed samples).`
        );
        return;
    }

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, output);
    console.log(
        [
            current === output
                ? `${relOutput} is unchanged.`
                : `Wrote ${relOutput}.`,
            'Next: run `pnpm check:hash:nr` to confirm the Noir side produces the same hashes,',
            'then commit the file.',
        ].join('\n')
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
