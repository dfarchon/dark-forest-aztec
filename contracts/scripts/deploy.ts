/**
 * Deploy all contracts (Config, storage contracts, Admin) and write deployment info to .env.
 * Run: pnpm deploy-contracts  (builds first) or node --experimental-transform-types scripts/deploy.ts
 * Requires: AZTEC_NODE_URL (optional, default http://localhost:8080). Optional: WRITE_ENV_FILE, PROVER_ENABLED.
 */

import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
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
const PROVER_ENABLED = process.env.PROVER_ENABLED !== 'false';

/** Wallet options for deploy: fresh store, prover on/off from env. */
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

async function main() {
    console.log(`🌐 Aztec Node URL: ${AZTEC_NODE_URL}\n`);

    console.log('🔗 Connecting to Aztec node...');
    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);

    console.log('📝 Setting up wallet...');
    const wallet = await setupWallet(aztecNode, WALLET_SETUP_OPTIONS);

    console.log('📝 Registering SponsoredFPC contract...');
    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    console.log('👤 Getting or creating deployer account...');
    const deployer = await getOrCreateAccount(wallet);
    console.log(`✅ Deployer: ${deployer.toString()}\n`);

    console.log('📦 Loading contract artifacts...');
    const configs = await loadDeployConfigs();
    console.log(`🚀 Deploying ${configs.length} contracts...\n`);

    const results = await deployContracts(wallet, deployer, configs, {
        writeEnv: process.env.WRITE_ENV_FILE !== 'false',
        timeoutMs: 120_000,
        sponsoredFpc: sponsoredFPC,
    });

    console.log('✅ Deployment complete.\n');
    console.log('📋 Contract addresses:');
    for (const [name, r] of Object.entries(results)) {
        console.log(`   ${name}: ${r.contractAddress}`);
    }
    const scriptDir = path.dirname(new URL(import.meta.url).pathname);
    const envPath = path.join(scriptDir, '..', '.env');
    console.log(`\n📄 Deployment info appended to ${envPath}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
