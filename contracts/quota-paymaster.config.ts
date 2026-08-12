/**
 * Operator config module for the quota-paymaster CLI.
 *
 *   pnpm --filter contracts run fpc -- policy --fpc 0x… \
 *     --config-module ./quota-paymaster.config.ts --show
 *
 * The CLI never touches key material: it loads this module, and this module
 * builds the signer the way this repo already does — from ACCOUNT_* in the
 * layered env files. No secrets live here; committing this file is safe.
 */
import {
  DARK_FOREST_REFERENCE_GAS_PROFILE,
} from '@alejoamiras/quota-paymaster';
import {
  defineOperatorConfig,
  schnorrAccountFromEnv,
} from '@alejoamiras/quota-paymaster/operator/config';

import { loadContractsEnv } from './scripts/utils/env.js';

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
  return {
    ...(await account()),
    // This IS the app the reference profile was measured on (mainnet,
    // 2026-08-01); re-measure with `fpc -- measure` when the action mix moves.
    gasProfile: DARK_FOREST_REFERENCE_GAS_PROFILE,
  };
});
