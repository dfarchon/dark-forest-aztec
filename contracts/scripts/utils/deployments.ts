import fs from 'fs';
import path from 'path';

const DEFAULT_DEPLOYMENTS_PATH = path.join(
    import.meta.dirname,
    '..',
    '..',
    'deployments.json'
);

export type DeploymentContract = {
    contractAddress: string;
    deployerAddress: string;
    deploymentSalt: string;
};

export type DeploymentsJson = {
    startBlock: number;
    accountAddress: string;
    contracts: Record<string, DeploymentContract>;
};

const EMPTY_DEPLOYMENTS: DeploymentsJson = {
    startBlock: 0,
    accountAddress: '',
    contracts: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function readDeployments(
    filePath: string = DEFAULT_DEPLOYMENTS_PATH
): DeploymentsJson {
    if (!fs.existsSync(filePath)) {
        return {
            ...EMPTY_DEPLOYMENTS,
            contracts: {},
        };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed)) return { ...EMPTY_DEPLOYMENTS, contracts: {} };

    const contractsRaw = parsed.contracts;
    const contracts: Record<string, DeploymentContract> = {};
    if (isRecord(contractsRaw)) {
        for (const [key, value] of Object.entries(contractsRaw)) {
            if (!isRecord(value)) continue;
            const contractAddress = value.contractAddress;
            const deployerAddress = value.deployerAddress;
            const deploymentSalt = value.deploymentSalt;
            if (
                typeof contractAddress !== 'string' ||
                typeof deployerAddress !== 'string' ||
                typeof deploymentSalt !== 'string'
            ) {
                continue;
            }
            contracts[key] = {
                contractAddress,
                deployerAddress,
                deploymentSalt,
            };
        }
    }

    return {
        startBlock:
            typeof parsed.startBlock === 'number' ? parsed.startBlock : 0,
        accountAddress:
            typeof parsed.accountAddress === 'string'
                ? parsed.accountAddress
                : '',
        contracts,
    };
}

export function writeDeployments(
    data: DeploymentsJson,
    filePath: string = DEFAULT_DEPLOYMENTS_PATH
): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
