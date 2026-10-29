import {
    createTolerantAztecNodeClient,
    ensureAccountKeysOffline,
    getAztecNodeUrl,
    getProverEnabled,
    loadContractsEnv,
    prepareFeePayment,
    resolveDeployerAccount,
    setupWallet,
} from './scripts/utils/index.ts';
import { buildFeeSendFields } from './scripts/utils/feePayment.ts';

export default async function createDeploymentContext() {
    loadContractsEnv();
    await ensureAccountKeysOffline({
        commandHint: 'pnpm deploy-sponsored-fpc',
    });
    const node = createTolerantAztecNodeClient(getAztecNodeUrl());
    const wallet = await setupWallet(node, {
        storeDir: new URL('./.store-sponsored-fpc', import.meta.url).pathname,
        clearStore: true,
        proverEnabled: getProverEnabled(),
    });
    const feeCtx = await prepareFeePayment(wallet);
    const deployer = await resolveDeployerAccount(wallet, node, {
        mode: 'getOrCreate',
        deployTimeoutMs: 120_000,
        feeCtx,
        commandHint: 'pnpm deploy-sponsored-fpc',
    });
    return { wallet, deployer, sendOptions: buildFeeSendFields(feeCtx) };
}
