/**
 * Fails if the compiled contract artifacts have drifted between copies.
 *
 *   pnpm --filter contracts run check-artifacts
 *
 * WHY THIS EXISTS
 * ---------------
 * The same artifact is written to three places, and each has a different
 * consumer:
 *
 *   contracts/target/                  the Noir compiler's own output
 *   contracts/scripts/artifacts/       the operator scripts (deploy, update, …)
 *   packages/contracts/src/artifacts/  @dfpunk/contracts — the CLIENT and SERVER
 *
 * None of them is committed — every `artifacts` directory is gitignored — so
 * they exist only
 * as build output, which means any flow that compiles WITHOUT running
 * `copy-artifacts` leaves the later two behind, silently.
 *
 * That is not a hypothetical. It cost a full debugging session: the client had
 * a three-day-old QuotaFpc whose class id was `0x0e554d67…` while the deployed
 * contract was `0x115cfdfd…`. Registration succeeded every time — it filed the
 * artifact under the stale class — and the PXE's lookup for the real class
 * found nothing, reporting "No artifact registered for contract class …" from a
 * stack with no application frames in it. Nothing about the symptom points at a
 * stale copy, and three separate fixes were attempted before the copies were
 * compared.
 *
 * Comparing class ids takes a second and is decisive: the class id is a hash of
 * the artifact, so equal ids mean identical contracts and unequal ids mean the
 * consumer is running something other than what was compiled.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getContractClassFromArtifact } from '@aztec/stdlib/contract';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(contractsRoot, '..');

const SOURCE = path.join(contractsRoot, 'target');
const CONSUMERS = [
    {
        label: 'operator scripts',
        dir: path.join(contractsRoot, 'scripts', 'artifacts'),
    },
    {
        label: 'client + server (@dfpunk/contracts)',
        dir: path.join(repoRoot, 'packages', 'contracts', 'src', 'artifacts'),
    },
];

async function classIdOf(file: string): Promise<string> {
    const { loadContractArtifact } = await import('@aztec/aztec.js/abi');
    const artifact = loadContractArtifact(
        JSON.parse(fs.readFileSync(file, 'utf8')) as never
    );
    return (
        await getContractClassFromArtifact(artifact as never)
    ).id.toString();
}

async function main() {
    if (!fs.existsSync(SOURCE)) {
        console.error(
            `No compiler output at ${path.relative(repoRoot, SOURCE)}.\n` +
                `Run: pnpm --filter contracts run build-contracts`
        );
        process.exit(2);
    }

    const compiled = fs
        .readdirSync(SOURCE)
        .filter((f) => f.endsWith('.json') && f.includes('-'));
    if (compiled.length === 0) {
        console.error(`No artifacts in ${path.relative(repoRoot, SOURCE)}.`);
        process.exit(2);
    }

    const problems: string[] = [];
    for (const { label, dir } of CONSUMERS) {
        for (const name of compiled) {
            const copy = path.join(dir, name);
            if (!fs.existsSync(copy)) {
                problems.push(`MISSING  ${label}: ${name}`);
                continue;
            }
            // Cheap path first: identical bytes cannot have different ids.
            const same = fs
                .readFileSync(copy)
                .equals(fs.readFileSync(path.join(SOURCE, name)));
            if (same) continue;
            const [expected, actual] = await Promise.all([
                classIdOf(path.join(SOURCE, name)),
                classIdOf(copy),
            ]);
            if (expected !== actual) {
                problems.push(
                    `STALE    ${label}: ${name}\n` +
                        `           compiled ${expected}\n` +
                        `           in use   ${actual}`
                );
            }
        }
    }

    if (problems.length > 0) {
        console.error(
            `\nContract artifacts are out of sync — a consumer is running code that was not just compiled.\n`
        );
        for (const p of problems) console.error(`  ${p}`);
        console.error(
            `\nFix: pnpm --filter contracts run build-contracts\n` +
                `(compile alone is not enough; the copy step is what reaches the consumers)\n`
        );
        process.exit(1);
    }

    console.log(
        `Artifacts in sync: ${compiled.length} contract(s) x ${CONSUMERS.length} consumer(s).`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
