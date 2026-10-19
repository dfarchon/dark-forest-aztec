/**
 * Deploy all contracts and journal each step so a run can resume after interrupt.
 *
 *   pnpm deploy:run
 *   pnpm deploy:run --resume
 *   pnpm deploy:run --resume <id>
 *   pnpm deploy:run --new
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    Contract,
    DeployMethod,
    getContractInstanceFromInstantiationParams,
} from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/aztec.js/fields';
import { PublicKeys } from '@aztec/aztec.js/keys';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import {
    type ContractArtifact,
    getDefaultInitializer,
} from '@aztec/stdlib/abi';

import { loadNetworkEnv } from '../runtime/env.ts';
import {
    buildFeeSendFields,
    exitIfAccountFundingRequired,
} from '../utils/feePayment.ts';
import {
    assertCodegenArtifactsPresent,
    DEPLOY_DEFINITIONS,
    type DeployArgContext,
    loadDeployArtifacts,
    type LoadedDeployArtifact,
} from './definitions.ts';
import {
    combineArtifactFingerprint,
    createDeploymentId,
    createManifest,
    type DeployManifest,
    digestArtifact,
    type ManifestContract,
    readLatestId,
    readManifest,
    relativeManifestPath,
    writeLatest,
    writeManifest,
} from './manifest.ts';
import {
    assertAccountKeysMatch,
    type DeploySession,
    getAztecNodeUrlFromNetwork,
    getProverEnabledFromNetwork,
    openDeploySession,
} from './session.ts';

const DEPLOY_TIMEOUT_MS = 120_000;
const COMMAND_HINT = 'pnpm deploy:run';

type CliArgs =
    | { mode: 'auto' }
    | { mode: 'new' }
    | { mode: 'resume'; id?: string };

function parseArgs(argv: string[]): CliArgs {
    let resume = false;
    let resumeId: string | undefined;
    let forceNew = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--new') {
            forceNew = true;
            continue;
        }
        if (arg === '--resume') {
            resume = true;
            const next = argv[i + 1];
            if (next && !next.startsWith('-')) {
                resumeId = next;
                i += 1;
            }
            continue;
        }
        if (arg.startsWith('--resume=')) {
            resume = true;
            resumeId = arg.slice('--resume='.length);
            continue;
        }
        throw new Error(
            `Unknown argument: ${arg}\n` +
                'Usage: pnpm deploy:run [--resume [id] | --new]'
        );
    }

    if (resume && forceNew) {
        throw new Error('Use either --resume or --new, not both.');
    }
    if (forceNew) return { mode: 'new' };
    if (resume) return { mode: 'resume', id: resumeId };
    return { mode: 'auto' };
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

function fingerprintArtifacts(loaded: LoadedDeployArtifact[]): string {
    return combineArtifactFingerprint(
        loaded.map(({ definition, artifact }) =>
            digestArtifact(definition.name, artifact)
        )
    );
}

function byName(
    loaded: LoadedDeployArtifact[]
): Map<string, LoadedDeployArtifact> {
    return new Map(loaded.map((item) => [item.definition.name, item]));
}

function buildArgContext(
    deployer: AztecAddress,
    addresses: Record<string, AztecAddress>
): DeployArgContext {
    return { deployer, addresses };
}

async function instantiate(
    artifact: ContractArtifact,
    deployer: AztecAddress,
    salt: Fr,
    constructorArgs: unknown[]
) {
    const initializer = getDefaultInitializer(artifact);
    return getContractInstanceFromInstantiationParams(artifact, {
        publicKeys: PublicKeys.default(),
        constructorArtifact: initializer,
        constructorArgs,
        deployer,
        salt,
    });
}

async function sendDeploy(params: {
    wallet: Wallet;
    artifact: ContractArtifact;
    deployer: AztecAddress;
    salt: Fr;
    constructorArgs: unknown[];
    instance: Awaited<ReturnType<typeof instantiate>>;
    feeCtx: DeploySession['feeCtx'];
}): Promise<void> {
    const initializer = getDefaultInitializer(params.artifact);
    const deployMethod = DeployMethod.create(
        params.wallet,
        {
            artifact: params.artifact,
            postDeployCtor: (instance, wallet) =>
                Contract.at(instance.address, params.artifact, wallet),
            args: params.constructorArgs,
            constructorNameOrArtifact: initializer?.name,
        },
        {
            salt: params.salt,
            deployer: params.deployer,
            publicKeys: params.instance.publicKeys,
        }
    );

    await deployMethod.send({
        from: params.deployer,
        ...buildFeeSendFields(params.feeCtx),
        wait: { timeout: DEPLOY_TIMEOUT_MS },
    });
}

async function isOnChain(
    aztecNode: AztecNode,
    address: string
): Promise<boolean> {
    const instance = await aztecNode.getContract(
        AztecAddress.fromStringUnsafe(address)
    );
    return instance != null;
}

function printComplete(manifest: DeployManifest): void {
    console.log('✅ Deployment complete.\n');
    console.log('📋 Contract addresses:');
    for (const entry of manifest.contracts) {
        console.log(`   ${entry.name}: ${entry.address}`);
    }
    console.log(
        `\n📄 Manifest: ${relativeManifestPath(manifest.network, manifest.id)}`
    );
}

type ResumeExpectation = {
    network: string;
    nodeUrl: string;
    deployerAddress: string;
    artifactFingerprint: string;
};

function guardResume(
    manifest: DeployManifest,
    expected: ResumeExpectation
): void {
    const reasons: string[] = [];
    if (manifest.network !== expected.network) {
        reasons.push(
            `network: manifest ${manifest.network}, current ${expected.network}`
        );
    }
    if (manifest.nodeUrl !== expected.nodeUrl) {
        reasons.push(
            `node URL: manifest ${manifest.nodeUrl}, current ${expected.nodeUrl}`
        );
    }
    if (manifest.deployerAddress !== expected.deployerAddress) {
        reasons.push(
            `deployer: manifest ${manifest.deployerAddress}, current ${expected.deployerAddress}`
        );
    }
    if (manifest.artifactFingerprint !== expected.artifactFingerprint) {
        reasons.push(
            'artifact fingerprint differs (rebuild would mix bytecode). Re-run with --new after pnpm build:contracts.'
        );
    }
    if (reasons.length === 0) return;
    throw new Error(
        `Cannot resume deployment ${manifest.id}:\n` +
            reasons.map((reason) => `  - ${reason}`).join('\n')
    );
}

function expectationFromSession(
    session: DeploySession,
    artifactFingerprint: string
): ResumeExpectation {
    return {
        network: session.network,
        nodeUrl: session.nodeUrl,
        deployerAddress: session.deployer.toString(),
        artifactFingerprint,
    };
}

/** File and key checks that do not need a node. Exits when a new run would collide. */
function preflightBatch(params: {
    args: CliArgs;
    expected: ResumeExpectation;
}): void {
    const { args, expected } = params;
    const { network } = expected;

    if (args.mode === 'resume') {
        const id = args.id ?? readLatestId(network);
        if (!id) {
            throw new Error(
                `No deployment to resume on ${network}. Start one with pnpm deploy:run.`
            );
        }
        guardResume(readManifest(network, id), expected);
        return;
    }

    if (args.mode !== 'auto') return;

    const latestId = readLatestId(network);
    if (!latestId) return;
    const latest = readManifest(network, latestId);
    if (latest.status !== 'in_progress') return;

    console.error(
        [
            `\nDeployment ${latest.id} is still in progress.`,
            `  Manifest: ${relativeManifestPath(network, latest.id)}`,
            '  Resume:   pnpm deploy:run --resume',
            `  Or id:    pnpm deploy:run --resume ${latest.id}`,
            '  New run:  pnpm deploy:run --new',
            '',
        ].join('\n')
    );
    process.exit(1);
}

