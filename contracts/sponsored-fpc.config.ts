/**
 * Operator adapter for the external quota-paymaster CLI used to bridge and
 * claim FeeJuice for this project's Sponsored FPC.
 *
 * Used by the local setup script for the CLI's `bridge` and `claim` commands.
 *
 * The CLI never touches key material: it loads this module, and this module
 * builds the signer the way this repo already does — from ACCOUNT_* in the
 * layered env files. No secrets live here; committing this file is safe.
 */
import { DARK_FOREST_REFERENCE_GAS_PROFILE } from '@alejoamiras/quota-paymaster';
import {
    defineOperatorConfig,
    schnorrAccountFromEnv,
} from '@alejoamiras/quota-paymaster/operator/config';

import { loadContractsEnv } from './scripts/utils/env.js';
import {
    buildFeeSendFields,
    prepareFeePayment,
} from './scripts/utils/feePayment.js';

export default defineOperatorConfig(async () => {
    loadContractsEnv({ optional: true } as never);
    // Bridge this repo's env names onto the factory's.
    const account = schnorrAccountFromEnv({
        env: {
            ...process.env,
            NODE_URL: process.env.AZTEC_NODE_URL ?? process.env.NODE_URL,
            L1_RPC_URL: process.env.ETHEREUM_HOST ?? process.env.L1_RPC_URL,
        },
    });
    const context = await account();
    const feeContext = await prepareFeePayment(context.wallet, context.from);
    return {
        ...context,
        sendOptions: buildFeeSendFields(feeContext),
        // This IS the app the reference profile was measured on (mainnet,
        // 2026-08-01); re-measure with `fpc -- measure` when the action mix moves.
        gasProfile: DARK_FOREST_REFERENCE_GAS_PROFILE,
    };
});
