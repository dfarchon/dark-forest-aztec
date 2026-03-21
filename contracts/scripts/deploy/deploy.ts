/**
 * Deploy all contracts (Config, storage contracts, system contracts) and write deployment info to .env.
 * Requires generated TS artifacts under `scripts/artifacts/` (from `pnpm build-contracts`).
 * `pnpm deploy-contracts` runs that pipeline first; to deploy without rebuilding, run this file with node after a successful build.
 * Requires: AZTEC_NODE_URL (optional, default http://localhost:8080). Optional: WRITE_ENV_FILE, PROVER_ENABLED.
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    type ContractDeployConfig,
    deployContracts,
    getAztecNodeUrl,
    getContractsEnvFilePath,
    getProverEnabled,
    getSponsoredPFCContract,
    getWriteEnvFile,
    loadContractsEnv,
    resolveDeployerAccount,
    setupWallet,
} from '../utils/index.ts';

loadContractsEnv();

const AZTEC_NODE_URL = getAztecNodeUrl();
const PROVER_ENABLED = getProverEnabled();

/** Wallet options for deploy: fresh store, prover off for fast local deploy. */
const WALLET_SETUP_OPTIONS = {
    clearStore: false,
    proverEnabled: PROVER_ENABLED,
};

/**
 * Unified deploy definitions. Each entry specifies:
 * - name: unique key used in ctx.addresses and deployment results
 * - envPrefix: prefix for .env keys (e.g. "CONFIG" -> CONFIG_CONTRACT_ADDRESS)
 * - modulePath: path to codegen artifact (relative to this script)
 * - exportName: the TypeScript export from the artifact module
 * - getConstructorArgs: builds constructor args from deploy context
 *
 * Order matters: later entries can reference earlier ones via ctx.addresses[name].
 */
