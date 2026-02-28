/**
 * Deploy all contracts (Config, storage contracts, Admin) and write deployment info to .env.
 * Run: pnpm deploy-contracts  (builds first) or node --experimental-transform-types scripts/deploy.ts
 * Requires: AZTEC_NODE_URL (optional, default http://localhost:8080). Optional: WRITE_ENV_FILE, PROVER_ENABLED.
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

import {
    type ContractDeployConfig,
    deployContracts,
    getOrCreateAccount,
    getSponsoredPFCContract,
    setupWallet,
} from './utils/index.ts';

dotenv.config();

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED === 'true';

/** Wallet options for deploy: fresh store, prover off for fast local deploy. */
const WALLET_SETUP_OPTIONS = {
    clearStore: false,
    proverEnabled: PROVER_ENABLED,
};

/** Artifact module path (relative to this script) and export name. Matches scripts/artifacts/*.ts (codegen: {package}-{Contract}.ts, export XxxContract). */
const ARTIFACT_SPECS: Array<{
    modulePath: string;
    exportName: string;
}> = [
    { modulePath: './artifacts/Config.ts', exportName: 'ConfigContract' },
    {
        modulePath: './artifacts/WorldStorage.ts',
        exportName: 'WorldStorageContract',
    },
    {
        modulePath: './artifacts/PlayerStorage.ts',
        exportName: 'PlayerStorageContract',
    },
    {
        modulePath: './artifacts/PlanetStorage.ts',
        exportName: 'PlanetStorageContract',
    },
    {
        modulePath: './artifacts/PlanetRevealedCoordsStorage.ts',
        exportName: 'PlanetRevealedCoordsStorageContract',
    },
    {
        modulePath: './artifacts/PlanetEventsStorage.ts',
        exportName: 'PlanetEventsStorageContract',
    },
    {
        modulePath: './artifacts/PlanetArtifactsStorage.ts',
        exportName: 'PlanetArtifactsStorageContract',
    },
    {
        modulePath: './artifacts/ArrivalStorage.ts',
        exportName: 'ArrivalStorageContract',
    },
    {
        modulePath: './artifacts/ArtifactStorage.ts',
        exportName: 'ArtifactStorageContract',
    },
    {
        modulePath: './artifacts/ArtifactLocationStorage.ts',
        exportName: 'ArtifactLocationStorageContract',
    },
    { modulePath: './artifacts/Admin.ts', exportName: 'AdminContract' },
    { modulePath: './artifacts/Core.ts', exportName: 'CoreContract' },
    { modulePath: './artifacts/Move.ts', exportName: 'MoveContract' },
];

/** Deployment order and constructor args. name must match a key used in getConstructorArgs (ctx.addresses). */
const DEPLOY_DEFINITIONS: Array<{
    name: string;
    envPrefix: string;
    getConstructorArgs: (ctx: {
        deployer: { toField: () => unknown };
        addresses: Record<string, { toField: () => unknown }>;
    }) => unknown[];
}> = [
    {
        name: 'Config',
        envPrefix: 'CONFIG',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'WorldStorage',
        envPrefix: 'WORLD_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlayerStorage',
        envPrefix: 'PLAYER_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetStorage',
        envPrefix: 'PLANET_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetRevealedCoordsStorage',
        envPrefix: 'PLANET_REVEALED_COORDS_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetEventsStorage',
        envPrefix: 'PLANET_EVENTS_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'PlanetArtifactsStorage',
        envPrefix: 'PLANET_ARTIFACTS_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArrivalStorage',
        envPrefix: 'ARRIVAL_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactStorage',
        envPrefix: 'ARTIFACT_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'ArtifactLocationStorage',
        envPrefix: 'ARTIFACT_LOCATION_STORAGE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'Admin',
        envPrefix: 'ADMIN',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'Core',
        envPrefix: 'CORE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
    {
        name: 'Move',
        envPrefix: 'MOVE',
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    },
];

async function loadDeployConfigs(): Promise<ContractDeployConfig[]> {
    const configs: ContractDeployConfig[] = [];
    for (let i = 0; i < DEPLOY_DEFINITIONS.length; i++) {
        const def = DEPLOY_DEFINITIONS[i];
        const spec = ARTIFACT_SPECS[i];
        if (!spec) throw new Error(`Missing artifact spec for ${def.name}`);
        const mod = await import(/* @vite-ignore */ spec.modulePath);
        const wrapper = mod[spec.exportName] ?? mod[def.name] ?? mod.default;
        if (!wrapper?.artifact) {
            throw new Error(
                `Artifact not found: ${spec.modulePath} (tried ${spec.exportName}, ${def.name}, default). Run "pnpm build-contracts" first.`
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
    const deployer = await getOrCreateAccount(wallet, aztecNode);
    console.log(`✅ Deployer: ${deployer.toString()}\n`);

    const scriptDir = path.dirname(new URL(import.meta.url).pathname);
    const envPath = path.join(scriptDir, '..', '.env');

    // Record START_BLOCK before deploying the first contract
    const startBlock = Number(await aztecNode.getBlockNumber());
    console.log(`📌 START_BLOCK: ${startBlock}`);
    if (process.env.WRITE_ENV_FILE !== 'false') {
        fs.appendFileSync(envPath, `\n\nSTART_BLOCK=${startBlock}\n`);
    }

    console.log('📦 Loading contract artifacts...');
    const configs = await loadDeployConfigs();
    console.log(`🚀 Deploying ${configs.length} contracts...\n`);

    const results = await deployContracts(wallet, deployer, configs, {
        writeEnv: process.env.WRITE_ENV_FILE !== 'false',
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
