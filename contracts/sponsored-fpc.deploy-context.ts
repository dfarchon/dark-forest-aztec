import {
    ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS,
    ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS,
    ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS,
    ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS,
    CORE_CONTRACT_ADDRESS,
    MOVE_CONTRACT_ADDRESS,
} from '../packages/contracts/src/index.ts';

import { openDeploySession } from './scripts/deploy/session.ts';
import { buildFeeSendFields } from './scripts/utils/feePayment.ts';

export default async function createDeploymentContext() {
    Object.assign(process.env, {
        CORE_CONTRACT_ADDRESS,
        MOVE_CONTRACT_ADDRESS,
        ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS,
        ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS,
        ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS,
        ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS,
    });
    const session = await openDeploySession({
        commandHint: 'pnpm deploy:sponsored-fpc',
    });
    return {
        wallet: session.wallet,
        deployer: session.deployer,
        sendOptions: buildFeeSendFields(session.feeCtx),
    };
}
