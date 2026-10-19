import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, type ContractBase } from '@aztec/aztec.js/contracts';

import {
    loadDeployArtifacts,
    type LoadedDeployArtifact,
} from '../deploy/definitions.ts';
import {
    type DeployManifest,
    relativeManifestPath,
} from '../deploy/manifest.ts';
import {
    addressesFromManifest,
    assertContractsDeployed,
    resolveCompletedDeployment,
} from '../deploy/onchain.ts';
import { type DeploySession, openDeploySession } from '../deploy/session.ts';

export type BootstrapTargetArgs = {
    id?: string;
    rest: string[];
};

export type BootstrapContext = {
    session: DeploySession;
    manifest: DeployManifest;
    addresses: Record<string, string>;
    contracts: Record<string, ContractBase>;
};

export function parseBootstrapTargetArgs(argv: string[]): BootstrapTargetArgs {
    let id: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--id') {
            const next = argv[i + 1];
            if (!next || next.startsWith('-')) {
                throw new Error('Missing value for --id.');
            }
            id = next;
            i += 1;
        } else if (arg.startsWith('--id=')) {
            id = arg.slice('--id='.length);
            if (!id) throw new Error('Missing value for --id.');
        } else {
            rest.push(arg);
        }
    }
    return { id, rest };
}

async function connectContracts(
    loaded: LoadedDeployArtifact[],
    addresses: Record<string, string>,
    session: DeploySession
): Promise<Record<string, ContractBase>> {
    const contracts: Record<string, ContractBase> = {};
    for (const { definition, artifact } of loaded) {
        const address = addresses[definition.name];
        if (!address) {
            throw new Error(`Missing ${definition.name} in deploy manifest.`);
        }
        contracts[definition.name] = Contract.at(
            AztecAddress.fromStringUnsafe(address),
            artifact,
            session.wallet
        );
    }
    return contracts;
}

export async function openBootstrapContext(options: {
    id?: string;
    commandHint: string;
    readonly?: boolean;
}): Promise<BootstrapContext> {
    const session = await openDeploySession({
        commandHint: options.commandHint,
        requireFeeJuice: !options.readonly,
    });
    const manifest = resolveCompletedDeployment(session.network, options.id);
    const addresses = addressesFromManifest(manifest);
    console.log('🔎 Checking deployed contracts on the current chain...');
    await assertContractsDeployed(session.aztecNode, addresses);
    console.log(`✅ ${Object.keys(addresses).length} contracts found on-chain`);
    const loaded = await loadDeployArtifacts();
    const contracts = await connectContracts(loaded, addresses, session);
    console.log(
        `📄 Deployment: ${manifest.id} (${relativeManifestPath(session.network, manifest.id)})`
    );
    return { session, manifest, addresses, contracts };
}
