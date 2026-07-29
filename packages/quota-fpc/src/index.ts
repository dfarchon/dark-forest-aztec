/**
 * @dfpunk/quota-fpc — client logic for the QuotaFpc paymaster.
 *
 * Browser-safe: no node-only imports. Operator tooling (deploy, calibration)
 * lives in `contracts/scripts`, not here.
 */
export {
  SECONDS_PER_DAY,
  ROLLOVER_GRACE_SECONDS,
  generationAt,
  generationEndsAt,
  millisUntilReset,
  resetLabel,
  sponsorableGenerations,
  isGenerationStale,
} from "./generation.js";

export {
  SEAT_NULLIFIER_SEPARATOR,
  PLAYER_NULLIFIER_SEPARATOR,
  computeSeatNullifier,
  computePlayerNullifier,
} from "./nullifiers.js";

export {
  QuotaUnavailableError,
  reasonFromRevert,
  type QuotaUnavailableReason,
} from "./errors.js";

export { humanizeDuration, resetsIn } from "./duration.js";

export {
  describeQuotaUnavailable,
  describeSponsored,
  flattenQuotaMessage,
  type QuotaAction,
  type QuotaCopyContext,
  type QuotaMessage,
} from "./messages.js";

export {
  assertValidMaxUsers,
  countAvailableSeats,
  findFreeSeat,
  hasSubscribed,
  takenSeats,
  type SeatProbeNode,
  type SeatQuery,
} from "./seat-picker.js";

export {
  ACCOUNT_MAX_CALLS,
  FEE_PAYMENT_EXTERNAL,
  buildSandwichPayload,
  type QuotaFpcMethods,
  type SandwichRequest,
  type SandwichWallet,
} from "./sandwich.js";

export {
  assertNotBlocked,
  awaitAllowanceTransition,
  resolveFeeSource,
  type AllowanceState,
  type FeeSource,
  type FeeSourceInputs,
} from "./allowance.js";