async function resolveManifest(params: {
    args: CliArgs;
    session: DeploySession;
    artifactFingerprint: string;
}): Promise<DeployManifest> {
    const { args, session, artifactFingerprint } = params;
    const { network, nodeUrl, deployer, aztecNode } = session;

    if (args.mode === 'resume') {
        const id = args.id ?? readLatestId(network);
        if (!id) {
            throw new Error(
                `No deployment to resume on ${network}. Start one with pnpm deploy:run.`
            );
        }
        const manifest = readManifest(network, id);
        guardResume(
            manifest,
            expectationFromSession(session, artifactFingerprint)
        );
        writeLatest(network, manifest.id);
        return manifest;
    }

    if (args.mode === 'auto') {
        const latestId = readLatestId(network);
        if (latestId) {
            const latest = readManifest(network, latestId);
            if (latest.status === 'in_progress') {
                console.error(
                    [
                        `\nDeployment ${latest.id} is still in progress.`,
                        `  Manifest: ${relativeManifestPath(network, latest.id)}`,
                        '  Resume:   pnpm deploy:run --resume',
                        `  Or id:    pnpm deploy:run --resume ${latest.id}`,
                        '  New run:  pnpm deploy:run --new',
                        '',
                    ].join('\n')
                );
                process.exit(1);
            }
        }
    }

    const id = createDeploymentId();
    const startBlock = Number(await aztecNode.getBlockNumber());
    const manifest = createManifest({
        id,
        network,
        nodeUrl,
        deployerAddress: deployer.toString(),
        startBlock,
        artifactFingerprint,
        definitions: DEPLOY_DEFINITIONS,
    });
    writeLatest(network, id);
    console.log(`📌 START_BLOCK: ${startBlock}`);
    console.log(`🆔 Deployment id: ${id}`);
    console.log(`📄 ${relativeManifestPath(network, id)}\n`);
    return manifest;
}

