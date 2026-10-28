/**
 * Deploy order and manifest-key prefixes. Later entries may read earlier
 * addresses via ctx.addresses[name]. This is the scripts source of truth.
 */
import type { ContractArtifact } from '@aztec-labs/stdlib/abi';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { CONTRACTS_PACKAGE_ROOT } from '../runtime/env.ts';

export type DeployArgContext = {
    deployer: { toField: () => unknown };
    addresses: Record<string, { toField: () => unknown }>;
};

export type DeployDefinition = {
    name: string;
    envPrefix: string;
    artifactFile: string;
    exportName: string;
    getConstructorArgs: (
        ctx: DeployArgContext
    ) => unknown[] | Promise<unknown[]>;
};

export const ARTIFACTS_DIR = path.join(
    CONTRACTS_PACKAGE_ROOT,
    'scripts',
    'artifacts'
);

function def(
    name: string,
    envPrefix: string,
    artifactFile: string,
    exportName: string
): DeployDefinition {
    return {
        name,
        envPrefix,
        artifactFile,
        exportName,
        getConstructorArgs: (ctx) => [ctx.deployer.toField()],
    };
}

export const DEPLOY_DEFINITIONS: DeployDefinition[] = [
    def('Config', 'CONFIG', 'Config.ts', 'ConfigContract'),
    def(
        'WorldStorage',
        'WORLD_STORAGE',
        'WorldStorage.ts',
        'WorldStorageContract'
    ),
    def(
        'PlayerStorage',
        'PLAYER_STORAGE',
        'PlayerStorage.ts',
        'PlayerStorageContract'
    ),
    def(
        'PlanetStorage',
        'PLANET_STORAGE',
        'PlanetStorage.ts',
        'PlanetStorageContract'
    ),
    def(
        'PlanetRevealedCoordsStorage',
        'PLANET_REVEALED_COORDS_STORAGE',
        'PlanetRevealedCoordsStorage.ts',
        'PlanetRevealedCoordsStorageContract'
    ),
    def(
        'PlanetEventsStorage',
        'PLANET_EVENTS_STORAGE',
        'PlanetEventsStorage.ts',
        'PlanetEventsStorageContract'
    ),
    def(
        'PlanetArtifactsStorage',
        'PLANET_ARTIFACTS_STORAGE',
        'PlanetArtifactsStorage.ts',
        'PlanetArtifactsStorageContract'
    ),
    def(
        'ArrivalStorage',
        'ARRIVAL_STORAGE',
        'ArrivalStorage.ts',
        'ArrivalStorageContract'
    ),
    def(
        'ArtifactStorage',
        'ARTIFACT_STORAGE',
        'ArtifactStorage.ts',
        'ArtifactStorageContract'
    ),
    def(
        'ArtifactLocationStorage',
        'ARTIFACT_LOCATION_STORAGE',
        'ArtifactLocationStorage.ts',
        'ArtifactLocationStorageContract'
    ),
    def('Admin', 'ADMIN', 'Admin.ts', 'AdminContract'),
    def('Core', 'CORE', 'Core.ts', 'CoreContract'),
    def('Move', 'MOVE', 'Move.ts', 'MoveContract'),
    def(
        'ArtifactAction',
        'ARTIFACT_ACTION_SYSTEM',
        'ArtifactAction.ts',
        'ArtifactActionContract'
    ),
    def(
        'ArtifactFind',
        'ARTIFACT_FIND_SYSTEM',
        'ArtifactFind.ts',
        'ArtifactFindContract'
    ),
    def(
        'ArtifactProspect',
        'ARTIFACT_PROSPECT_SYSTEM',
        'ArtifactProspect.ts',
        'ArtifactProspectContract'
    ),
    def(
        'ArtifactValut',
        'ARTIFACT_VAULT_SYSTEM',
        'ArtifactValut.ts',
        'ArtifactValutContract'
    ),
];

/** Deploy params the client needs for PXE registration. Always emitted on publish. */
export const PXE_REGISTRATION_KEYS = [
    'CORE_DEPLOYER_ADDRESS',
    'CORE_DEPLOYMENT_SALT',
    'MOVE_DEPLOYER_ADDRESS',
    'MOVE_DEPLOYMENT_SALT',
    'ADMIN_DEPLOYER_ADDRESS',
    'ADMIN_DEPLOYMENT_SALT',
] as const;

