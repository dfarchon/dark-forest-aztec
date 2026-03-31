import type { ExternalWalletConnectionResult } from "../Contexts/ExternalWalletContext";

export interface LoadingPhase {
  step:
    | "connecting"
    | "wallet"
    | "snapshot"
    | "syncing"
    | "contracts"
    | "gamestate"
    | "done";
  detail?: string;
  percent?: number;
  gamestateSubStep?: number;
  gamestateSubStepTotal?: number;
}

export type SelectedWalletMode = "local" | "external" | null;

export type WalletLockState =
  | "unselected"
  | "selected"
  | "in_game"
  | "fatal_session_loss";

export const LOADING_STEP_LABELS: Record<LoadingPhase["step"], string> = {
  connecting: "Connecting to node",
  wallet: "Initializing wallet",
  snapshot: "Downloading snapshot",
  syncing: "Syncing blocks",
  contracts: "Building contracts",
  gamestate: "Loading game data",
  done: "Done",
};

export function getWalletProgressBucket(percent?: number): number | null {
  if (percent == null || Number.isNaN(percent) || percent < 25) {
    return null;
  }
  if (percent >= 100) return 100;
  if (percent >= 75) return 75;
  if (percent >= 50) return 50;
  return 25;
}

export type ExternalWalletSimulationSupport = Pick<
  ExternalWalletConnectionResult,
  | "supportsUtilitySimulation"
  | "supportsTransactionSimulation"
  | "supportsTransactionExecution"
>;

export function describeMissingExternalWalletSupport(
  support: ExternalWalletSimulationSupport
): string | null {
  const missing: string[] = [];
  if (!support.supportsUtilitySimulation) missing.push("utility simulation");
  if (!support.supportsTransactionSimulation) {
    missing.push("transaction simulation");
  }
  if (!support.supportsTransactionExecution) {
    missing.push("transaction execution");
  }
  return missing.length > 0 ? missing.join(" and ") : null;
}

export function formatFeeJuice(amount: bigint): string {
  // FeeJuice uses 18 decimals (ERC20-like).
  const DECIMALS = 18n;
  const BASE = 10n ** DECIMALS;
  const whole = amount / BASE;
  const frac = amount % BASE;
  if (frac === 0n) return `${whole.toString()} FJ`;
  const fracStr = frac.toString().padStart(Number(DECIMALS), "0");
  const trimmed = fracStr.replace(/0+$/, "");
  return `${whole.toString()}.${trimmed} FJ`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export const enum TerminalPromptStep {
  NONE,
  WALLET_MENU,
  LOCAL_ACCOUNT_LIST,
  GENERATE_ACCOUNT,
  IMPORT_ACCOUNT,
  CONNECT_EXTERNAL,
  RECONNECT_EXTERNAL,
  ACCOUNT_SET,
  CHECK_FEE_JUICE,
  FETCHING_ETH_DATA,
  ASK_ADD_ACCOUNT,
  ADD_ACCOUNT,
  NO_HOME_PLANET,
  SEARCHING_FOR_HOME_PLANET,
  ALL_CHECKS_PASS,
  COMPLETE,
  TERMINATED,
  ERROR,
}