const DEPLOY_DEFINITIONS: Array<{
    name: string;
    envPrefix: string;
    modulePath: string;
    exportName: string;
    getConstructorArgs: (ctx: {
        deployer: { toField: () => unknown };
        addresses: Record<string, { toField: () => unknown }>;
    }) => unknown[];
}> = [
    // --- Config ---
    {
        name: 'Config',
        envPrefix: 'CONFIG',
        modulePath: '../artifacts/Config.ts',
        exportName: 'ConfigContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    // --- Storage contracts ---
    {
        name: 'WorldStorage',
        envPrefix: 'WORLD_STORAGE',
        modulePath: '../artifacts/WorldStorage.ts',
        exportName: 'WorldStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlayerStorage',
        envPrefix: 'PLAYER_STORAGE',
        modulePath: '../artifacts/PlayerStorage.ts',
        exportName: 'PlayerStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetStorage',
        envPrefix: 'PLANET_STORAGE',
        modulePath: '../artifacts/PlanetStorage.ts',
        exportName: 'PlanetStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetRevealedCoordsStorage',
        envPrefix: 'PLANET_REVEALED_COORDS_STORAGE',
        modulePath: '../artifacts/PlanetRevealedCoordsStorage.ts',
        exportName: 'PlanetRevealedCoordsStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetEventsStorage',
        envPrefix: 'PLANET_EVENTS_STORAGE',
        modulePath: '../artifacts/PlanetEventsStorage.ts',
        exportName: 'PlanetEventsStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetArtifactsStorage',
        envPrefix: 'PLANET_ARTIFACTS_STORAGE',
        modulePath: '../artifacts/PlanetArtifactsStorage.ts',
        exportName: 'PlanetArtifactsStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArrivalStorage',
        envPrefix: 'ARRIVAL_STORAGE',
        modulePath: '../artifacts/ArrivalStorage.ts',
        exportName: 'ArrivalStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactStorage',
        envPrefix: 'ARTIFACT_STORAGE',
        modulePath: '../artifacts/ArtifactStorage.ts',
        exportName: 'ArtifactStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactLocationStorage',
        envPrefix: 'ARTIFACT_LOCATION_STORAGE',
        modulePath: '../artifacts/ArtifactLocationStorage.ts',
        exportName: 'ArtifactLocationStorageContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    // --- System contracts ---
    {
        name: 'Admin',
        envPrefix: 'ADMIN',
        modulePath: '../artifacts/Admin.ts',
        exportName: 'AdminContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'Core',
        envPrefix: 'CORE',
        modulePath: '../artifacts/Core.ts',
        exportName: 'CoreContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'Move',
        envPrefix: 'MOVE',
        modulePath: '../artifacts/Move.ts',
        exportName: 'MoveContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactAction',
        envPrefix: 'ARTIFACT_ACTION_SYSTEM',
        modulePath: '../artifacts/ArtifactAction.ts',
        exportName: 'ArtifactActionContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactFind',
        envPrefix: 'ARTIFACT_FIND_SYSTEM',
        modulePath: '../artifacts/ArtifactFind.ts',
        exportName: 'ArtifactFindContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactProspect',
        envPrefix: 'ARTIFACT_PROSPECT_SYSTEM',
        modulePath: '../artifacts/ArtifactProspect.ts',
        exportName: 'ArtifactProspectContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactValut',
        envPrefix: 'ARTIFACT_VAULT_SYSTEM',
        modulePath: '../artifacts/ArtifactValut.ts',
        exportName: 'ArtifactValutContract',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
];

const DEPLOY_SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Fail fast if `pnpm build-contracts` / `copy-artifacts` has not populated `scripts/artifacts/`. */
function assertCodegenArtifactsPresent(): void {
    const configPath = path.join(DEPLOY_SCRIPT_DIR, '../artifacts/Config.ts');
    if (!fs.existsSync(configPath)) {
        console.error(
            `Missing contract codegen: ${configPath}\n` +
                `Run from contracts/: pnpm build-contracts\n` +
                `(compile → codegen → copy TypeScript wrappers to scripts/artifacts/)`
        );
        process.exit(1);
    }
}

async function loadDeployConfigs(): Promise<ContractDeployConfig[]> {
    const configs: ContractDeployConfig[] = [];
    for (const def of DEPLOY_DEFINITIONS) {
        const mod = await import(/* @vite-ignore */ def.modulePath);
        const wrapper = mod[def.exportName] ?? mod[def.name] ?? mod.default;
        if (!wrapper?.artifact) {
            throw new Error(
                `Artifact not found: ${def.modulePath} (tried ${def.exportName}, ${def.name}, default). Run "pnpm build-contracts" first.`
            );
        }
        configs.push({
            name: def.name,
            envPrefix: def.envPrefix,
            artifact: wrapper.artifact,
            getConstructorArgs:
                def.getConstructorArgs as ContractDeployConfig['getConstructorArgs'],
        });
    }
    return configs;
}

function formatElapsed(ms: number): string {
    if (ms >= 60000) {
        const m = Math.floor(ms / 60000);
        const s = ((ms % 60000) / 1000).toFixed(1);
        return `${m}m ${s}s`;
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

async function main() {
    const scriptStartTime = Date.now();

    assertCodegenArtifactsPresent();

    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}`);
    console.log(
        `⚡ Prover: ${PROVER_ENABLED ? 'ON (slow — each contract ~2–5 min)' : 'OFF (fast)'}\n`
    );

    if (PROVER_ENABLED) {
        console.warn(
            '⚠️  PROVER_ENABLED=true: deploy will be very slow. For fast local deploy, unset it or set PROVER_ENABLED=false.\n'
        );
    }

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    console.log('📝 Setting up wallet...');
    const wallet = await setupWallet(aztecNode, WALLET_SETUP_OPTIONS);

    console.log('📝 Registering SponsoredFPC contract...');
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    console.log('👤 Getting or creating deployer account...');
    const deployer = await resolveDeployerAccount(wallet, aztecNode, {
        mode: 'getOrCreate',
        deployTimeoutMs: 120_000,
    });
    console.log(`✅ Deployer: ${deployer.toString()}\n`);

    const envPath = getContractsEnvFilePath();
    const writeEnv = getWriteEnvFile();

    const startBlock = Number(await aztecNode.getBlockNumber());
    console.log(`📌 START_BLOCK: ${startBlock}`);
    if (writeEnv) {
        fs.appendFileSync(envPath, `\n\nSTART_BLOCK=${startBlock}\n`);
    }

    console.log('📦 Loading contract artifacts...');
    const configs = await loadDeployConfigs();
    console.log(`🚀 Deploying ${configs.length} contracts...\n`);

    const results = await deployContracts(wallet, deployer, configs, {
        writeEnv,
        timeoutMs: 120_000,
        sponsoredFpc: sponsoredFPC,
        scriptStartTime,
        onDeploy: (name, index, total) => {
            console.log(`   [${index + 1}/${total}] Deploying ${name}...`);
        },
        onDeployComplete: (name, index, total, stepMs, totalElapsed) => {
            const stepTime =
                stepMs >= 1000
                    ? `${(stepMs / 1000).toFixed(1)}s`
                    : `${stepMs}ms`;
            console.log(
                `   ✅ ${name} (${stepTime}) | elapsed: ${formatElapsed(totalElapsed)}`
            );
        },
    });

    const totalElapsed = Date.now() - scriptStartTime;
    console.log('✅ Deployment complete.\n');
    console.log('📋 Contract addresses:');
    for (const [name, r] of Object.entries(results)) {
        console.log(`   ${name}: ${r.contractAddress}`);
    }
    console.log(`\n📄 Deployment info appended to ${envPath}`);
    console.log(
        `⏱️  Total time: ${formatElapsed(totalElapsed)} (${totalElapsed}ms)`
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