export const KEY_COMMENTS: Record<string, string> = {
    ACCOUNT_ADDRESS: 'The deployer account address.',
    START_BLOCK: 'Block number at deployment start (from deploy script).',
    CONFIG_CONTRACT_ADDRESS: 'The address for the Config contract.',
    WORLD_STORAGE_CONTRACT_ADDRESS:
        'The address for the WorldStorage contract.',
    PLAYER_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlayerStorage contract.',
    PLANET_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetStorage contract.',
    PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetRevealedCoordsStorage contract.',
    PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetEventsStorage contract.',
    PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS:
        'The address for the PlanetArtifactsStorage contract.',
    ARRIVAL_STORAGE_CONTRACT_ADDRESS:
        'The address for the ArrivalStorage contract.',
    ARTIFACT_STORAGE_CONTRACT_ADDRESS:
        'The address for the ArtifactStorage contract.',
    ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS:
        'The address for the ArtifactLocationStorage contract.',
    ADMIN_CONTRACT_ADDRESS: 'The address for the Admin contract.',
    CORE_CONTRACT_ADDRESS: 'The address for the Core contract.',
    MOVE_CONTRACT_ADDRESS: 'The address for the Move contract.',
    ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS:
        'The address for the ArtifactAction system contract.',
    ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS:
        'The address for the ArtifactFind system contract.',
    ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS:
        'The address for the ArtifactProspect system contract.',
    ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS:
        'The address for the ArtifactVault system contract.',
    ADMIN_DEPLOYER_ADDRESS:
        'Deployer address for Admin (for PXE registration).',
    ADMIN_DEPLOYMENT_SALT: 'Deployment salt for Admin (for PXE registration).',
    CORE_DEPLOYER_ADDRESS: 'Deployer address for Core (for PXE registration).',
    CORE_DEPLOYMENT_SALT: 'Deployment salt for Core (for PXE registration).',
    MOVE_DEPLOYER_ADDRESS: 'Deployer address for Move (for PXE registration).',
    MOVE_DEPLOYMENT_SALT: 'Deployment salt for Move (for PXE registration).',
    ARTIFACT_ACTION_SYSTEM_DEPLOYER_ADDRESS:
        'Deployer address for ArtifactAction (for PXE registration).',
    ARTIFACT_ACTION_SYSTEM_DEPLOYMENT_SALT:
        'Deployment salt for ArtifactAction (for PXE registration).',
    ARTIFACT_FIND_SYSTEM_DEPLOYER_ADDRESS:
        'Deployer address for ArtifactFind (for PXE registration).',
    ARTIFACT_FIND_SYSTEM_DEPLOYMENT_SALT:
        'Deployment salt for ArtifactFind (for PXE registration).',
    ARTIFACT_PROSPECT_SYSTEM_DEPLOYER_ADDRESS:
        'Deployer address for ArtifactProspect (for PXE registration).',
    ARTIFACT_PROSPECT_SYSTEM_DEPLOYMENT_SALT:
        'Deployment salt for ArtifactProspect (for PXE registration).',
    ARTIFACT_VAULT_SYSTEM_DEPLOYER_ADDRESS:
        'Deployer address for ArtifactVault (for PXE registration).',
    ARTIFACT_VAULT_SYSTEM_DEPLOYMENT_SALT:
        'Deployment salt for ArtifactVault (for PXE registration).',
};

export type LoadedDeployArtifact = {
    definition: DeployDefinition;
    artifact: ContractArtifact;
};

export function assertCodegenArtifactsPresent(): void {
    const configPath = path.join(ARTIFACTS_DIR, 'Config.ts');
    if (!fs.existsSync(configPath)) {
        console.error(
            `Missing contract codegen: ${configPath}\n` +
                `Run from contracts/: pnpm build:contracts\n` +
                `(compile → codegen → copy TypeScript wrappers to scripts/artifacts/)`
        );
        process.exit(1);
    }
}

export async function loadDeployArtifacts(): Promise<LoadedDeployArtifact[]> {
    const loaded: LoadedDeployArtifact[] = [];
    for (const definition of DEPLOY_DEFINITIONS) {
        const artifactPath = path.join(ARTIFACTS_DIR, definition.artifactFile);
        if (!fs.existsSync(artifactPath)) {
            throw new Error(
                `Artifact not found: ${artifactPath}. Run "pnpm build:contracts" first.`
            );
        }
        const mod = await import(
            /* @vite-ignore */ pathToFileURL(artifactPath).href
        );
        const wrapper =
            mod[definition.exportName] ?? mod[definition.name] ?? mod.default;
        if (!wrapper?.artifact) {
            throw new Error(
                `Artifact not found: ${definition.artifactFile} (tried ${definition.exportName}, ${definition.name}, default). Run "pnpm build:contracts" first.`
            );
        }
        loaded.push({
            definition,
            artifact: wrapper.artifact as ContractArtifact,
        });
    }
    return loaded;
}
