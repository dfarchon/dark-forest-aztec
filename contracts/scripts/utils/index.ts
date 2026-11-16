/**
 * Barrel for script helpers on gasMainRound2.
 *
 * Network config lives in `runtime/env.ts` (`networks/<AZTEC_NETWORK>.env`).
 * There is no dotenv layout here; this file only re-exports gasMain helpers
 * used by `scripts/test/*`.
 */
export {
    DEFAULT_ACCOUNT_MIN_BALANCE_FJ,
    FEE_JUICE_BRIDGE_URL,
    formatFeeJuiceWei,
    parseFjDecimalToWei,
} from './feeJuiceUnits.ts';
export {
    AccountFundingRequiredError,
    assertAccountFeeJuiceReady,
    assertFeePaymentReady,
    buildFeeSendFields,
    buildSendOpts,
    exitIfAccountFundingRequired,
    type FeePaymentContext,
    type FeePaymentMode,
    getAccountMinBalanceFjWei,
    getFeePaymentMode,
    getSponsoredPFCContract,
    prepareFeePayment,
    stopForAccountFunding,
} from './feePayment.ts';
export { createTolerantAztecNodeClient } from './nodeClient.ts';
export {
    deriveSchnorrInitializerlessAddress,
    hasLocalAccount,
    loadAccountFromCredentials,
    setupWallet,
    type SetupWalletOptions,
    type TestAccountCredentials,
} from './wallet.ts';
export { unwrapSimulateResult } from '@dfpunk/utils';