function updateContract(
    manifest: DeployManifest,
    name: string,
    patch: Partial<ManifestContract>
): DeployManifest {
    return writeManifest({
        ...manifest,
        contracts: manifest.contracts.map((entry) =>
            entry.name === name ? { ...entry, ...patch } : entry
        ),
    });
}

async function deployOne(params: {
    manifest: DeployManifest;
    entry: ManifestContract;
    loaded: LoadedDeployArtifact;
    session: DeploySession;
    ctx: DeployArgContext;
    index: number;
    total: number;
    scriptStartTime: number;
}): Promise<DeployManifest> {
    const { loaded, session, ctx, index, total, scriptStartTime } = params;
    let { manifest, entry } = params;
    const { definition, artifact } = loaded;
    const { wallet, deployer, feeCtx, aztecNode } = session;

    if (entry.status === 'planned') {
        const constructorArgs = await definition.getConstructorArgs(ctx);
        const salt = Fr.random();
        const instance = await instantiate(
            artifact,
            deployer,
            salt,
            constructorArgs
        );
        manifest = updateContract(manifest, definition.name, {
            status: 'prepared',
            salt: salt.toString(),
            address: instance.address.toString(),
            deployerAddress: deployer.toString(),
        });
        entry = manifest.contracts.find((c) => c.name === definition.name)!;
    }

    if (!entry.salt || !entry.address) {
        throw new Error(
            `Deployment ${manifest.id} contract ${definition.name} is missing salt/address.`
        );
    }

    const constructorArgs = await definition.getConstructorArgs(ctx);
    const salt = Fr.fromString(entry.salt);
    const instance = await instantiate(
        artifact,
        deployer,
        salt,
        constructorArgs
    );
    if (instance.address.toString() !== entry.address) {
        throw new Error(
            `Computed address for ${definition.name} does not match the manifest.\n` +
                `  Manifest: ${entry.address}\n` +
                `  Computed: ${instance.address.toString()}`
        );
    }

    if (entry.status === 'prepared') {
        const existing = await isOnChain(aztecNode, entry.address);
        if (existing) {
            console.log(
                `   [${index + 1}/${total}] ${definition.name} already on chain, recording.`
            );
            manifest = updateContract(manifest, definition.name, {
                status: 'deployed',
                deployedAt: new Date().toISOString(),
            });
            await wallet.registerContract(instance, artifact);
            return manifest;
        }

        console.log(
            `   [${index + 1}/${total}] Deploying ${definition.name}...`
        );
        const stepStart = Date.now();
        await sendDeploy({
            wallet,
            artifact,
            deployer,
            salt,
            constructorArgs,
            instance,
            feeCtx,
        });
        await wallet.registerContract(instance, artifact);
        manifest = updateContract(manifest, definition.name, {
            status: 'deployed',
            deployedAt: new Date().toISOString(),
        });
        const stepMs = Date.now() - stepStart;
        const stepTime =
            stepMs >= 1000 ? `${(stepMs / 1000).toFixed(1)}s` : `${stepMs}ms`;
        console.log(
            `   ✅ ${definition.name} (${stepTime}) | elapsed: ${formatElapsed(Date.now() - scriptStartTime)}`
        );
        return manifest;
    }

    console.log(
        `   [${index + 1}/${total}] Skipping ${definition.name} (already deployed)`
    );
    await wallet.registerContract(instance, artifact);
    return manifest;
}

