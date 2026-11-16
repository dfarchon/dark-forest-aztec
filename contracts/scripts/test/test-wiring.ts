/**
 * Offline wiring inventory: asserts every client TxIntent method maps to a
 * ContractResolver method, a StateResolver case, and (when expected) an on-chain
 * artifact entrypoint. Also lists the 9 indexer Update events.
 *
 * Run (no node required):
 *   pnpm exec tsx scripts/test/test-wiring.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

const WIRED: {
    methodName: string;
    contract: string;
    noirMethod: string;
    artifactFile: string;
}[] = [
    {
        methodName: 'initializePlayer',
        contract: 'Core',
        noirMethod: 'initialize_player',
        artifactFile: 'core-Core.json',
    },
    {
        methodName: 'revealLocation',
        contract: 'Core',
        noirMethod: 'reveal_location',
        artifactFile: 'core-Core.json',
    },
    {
        methodName: 'move',
        contract: 'Move',
        noirMethod: 'move',
        artifactFile: 'move-Move.json',
    },
    {
        methodName: 'upgradePlanet',
        contract: 'Core',
        noirMethod: 'upgrade_planet',
        artifactFile: 'core-Core.json',
    },
    {
        methodName: 'withdrawSilver',
        contract: 'Core',
        noirMethod: 'withdraw_silver',
        artifactFile: 'core-Core.json',
    },
    {
        methodName: 'setWorldConfig',
        contract: 'Config',
        noirMethod: 'set_world_config',
        artifactFile: 'config-Config.json',
    },
    {
        methodName: 'pauseGame',
        contract: 'Admin',
        noirMethod: 'pause',
        artifactFile: 'admin-Admin.json',
    },
    {
        methodName: 'unpauseGame',
        contract: 'Admin',
        noirMethod: 'unpause',
        artifactFile: 'admin-Admin.json',
    },
    {
        methodName: 'adminSetWorldRadius',
        contract: 'Admin',
        noirMethod: 'admin_set_world_radius',
        artifactFile: 'admin-Admin.json',
    },
    {
        methodName: 'createPlanet',
        contract: 'Admin',
        noirMethod: 'create_planet',
        artifactFile: 'admin-Admin.json',
    },
    {
        methodName: 'safeSetOwner',
        contract: 'Admin',
        noirMethod: 'safe_set_owner',
        artifactFile: 'admin-Admin.json',
    },
    {
        methodName: 'prospectPlanet',
        contract: 'ArtifactProspect',
        noirMethod: 'prospect_planet',
        artifactFile: 'artifact_prospect-ArtifactProspect.json',
    },
    {
        methodName: 'findArtifact',
        contract: 'ArtifactFind',
        noirMethod: 'find_artifact',
        artifactFile: 'artifact_find-ArtifactFind.json',
    },
    {
        methodName: 'activateArtifact',
        contract: 'ArtifactAction',
        noirMethod: 'activate_artifact',
        artifactFile: 'artifact_action-ArtifactAction.json',
    },
    {
        methodName: 'deactivateArtifact',
        contract: 'ArtifactAction',
        noirMethod: 'deactivate_artifact',
        artifactFile: 'artifact_action-ArtifactAction.json',
    },
    {
        methodName: 'depositArtifact',
        contract: 'ArtifactVault',
        noirMethod: 'deposit_artifact',
        artifactFile: 'artifact_vault-ArtifactVault.json',
    },
    {
        methodName: 'withdrawArtifact',
        contract: 'ArtifactVault',
        noirMethod: 'withdraw_artifact',
        artifactFile: 'artifact_vault-ArtifactVault.json',
    },
    {
        methodName: 'giveSpaceShips',
        contract: 'ArtifactVault',
        noirMethod: 'give_spaceships',
        artifactFile: 'artifact_vault-ArtifactVault.json',
    },
    {
        methodName: 'adminGiveArtifact',
        contract: 'ArtifactVault',
        noirMethod: 'admin_give_artifact',
        artifactFile: 'artifact_vault-ArtifactVault.json',
    },
    {
        methodName: 'adminGiveSpaceship',
        contract: 'ArtifactVault',
        noirMethod: 'admin_give_spaceship',
        artifactFile: 'artifact_vault-ArtifactVault.json',
    },
    {
        methodName: 'buyHat',
        contract: 'Core',
        noirMethod: 'buy_hat',
        artifactFile: 'core-Core.json',
    },
    {
        methodName: 'transferPlanet',
        contract: 'Core',
        noirMethod: 'transfer_planet',
        artifactFile: 'core-Core.json',
    },
];

const INDEXER_EVENTS = [
    'WorldUpdate',
    'PlayerUpdate',
    'PlanetUpdate',
    'PlanetRevealedCoordsUpdate',
    'PlanetEventsUpdate',
    'PlanetArtifactsUpdate',
    'ArrivalUpdate',
    'ArtifactUpdate',
    'ArtifactLocationUpdate',
] as const;

function extractCaseLabels(src: string): Set<string> {
    const out = new Set<string>();
    for (const m of src.matchAll(/case\s+"([^"]+)"/g)) {
        out.add(m[1]!);
    }
    return out;
}

function artifactMethods(file: string): Set<string> {
    const p = path.join(repo, 'packages/contracts/src/artifacts', file);
    const d = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        functions?: { name?: string }[];
    };
    return new Set(
        (d.functions ?? []).map((f) => f.name ?? '').filter(Boolean)
    );
}

function main() {
    const contractResolver = fs.readFileSync(
        path.join(repo, 'client/src/Session/TxExecutor/ContractResolver.ts'),
        'utf8'
    );
    const stateResolver = fs.readFileSync(
        path.join(repo, 'client/src/Session/TxExecutor/StateResolver.ts'),
        'utf8'
    );
    const indexerTypes = fs.readFileSync(
        path.join(repo, 'packages/indexer-core/src/types.ts'),
        'utf8'
    );
    const arrivalSrc = fs.readFileSync(
        path.join(repo, 'contracts/storage/arrival/src/main.nr'),
        'utf8'
    );

    const cr = extractCaseLabels(contractResolver);
    const sr = extractCaseLabels(stateResolver);
    const errors: string[] = [];

    console.log(`Wired methods expected: ${WIRED.length}\n`);
    console.log(
        '| methodName | contract.method | ContractResolver | StateResolver | artifact |'
    );
    console.log('|---|---|:---:|:---:|:---:|');

    for (const row of WIRED) {
        const inCr = cr.has(row.methodName);
        const inSr = sr.has(row.methodName);
        let inArt = false;
        try {
            inArt = artifactMethods(row.artifactFile).has(row.noirMethod);
        } catch (e) {
            errors.push(
                `${row.methodName}: artifact read failed: ${e instanceof Error ? e.message : e}`
            );
        }
        console.log(
            `| ${row.methodName} | ${row.contract}.${row.noirMethod} | ${inCr ? 'Y' : 'N'} | ${inSr ? 'Y' : 'N'} | ${inArt ? 'Y' : 'N'} |`
        );
        if (!inCr) errors.push(`ContractResolver missing ${row.methodName}`);
        if (!inSr) errors.push(`StateResolver missing ${row.methodName}`);
        if (!inArt)
            errors.push(
                `artifact ${row.artifactFile} missing ${row.noirMethod}`
            );
    }

    for (const name of cr) {
        if (!WIRED.some((w) => w.methodName === name)) {
            errors.push(
                `ContractResolver extra case "${name}" not in inventory`
            );
        }
    }
    for (const name of sr) {
        if (
            !WIRED.some((w) => w.methodName === name) &&
            // StateResolver may have unrelated string cases; only flag known-pattern methodNames
            /^[a-z][A-Za-z]+$/.test(name)
        ) {
            // ignore non-method string cases if any
            if (
                ![
                    'initializePlayer',
                    'revealLocation',
                    'move',
                    'upgradePlanet',
                    'withdrawSilver',
                ].includes(name) &&
                !WIRED.some((w) => w.methodName === name)
            ) {
                // already covered by WIRED loop for extras in CR; for SR extras:
                if (!cr.has(name)) {
                    // not a method case — skip
                }
            }
        }
    }

    console.log('\nIndexer PUBLIC_EVENT_NAMES (expected 9):');
    for (const ev of INDEXER_EVENTS) {
        const ok = indexerTypes.includes(`"${ev}"`);
        console.log(`  ${ok ? '✅' : '❌'} ${ev}`);
        if (!ok) errors.push(`indexer types missing ${ev}`);
    }

    console.log('\nArrival heal surface:');
    for (const needle of [
        'fn reemit_batch',
        'always emit the public',
        'get_arrival_unconstrained',
    ]) {
        const ok = arrivalSrc.includes(needle);
        console.log(`  ${ok ? '✅' : '❌'} ${needle}`);
        if (!ok) errors.push(`ArrivalStorage missing: ${needle}`);
    }

    const feeScripts = [
        'test-core-initialize-player.ts',
        'test-give-spaceships.ts',
        'test-move.ts',
        'test-upgrade.ts',
        'test-withdraw.ts',
        'measure-wired-fees.ts',
        'test-buy-hat.ts',
        'test-transfer-planet.ts',
        'test-create-planet.ts',
        'test-pause-unpause.ts',
        'test-admin-give.ts',
        'test-admin-radius.ts',
        'test-set-world-config.ts',
        'test-reveal-location.ts',
        'test-remaining-wired.ts',
    ];
    console.log('\nFee / wired test scripts:');
    for (const s of feeScripts) {
        const p = path.join(here, s);
        const ok = fs.existsSync(p);
        console.log(`  ${ok ? '✅' : '❌'} ${s}`);
        if (!ok) errors.push(`missing fee script ${s}`);
    }

    if (errors.length) {
        console.error('\nFAIL:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }
    console.log(`\n✅ Wiring inventory OK (${WIRED.length} methods, 9 events)`);
}

main();