async function runDeploy(
    manifest: DeployManifest,
    session: DeploySession,
    loadedList: LoadedDeployArtifact[]
) {
    const scriptStartTime = Date.now();
    if (manifest.status === 'complete') {
        printComplete(manifest);
        console.log(
            `⏱️  Already complete (${relativeManifestPath(manifest.network, manifest.id)})`
        );
        return;
    }

    const loaded = byName(loadedList);
    const already = manifest.contracts.filter(
        (entry) => entry.status === 'deployed'
    ).length;
    if (already > 0) {
        console.log(
            `↩️  Resuming ${manifest.id}: ${already}/${manifest.contracts.length} already deployed`
        );
    }
    console.log(`🚀 Deploying ${manifest.contracts.length} contracts...\n`);

    const addresses: Record<string, AztecAddress> = {};
    let current = manifest;

    for (let i = 0; i < current.contracts.length; i++) {
        const entry = current.contracts[i]!;
        const item = loaded.get(entry.name);
        if (!item) {
            throw new Error(
                `Manifest contract ${entry.name} is not in DEPLOY_DEFINITIONS.`
            );
        }
        if (entry.address) {
            addresses[entry.name] = AztecAddress.fromStringUnsafe(
                entry.address
            );
        }
        current = await deployOne({
            manifest: current,
            entry: current.contracts[i]!,
            loaded: item,
            session,
            ctx: buildArgContext(session.deployer, { ...addresses }),
            index: i,
            total: current.contracts.length,
            scriptStartTime,
        });
        const updated = current.contracts[i]!;
        if (updated.address) {
            addresses[updated.name] = AztecAddress.fromStringUnsafe(
                updated.address
            );
        }
    }

    current = writeManifest({ ...current, status: 'complete' });
    printComplete(current);
    console.log(
        `⏱️  Total time: ${formatElapsed(Date.now() - scriptStartTime)}`
    );
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    assertCodegenArtifactsPresent();

    const deployerAddress = await assertAccountKeysMatch();
    const ctx = loadNetworkEnv();
    const nodeUrl = getAztecNodeUrlFromNetwork();
    const proverEnabled = getProverEnabledFromNetwork();
    console.log('📦 Loading contract artifacts...');
    const loaded = await loadDeployArtifacts();
    const artifactFingerprint = fingerprintArtifacts(loaded);
    console.log(
        [
            'Preflight ok (no node yet).',
            `  Network:   ${ctx.network}`,
            `  Node:      ${nodeUrl}`,
            `  Fee mode:  ${ctx.values.FEE_PAYMENT_MODE}`,
            `  Prover:    ${proverEnabled ? 'on' : 'off'}`,
            `  Deployer:  ${deployerAddress}`,
            `  Artifacts: ${loaded.length}`,
            '',
        ].join('\n')
    );
    preflightBatch({
        args,
        expected: {
            network: ctx.network,
            nodeUrl,
            deployerAddress,
            artifactFingerprint,
        },
    });

    const session = await openDeploySession({ commandHint: COMMAND_HINT });
    const manifest = await resolveManifest({
        args,
        session,
        artifactFingerprint,
    });

    console.log(
        `🆔 Deployment: ${manifest.id} (${manifest.status}) on ${manifest.network}`
    );
    await runDeploy(manifest, session, loaded);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
