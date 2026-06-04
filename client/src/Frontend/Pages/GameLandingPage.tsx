import { AztecAddress } from "@aztec/aztec.js/addresses";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import type { Aliased } from "@aztec/aztec.js/wallet";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { hashToEmoji } from "@aztec/wallet-sdk/crypto";
import { APP_VERSION, CHAIN_DISPLAY_NAME, GAME_NAME } from "@dfpunk/constants";
import {
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  START_BLOCK,
} from "@dfpunk/contracts";
import { ConfigContract } from "@dfpunk/contracts/artifacts/Config";
import { address } from "@dfpunk/serde";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import styled from "styled-components";

import GameManager, {
  GameManagerEvent,
} from "../../Backend/GameLogic/GameManager";
import GameUIManager from "../../Backend/GameLogic/GameUIManager";
import TutorialManager, {
  TutorialState,
} from "../../Backend/GameLogic/TutorialManager";
import { ChainClock } from "../../Backend/Utils/ChainClock";
import {
  getEffectiveIndexerBootstrapUrl,
  getEffectiveNodeUrl,
  getEffectiveProverUrl,
  getEffectiveSponsoredFpcAddressOverride,
} from "../../config/connection";
import {
  getAccountMinBalanceFjWei,
  getProverEnabled,
  getSponsoredFpcMinBalanceFjWei,
  getSponsorMode,
} from "../../config/env";
import { externalLinks } from "../../config/externalLinks";
import { resolveQuickJoinAccount } from "../../config/quickJoin";
import { makeContractsAPI } from "../../ContractsAPI/ContractsAPI";
import { resolveExternalWalletCapabilities } from "../../Session/ExternalWallet/capabilityValidation";
import type {
  PendingConnection,
  WalletProvider,
} from "../../Session/ExternalWallet/walletService";
import {
  createIndexerConnection,
  IndexerConnection,
  type IndexerConnectionConfig,
} from "../../Session/Indexer/IndexerConnection";
import { ConfigCache } from "../../Session/TxExecutor/ConfigCache";
import { TxExecutor } from "../../Session/TxExecutor/TxExecutor";
import {
  createWalletManager,
  WalletManager,
} from "../../Session/WalletManager";
import { KeyStore } from "../../Session/WalletManager/KeyStore";
import type { SponsorDeployPreflight } from "../../Session/WalletManager/types";
import { formatFeeJuiceWei } from "../../utils/feeJuiceUnits";
import { ConnectionSettingsModal } from "../Components/ConnectionSettingsModal";
import {
  GameWindowWrapper,
  InitRenderState,
  TerminalToggler,
  TerminalWrapper,
  Wrapper,
} from "../Components/GameLandingPageComponents";
import { MythicLabelText } from "../Components/Labels/MythicLabel";
import { QuickJoinSettingsModal } from "../Components/QuickJoinSettingsModal";
import { TextPreview } from "../Components/TextPreview";
import {
  type ExternalWalletConnectionResult,
  RememberedExternalWalletAccountMismatchError,
  useExternalWallet,
} from "../Contexts/ExternalWalletContext";
import dfstyles from "../Styles/dfstyles";
import { TopLevelDivProvider, UIManagerProvider } from "../Utils/AppHooks";
import { Incompatibility, unsupportedFeatures } from "../Utils/BrowserChecks";
import { TerminalTextStyle } from "../Utils/TerminalTypes";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";
import { GameWindowLayout } from "../Views/GameWindowLayout";
import {
  Terminal,
  TerminalHandle,
  type TerminalOptionMode,
} from "../Views/Terminal";
import {
  type EntryModeChoice,
  GameLandingEntryOverlay,
} from "./GameLandingEntryOverlay";

function formatFeeJuice(amount: bigint): string {
  return formatFeeJuiceWei(amount);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function CopyAccountAddressButton({
  accountAddress,
}: {
  accountAddress: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );

  const copyAddress = async () => {
    try {
      await window.navigator.clipboard.writeText(accountAddress);
      setCopyState("copied");
    } catch (err) {
      console.error("Failed to copy account address:", err);
      setCopyState("failed");
    }
  };

  return (
    <CopyAccountAddressRow>
      <CopyAccountAddressButtonElement type="button" onClick={copyAddress}>
        Copy account address
      </CopyAccountAddressButtonElement>
      {copyState === "copied" && (
        <CopyAccountAddressStatus>Copied.</CopyAccountAddressStatus>
      )}
      {copyState === "failed" && (
        <CopyAccountAddressStatus>
          Failed to copy. Select the address above manually.
        </CopyAccountAddressStatus>
      )}
    </CopyAccountAddressRow>
  );
}

function printSponsorDeployPreflight(
  terminal: React.MutableRefObject<TerminalHandle | undefined>,
  sponsoredAddr: { toString: () => string },
  pf: SponsorDeployPreflight
): void {
  terminal.current?.println("");
  terminal.current?.println(
    `SponsoredFPC address: ${sponsoredAddr.toString()}`,
    TerminalTextStyle.Sub
  );
  terminal.current?.println(
    `SponsoredFPC FeeJuice balance: ${formatFeeJuiceWei(pf.balanceWei)}`,
    TerminalTextStyle.Sub
  );
  terminal.current?.println(
    `Minimum required (preflight): ${formatFeeJuiceWei(pf.requiredWei)} [source: ${pf.estimateSource}]`,
    TerminalTextStyle.Sub
  );
}

async function resolveInitialSponsoredFpcAddress(): Promise<AztecAddress> {
  const override = getEffectiveSponsoredFpcAddressOverride();
  if (override) return AztecAddress.fromString(override);

  const instance = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
  return instance.address;
}

async function printInitialSponsorStatus(
  terminal: React.MutableRefObject<TerminalHandle | undefined>
): Promise<void> {
  terminal.current?.println("Sponsor mode enabled.", TerminalTextStyle.Green);
  try {
    const sponsoredAddr = await resolveInitialSponsoredFpcAddress();
    const node = createAztecNodeClient(getEffectiveNodeUrl());
    const balanceWei = await getFeeJuiceBalance(sponsoredAddr, node);
    const minWei = getSponsoredFpcMinBalanceFjWei();

    terminal.current?.println(
      `SponsoredFPC address: ${sponsoredAddr.toString()}`,
      TerminalTextStyle.Sub
    );
    terminal.current?.println(
      `SponsoredFPC FeeJuice balance: ${formatFeeJuiceWei(balanceWei)}`,
      TerminalTextStyle.Sub
    );
    terminal.current?.println(
      `Minimum required (preflight): ${formatFeeJuiceWei(minWei)}`,
      TerminalTextStyle.Sub
    );
    if (balanceWei < minWei) {
      terminal.current?.println(
        "SponsoredFPC balance is too low. Fund this contract or set a funded SponsoredFPC address in Connection settings before continuing.",
        TerminalTextStyle.Red
      );
    }
  } catch (err) {
    console.error("Failed to print initial SponsoredFPC status:", err);
    terminal.current?.println(
      "Could not read SponsoredFPC status. Check Connection settings and the Aztec node URL before continuing.",
      TerminalTextStyle.Red
    );
  }
  terminal.current?.println("");
}

function isInsufficientSponsoredFeeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Insufficient fee payer balance") ||
    msg.includes("insufficient fee payer balance") ||
    msg.includes("SponsoredFPC fee payer balance too low")
  );
}

function printSponsorRecoveryMenu(
  terminal: React.MutableRefObject<TerminalHandle | undefined>,
  setConnectionSettingsOpen: (open: boolean) => void
): void {
  terminal.current?.println(
    "After funding or changing SponsoredFPC in Connection settings, choose an action below.",
    TerminalTextStyle.Sub
  );
  terminal.current?.printLink(
    "Open connection settings",
    () => setConnectionSettingsOpen(true),
    TerminalTextStyle.Blue
  );
  terminal.current?.newline();
  terminal.current?.printOption("c", "Continue after updating SponsoredFPC", {
    hideKey: true,
  });
  terminal.current?.printOption("r", "Refresh page", { hideKey: true });
}

type SponsorPreflightPurpose = "deploy" | "transactions";

/**
 * Sponsor-mode infrastructure check with recovery: rebuild WalletManager after
 * Connection settings changes, or full page reload.
 */
async function runSponsorInfrastructurePreflightGate(params: {
  terminal: React.MutableRefObject<TerminalHandle | undefined>;
  getWalletManager: () => WalletManager | undefined;
  purpose: SponsorPreflightPurpose;
  setConnectionSettingsOpen: (open: boolean) => void;
  setTerminalVisible: (visible: boolean) => void;
  /** Landing entry mode (`terminal` is treated like standard for visibility). */
  entryMode: "pending" | "quick" | "standard" | "terminal";
  rebuildWalletAfterConnectionSave: () => Promise<void>;
  onRefreshPage: () => Promise<void>;
}): Promise<void> {
  const {
    terminal,
    getWalletManager,
    purpose,
    setConnectionSettingsOpen,
    setTerminalVisible,
    entryMode,
    rebuildWalletAfterConnectionSave,
    onRefreshPage,
  } = params;

  if (entryMode === "quick") {
    setTerminalVisible(true);
  }

  while (true) {
    const wm = getWalletManager();
    if (!wm) {
      terminal.current?.println(
        "Wallet manager is unavailable. Choose Continue to retry after checking Connection settings, or refresh the page.",
        TerminalTextStyle.Red
      );
      printSponsorRecoveryMenu(terminal, setConnectionSettingsOpen);
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return;
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
      }
      continue;
    }

    const sponsoredAddr = wm.getSponsoredFpcAddress();
    if (!sponsoredAddr) {
      terminal.current?.println(
        wm.isExternalWallet()
          ? "Sponsor mode is on but SponsoredFPC could not be registered on the extension wallet. Check Connection settings and the Aztec node URL."
          : "Sponsor mode is on but SponsoredFPC could not be registered. Check Connection settings and the Aztec node URL.",
        TerminalTextStyle.Red
      );
      printSponsorRecoveryMenu(terminal, setConnectionSettingsOpen);
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return;
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
      }
      continue;
    }

    const pf = await wm.getSponsorDeployPreflight();
    if (!pf) {
      terminal.current?.println(
        "Could not read SponsoredFPC FeeJuice balance. Check the Aztec node URL and SponsoredFPC address in Connection settings.",
        TerminalTextStyle.Red
      );
      printSponsorRecoveryMenu(terminal, setConnectionSettingsOpen);
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return;
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
      }
      continue;
    }

    printSponsorDeployPreflight(terminal, sponsoredAddr, pf);

    if (pf.sufficient) return;

    terminal.current?.println(
      purpose === "transactions"
        ? "SponsoredFPC balance is too low for sponsored transactions. Fund this contract or set a funded SponsoredFPC address in Connection settings."
        : "SponsoredFPC balance is too low for account deployment. Fund this contract or set a funded SponsoredFPC address in Connection settings.",
      TerminalTextStyle.Red
    );
    printSponsorRecoveryMenu(terminal, setConnectionSettingsOpen);
    const input = (await terminal.current?.getInput()) || "";
    if (input === "r") {
      await onRefreshPage();
      return;
    }
    if (input === "c") {
      try {
        await rebuildWalletAfterConnectionSave();
      } catch (e) {
        terminal.current?.println(
          e instanceof Error ? e.message : String(e),
          TerminalTextStyle.Red
        );
      }
    }
  }
}

async function deployActiveAccountWithSponsorRecovery(params: {
  terminal: React.MutableRefObject<TerminalHandle | undefined>;
  getWalletManager: () => WalletManager | undefined;
  setConnectionSettingsOpen: (open: boolean) => void;
  rebuildWalletAfterConnectionSave: () => Promise<void>;
  onRefreshPage: () => Promise<void>;
}): Promise<void> {
  const {
    terminal,
    getWalletManager,
    setConnectionSettingsOpen,
    rebuildWalletAfterConnectionSave,
    onRefreshPage,
  } = params;

  while (true) {
    const wm = getWalletManager();
    if (!wm) throw new Error("no wallet manager");
    try {
      await wm.deployActiveAccountIfNeeded((msg) =>
        terminal.current?.println(msg, TerminalTextStyle.Sub)
      );
      return;
    } catch (err) {
      if (!isInsufficientSponsoredFeeError(err)) throw err;
      terminal.current?.println(
        err instanceof Error ? err.message : String(err),
        TerminalTextStyle.Red
      );
      printSponsorRecoveryMenu(terminal, setConnectionSettingsOpen);
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return;
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
      }
    }
  }
}

/**
 * Print recovery options when the account FeeJuice query fails or the user must
 * update connection settings.
 */
function printAccountFeeJuiceRecoveryMenu(
  terminal: React.MutableRefObject<TerminalHandle | undefined>,
  setConnectionSettingsOpen: (open: boolean) => void,
  useCompactOptions: boolean
): void {
  terminal.current?.println(
    "Check Connection settings (Aztec node URL), fund FeeJuice, then retry.",
    TerminalTextStyle.Sub
  );
  terminal.current?.printLink(
    "Open connection settings",
    () => setConnectionSettingsOpen(true),
    TerminalTextStyle.Blue
  );
  terminal.current?.newline();
  if (useCompactOptions) {
    terminal.current?.printOption("b", "Retry balance query", {
      hideKey: true,
    });
    terminal.current?.printOption("c", "Continue after updating connection", {
      hideKey: true,
    });
    terminal.current?.printOption("r", "Refresh page", { hideKey: true });
  } else {
    terminal.current?.printOption("b", "Retry balance query");
    terminal.current?.printOption("c", "Continue after updating connection");
    terminal.current?.printOption("r", "Refresh page");
  }
}

/** Non-sponsored mode: ensure active account has enough FeeJuice before continuing. */
async function runAccountFeeJuicePreflightGate(params: {
  terminal: React.MutableRefObject<TerminalHandle | undefined>;
  getWalletManager: () => WalletManager | undefined;
  setConnectionSettingsOpen: (open: boolean) => void;
  setTerminalVisible: (visible: boolean) => void;
  entryMode: "pending" | "quick" | "standard" | "terminal";
  rebuildWalletAfterConnectionSave: () => Promise<void>;
  onRefreshPage: () => Promise<void>;
}): Promise<void> {
  const {
    terminal,
    getWalletManager,
    setConnectionSettingsOpen,
    setTerminalVisible,
    entryMode,
    rebuildWalletAfterConnectionSave,
    onRefreshPage,
  } = params;

  const minWei = getAccountMinBalanceFjWei();
  const useCompactOptions = entryMode !== "terminal";

  if (entryMode === "quick") {
    setTerminalVisible(true);
  }

  async function queryFreshBalance(
    wm: WalletManager
  ): Promise<{ ok: true; balance: bigint } | { ok: false; error: unknown }> {
    const addr = wm.getActiveAddress();
    if (!addr) return { ok: false, error: new Error("No active account") };
    try {
      const node = createAztecNodeClient(getEffectiveNodeUrl());
      const balance = await getFeeJuiceBalance(addr, node);
      await wm.getBalance();
      return { ok: true, balance };
    } catch (error) {
      return { ok: false, error };
    }
  }

  outer: while (true) {
    const wm = getWalletManager();
    if (!wm) {
      terminal.current?.println(
        "Wallet manager is unavailable. Choose Continue after Connection settings, or refresh the page.",
        TerminalTextStyle.Red
      );
      printAccountFeeJuiceRecoveryMenu(
        terminal,
        setConnectionSettingsOpen,
        useCompactOptions
      );
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return;
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
      }
      continue;
    }

    const initial = await queryFreshBalance(wm);
    if (!initial.ok) {
      console.error("Account FeeJuice query failed:", initial.error);
      terminal.current?.println(
        "Could not read your FeeJuice balance. Check the Aztec node URL in Connection settings.",
        TerminalTextStyle.Red
      );
      printAccountFeeJuiceRecoveryMenu(
        terminal,
        setConnectionSettingsOpen,
        useCompactOptions
      );
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return;
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
      }
      continue;
    }

    if (initial.balance >= minWei) {
      terminal.current?.println(
        `FeeJuice OK (${formatFeeJuiceWei(initial.balance)} ≥ minimum ${formatFeeJuiceWei(minWei)}).`,
        TerminalTextStyle.Green
      );
      return;
    }

    terminal.current?.println("");
    terminal.current?.println(
      "⚠ FeeJuice is required to continue.",
      TerminalTextStyle.Yellow
    );
    terminal.current?.println(
      `Minimum required: ${formatFeeJuiceWei(minWei)}. Current: ${formatFeeJuiceWei(initial.balance)}.`,
      TerminalTextStyle.Subber
    );
    terminal.current?.println(
      "Bridge FeeJuice on Aztec (e.g. gregojuice), then confirm your balance here.",
      TerminalTextStyle.Subber
    );
    terminal.current?.println("");

    const activeAddress = wm.getActiveAddress();
    if (activeAddress) {
      terminal.current?.printElement(
        <CopyAccountAddressButton accountAddress={activeAddress.toString()} />
      );
      terminal.current?.newline();
    }

    let opened = false;
    terminal.current?.printLink(
      "↗ Open gregojuice faucet",
      () => {
        if (!opened) opened = true;
        window.open(
          externalLinks.aztecTestnet.feeJuiceBridge,
          "_blank",
          "noopener,noreferrer"
        );
      },
      TerminalTextStyle.Blue
    );
    terminal.current?.newline();
    terminal.current?.println(
      useCompactOptions
        ? "Use ⟳ refresh on the balance line, or wait a few seconds for auto-refresh."
        : "Click the link above to open the faucet, use ⟳ refresh on the balance line, or wait for auto-refresh.",
      TerminalTextStyle.Sub
    );

    let bal = initial.balance;
    let balanceLinePrinted = false;
    let requeryInFlight = false;
    const BALANCE_LINE_FRAGMENTS = 3;

    const printBalanceLine = (
      valueText: string,
      refreshState: "ready" | "loading",
      loadingIcon = "⟳"
    ) => {
      terminal.current?.print(`FeeJuice balance: ${valueText} `);
      if (refreshState === "loading") {
        terminal.current?.print(
          `${loadingIcon} refreshing...`,
          TerminalTextStyle.Sub
        );
      } else {
        terminal.current?.printLink(
          "⟳ refresh",
          () => {
            void runRequerySpinner().catch(() => {});
          },
          TerminalTextStyle.Blue
        );
      }
      terminal.current?.newline();
    };

    async function promptAfterFailedBalanceQuery(
      context: string
    ): Promise<"restart_outer" | "retry_inner" | "exit"> {
      console.error(context);
      terminal.current?.println(
        "Could not read FeeJuice balance. Check Connection settings or retry.",
        TerminalTextStyle.Red
      );
      printAccountFeeJuiceRecoveryMenu(
        terminal,
        setConnectionSettingsOpen,
        useCompactOptions
      );
      const input = (await terminal.current?.getInput()) || "";
      if (input === "r") {
        await onRefreshPage();
        return "exit";
      }
      if (input === "c") {
        try {
          await rebuildWalletAfterConnectionSave();
        } catch (e) {
          terminal.current?.println(
            e instanceof Error ? e.message : String(e),
            TerminalTextStyle.Red
          );
        }
        return "restart_outer";
      }
      if (input === "b") return "retry_inner";
      return "restart_outer";
    }

    const runRequerySpinner = async (): Promise<
      { ok: true; balance: bigint } | { ok: false }
    > => {
      if (requeryInFlight) {
        return { ok: true, balance: bal };
      }
      requeryInFlight = true;
      let spinnerInterval: ReturnType<typeof setInterval> | undefined;
      try {
        if (balanceLinePrinted) {
          terminal.current?.removeLast(BALANCE_LINE_FRAGMENTS);
        }
        const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
        let spinnerIndex = 0;
        printBalanceLine("...", "loading", SPINNER_FRAMES[spinnerIndex]);
        balanceLinePrinted = true;
        spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;

        spinnerInterval = setInterval(() => {
          if (!terminal.current) return;
          terminal.current.removeLast(BALANCE_LINE_FRAGMENTS);
          printBalanceLine("...", "loading", SPINNER_FRAMES[spinnerIndex]);
          spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
        }, 120);

        const nextQuery = await queryFreshBalance(wm);
        if (!nextQuery.ok) {
          return { ok: false };
        }

        await sleep(1500);

        if (balanceLinePrinted) {
          terminal.current?.removeLast(BALANCE_LINE_FRAGMENTS);
        }
        printBalanceLine(formatFeeJuiceWei(nextQuery.balance), "ready");
        balanceLinePrinted = true;
        return { ok: true, balance: nextQuery.balance };
      } catch (err) {
        console.error("FeeJuice balance refresh failed:", err);
        if (balanceLinePrinted && terminal.current) {
          terminal.current.removeLast(BALANCE_LINE_FRAGMENTS);
          balanceLinePrinted = false;
        }
        return { ok: false };
      } finally {
        if (spinnerInterval) clearInterval(spinnerInterval);
        requeryInFlight = false;
      }
    };

    inner: while (bal < minWei) {
      const rq = await runRequerySpinner();
      if (!rq.ok) {
        const recovery = await promptAfterFailedBalanceQuery(
          "Account FeeJuice query failed during refresh."
        );
        if (recovery === "exit") return;
        if (recovery === "restart_outer") continue outer;
        continue inner;
      }

      bal = rq.balance;
      if (bal >= minWei) {
        terminal.current?.println(
          `FeeJuice OK (${formatFeeJuiceWei(bal)} ≥ minimum ${formatFeeJuiceWei(minWei)}).`,
          TerminalTextStyle.Green
        );
        return;
      }

      await sleep(8000);
    }
  }
}

/** Full-screen enter effect for Quick play (matches LandingPage enter duration). */
const QUICK_PLAY_ENTER_TRANSITION_MS = 1100;
const REFRESH_PAGE_TRANSITION_MS = 1100;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

interface LoadingPhase {
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
  activeEntity?: string;
  activeEntityPercent?: number;
}

type SelectedWalletMode = "local" | "external" | null;

type EntryMode = "pending" | "quick" | "standard" | "terminal";

type WalletLockState =
  | "unselected"
  | "selected"
  | "in_game"
  | "fatal_session_loss";

const LOADING_STEP_LABELS: Record<LoadingPhase["step"], string> = {
  connecting: "Connecting to node",
  wallet: "Initializing wallet",
  snapshot: "Downloading snapshot",
  syncing: "Syncing blocks",
  contracts: "Building contracts",
  gamestate: "Loading game data",
  done: "Done",
};

function getWalletProgressBucket(percent?: number): number | null {
  if (percent == null || Number.isNaN(percent) || percent < 25) {
    return null;
  }
  if (percent >= 100) return 100;
  if (percent >= 75) return 75;
  if (percent >= 50) return 50;
  return 25;
}

function getNormalizedProgressBucket(percent?: number): number | null {
  if (percent == null || Number.isNaN(percent)) return null;
  const normalizedPercent = percent <= 1 ? percent * 100 : percent;
  if (normalizedPercent < 25) return null;
  if (normalizedPercent >= 100) return 100;
  if (normalizedPercent >= 75) return 75;
  if (normalizedPercent >= 50) return 50;
  return 25;
}

function formatElapsedSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatLoadingPercent(
  percent?: number,
  options?: { fraction?: boolean }
): string | null {
  if (percent == null || Number.isNaN(percent)) return null;
  const normalizedPercent = options?.fraction ? percent * 100 : percent;
  return `${Math.max(0, Math.min(100, Math.floor(normalizedPercent)))}%`;
}

function StartupLoadingStatus({
  loadingPhase,
  elapsedSeconds,
}: {
  loadingPhase: LoadingPhase;
  elapsedSeconds: number;
}) {
  if (loadingPhase.step === "done") return null;

  const phasePercent = formatLoadingPercent(loadingPhase.percent);
  const entityPercent = formatLoadingPercent(loadingPhase.activeEntityPercent, {
    fraction: true,
  });
  const gameStateStep =
    loadingPhase.gamestateSubStep != null &&
    loadingPhase.gamestateSubStepTotal != null
      ? `${loadingPhase.gamestateSubStep}/${loadingPhase.gamestateSubStepTotal}`
      : null;

  return (
    <StartupStatusBar aria-live="polite">
      <StartupStatusHeader>
        <span>{LOADING_STEP_LABELS[loadingPhase.step]}</span>
        <strong>{formatElapsedSeconds(elapsedSeconds)}</strong>
      </StartupStatusHeader>
      <StartupStatusDetail>
        {gameStateStep && <span>Step {gameStateStep}</span>}
        {loadingPhase.detail && <span>{loadingPhase.detail}</span>}
        {phasePercent && <span>{phasePercent}</span>}
      </StartupStatusDetail>
      {loadingPhase.activeEntity && (
        <StartupStatusDetail>
          <span>Querying {loadingPhase.activeEntity}</span>
          {entityPercent && <span>{entityPercent}</span>}
        </StartupStatusDetail>
      )}
    </StartupStatusBar>
  );
}

type ExternalWalletSimulationSupport = Pick<
  ExternalWalletConnectionResult,
  | "supportsUtilitySimulation"
  | "supportsTransactionSimulation"
  | "supportsTransactionExecution"
>;

function describeMissingExternalWalletSupport(
  support: ExternalWalletSimulationSupport
): string | null {
  const missing: string[] = [];
  if (!support.supportsUtilitySimulation) missing.push("utility simulation");
  if (!support.supportsTransactionSimulation)
    missing.push("transaction simulation");
  if (!support.supportsTransactionExecution)
    missing.push("transaction execution");
  return missing.length > 0 ? missing.join(" and ") : null;
}

function BlockSyncStatus({ connection }: { connection: IndexerConnection }) {
  const [blockNum, setBlockNum] = useState<number>(
    connection.getCurrentBlockNumber()
  );

  useEffect(() => {
    const sub = connection.blockNumber$.subscribe((n) => setBlockNum(n));
    return () => sub.unsubscribe();
  }, [connection]);

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid #333",
        padding: "4px 8px",
        fontSize: "11px",
        fontFamily: "monospace",
        color: "#666",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <span style={{ color: "#5b5" }}>●</span>
      Block {blockNum}
    </div>
  );
}

const enum TerminalPromptStep {
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

export function GameLandingPage() {
  const { contract } = useParams<{ contract: string }>();
  const {
    discoverWallets,
    initiateConnection,
    confirmConnection,
    cancelConnection,
    connectWallet,
    releaseWalletSession,
    getRememberedSession,
    rememberSession,
    reconnectRememberedWallet,
    onWalletSessionLost,
  } = useExternalWallet();
  const terminalHandle = useRef<TerminalHandle | undefined>(undefined);
  const gameUIManagerRef = useRef<GameUIManager | undefined>(undefined);
  const topLevelContainer = useRef<HTMLDivElement | null>(null);
  const walletManagerRef = useRef<WalletManager | undefined>(undefined);

  const [gameManager, setGameManager] = useState<GameManager | undefined>();
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [universeView, setUniverseView] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("pending");
  const [walletModeUi, setWalletModeUi] = useState<SelectedWalletMode>(null);
  const [initRenderState, setInitRenderState] = useState(InitRenderState.NONE);
  const indexerRef = useRef<IndexerConnection | undefined>(undefined);
  const initialSyncDoneRef = useRef(false);
  const externalModeBannerPrintedRef = useRef(false);
  const walletLockMessagePrintedRef = useRef(false);
  const fatalWalletSessionPrintedRef = useRef(false);
  const lastLoggedLoadingStepRef = useRef<LoadingPhase["step"] | null>(null);
  const lastLoggedWalletProgressBucketRef = useRef<number | null>(null);
  const connectingStagePrintedRef = useRef(false);
  const snapshotParsingPrintedRef = useRef(false);
  const snapshotCompletePrintedRef = useRef(false);
  const syncStartPrintedRef = useRef(false);
  const chainClockSyncPrintedRef = useRef(false);
  const lastLoggedGamestateSubStepRef = useRef<string | null>(null);
  const lastLoggedGamestateEntityProgressRef = useRef<Record<string, number>>(
    {}
  );
  const walletMenuSponsorStatusPrintedRef = useRef(false);
  const externalWalletSimulationSupportRef =
    useRef<ExternalWalletSimulationSupport | null>(null);
  const selectedWalletModeRef = useRef<SelectedWalletMode>(null);
  const walletLockStateRef = useRef<WalletLockState>("unselected");
  const entryModeRef = useRef<EntryMode>("pending");
  const skipTerminalPromptsRef = useRef(false);
  const quickBootstrapDoneRef = useRef(false);
  const quickBootstrapEffectGenRef = useRef(0);
  const quickEnterTimeoutRef = useRef<number | null>(null);
  const quickEnterFinalizeScheduledRef = useRef(false);
  const [enterTransitionVisible, setEnterTransitionVisible] = useState(false);
  const [refreshTransitionVisible, setRefreshTransitionVisible] =
    useState(false);
  const [connectionSettingsOpen, setConnectionSettingsOpen] = useState(false);
  const [quickJoinSettingsOpen, setQuickJoinSettingsOpen] = useState(false);
  const [localAccountCount, setLocalAccountCount] = useState(
    () => new KeyStore("dfpunk").listAccounts().length
  );
  const [step, setStep] = useState(TerminalPromptStep.NONE);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>({
    step: "done",
  });
  const loadingPhaseStartedAtRef = useRef(Date.now());
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  const contractAddress = contract
    ? address(contract)
    : address(CORE_CONTRACT_ADDRESS);
  const isLobby = contractAddress !== address(CORE_CONTRACT_ADDRESS);

  const sponsorMode = getSponsorMode();

  useEffect(() => {
    loadingPhaseStartedAtRef.current = Date.now();
    setLoadingElapsedSeconds(0);

    if (loadingPhase.step === "done") {
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingElapsedSeconds(
        Math.floor((Date.now() - loadingPhaseStartedAtRef.current) / 1000)
      );
    }, 1000);

    return () => window.clearInterval(interval);
  }, [loadingPhase.step]);

  useEffect(() => {
    entryModeRef.current = entryMode;
  }, [entryMode]);

  useEffect(() => {
    return () => {
      if (quickEnterTimeoutRef.current !== null) {
        window.clearTimeout(quickEnterTimeoutRef.current);
      }
    };
  }, []);

  const refreshLocalAccountCount = useCallback(() => {
    setLocalAccountCount(new KeyStore("dfpunk").listAccounts().length);
  }, []);

  const playRefreshPageTransition = useCallback(async () => {
    setRefreshTransitionVisible(true);
    await sleep(REFRESH_PAGE_TRANSITION_MS);
    window.location.reload();
  }, []);

  const printInitializationStage = useCallback(
    (step: Exclude<LoadingPhase["step"], "done">) => {
      terminalHandle.current?.println(
        `${LOADING_STEP_LABELS[step]}...`,
        TerminalTextStyle.Text
      );
    },
    []
  );

  const printInitializationMilestone = useCallback((message: string) => {
    terminalHandle.current?.println(message, TerminalTextStyle.Sub);
  }, []);

  const resetInitializationTerminalLogging = useCallback(() => {
    lastLoggedLoadingStepRef.current = null;
    lastLoggedWalletProgressBucketRef.current = null;
    connectingStagePrintedRef.current = false;
    snapshotParsingPrintedRef.current = false;
    snapshotCompletePrintedRef.current = false;
    syncStartPrintedRef.current = false;
    chainClockSyncPrintedRef.current = false;
    lastLoggedGamestateSubStepRef.current = null;
    lastLoggedGamestateEntityProgressRef.current = {};
  }, []);

  const isWalletSelectionLocked = useCallback(
    () => walletLockStateRef.current !== "unselected",
    []
  );

  const destroyTransientWalletManager = useCallback(() => {
    if (walletLockStateRef.current !== "unselected") return;
    walletManagerRef.current?.destroy();
    walletManagerRef.current = undefined;
    externalModeBannerPrintedRef.current = false;
  }, []);

  const clearUnlockedWalletState = useCallback(async () => {
    if (walletLockStateRef.current !== "unselected") return;
    destroyTransientWalletManager();
    externalWalletSimulationSupportRef.current = null;
    resetInitializationTerminalLogging();
    await releaseWalletSession();
    setLoadingPhase({ step: "done" });
  }, [
    destroyTransientWalletManager,
    releaseWalletSession,
    resetInitializationTerminalLogging,
  ]);

  const resetToWalletSelectionMenu = useCallback(async () => {
    await clearUnlockedWalletState();
    selectedWalletModeRef.current = null;
    setWalletModeUi(null);
    setStep(TerminalPromptStep.WALLET_MENU);
  }, [clearUnlockedWalletState]);

  const selectWalletMode = useCallback(
    async (mode: Exclude<SelectedWalletMode, null>) => {
      await clearUnlockedWalletState();
      selectedWalletModeRef.current = mode;
      setWalletModeUi(mode);
    },
    [clearUnlockedWalletState]
  );

  const lockWalletSelection = useCallback(
    (mode: Exclude<SelectedWalletMode, null>) => {
      selectedWalletModeRef.current = mode;
      if (walletLockStateRef.current === "unselected") {
        walletLockStateRef.current = "selected";
      }
    },
    []
  );

  const markWalletSelectionInGame = useCallback(() => {
    if (walletLockStateRef.current === "selected") {
      walletLockStateRef.current = "in_game";
    }
  }, []);

  const enterFatalWalletSessionLoss = useCallback(
    (message: string) => {
      if (walletLockStateRef.current === "fatal_session_loss") return;

      walletLockStateRef.current = "fatal_session_loss";
      externalWalletSimulationSupportRef.current = null;
      resetInitializationTerminalLogging();
      setLoadingPhase({ step: "done" });
      setTerminalVisible(true);
      setStep(TerminalPromptStep.ERROR);

      gameUIManagerRef.current?.destroy();
      gameUIManagerRef.current = undefined;
      walletManagerRef.current?.destroy();
      walletManagerRef.current = undefined;
      indexerRef.current?.destroy();
      indexerRef.current = undefined;
      setGameManager(undefined);

      if (!fatalWalletSessionPrintedRef.current) {
        terminalHandle.current?.println("");
        terminalHandle.current?.println(
          "Wallet session lost.",
          TerminalTextStyle.Red
        );
        terminalHandle.current?.println(message, TerminalTextStyle.Red);
        terminalHandle.current?.println(
          "Refresh the page to continue.",
          TerminalTextStyle.Red
        );
        fatalWalletSessionPrintedRef.current = true;
      }
    },
    [resetInitializationTerminalLogging]
  );

  const buildWalletConfig = useCallback(
    () => ({
      nodeUrl: getEffectiveNodeUrl(),
      storagePrefix: "dfpunk",
      proverUrl: getEffectiveProverUrl(),
      sponsorMode,
      sponsoredFpcAddressOverride: getEffectiveSponsoredFpcAddressOverride(),
      pxeConfig: {
        proverEnabled: getProverEnabled(),
      },
      onWalletProgress: (current: number, total: number, message: string) => {
        setLoadingPhase({
          step: "wallet",
          detail: `${message} (${current}/${total})`,
          percent: Math.round((current / total) * 100),
        });
      },
    }),
    [sponsorMode]
  );

  const ensureEmbeddedWalletManager = useCallback(async () => {
    if (selectedWalletModeRef.current === "external") {
      throw new Error(
        "Extension wallet mode is selected for this session. Refresh the page to use a local wallet."
      );
    }

    if (walletManagerRef.current) {
      return walletManagerRef.current;
    }

    resetInitializationTerminalLogging();
    externalWalletSimulationSupportRef.current = null;
    setLoadingPhase({ step: "wallet" });
    try {
      const wm = await createWalletManager(buildWalletConfig());
      walletManagerRef.current = wm;
      setLoadingPhase({ step: "done" });
      refreshLocalAccountCount();
      return wm;
    } catch (err) {
      setLoadingPhase({ step: "done" });
      throw err;
    }
  }, [
    buildWalletConfig,
    refreshLocalAccountCount,
    resetInitializationTerminalLogging,
  ]);

  const initializeExternalWalletManager = useCallback(
    async (result: ExternalWalletConnectionResult) => {
      if (selectedWalletModeRef.current !== "external") {
        throw new Error(
          "Extension wallet mode is not selected for this session."
        );
      }

      resetInitializationTerminalLogging();
      setLoadingPhase({ step: "wallet" });
      try {
        const missingSupport = describeMissingExternalWalletSupport(result);
        if (missingSupport) {
          throw new Error(
            `External wallet session is missing required ${missingSupport} permission${
              missingSupport.includes(" and ") ? "s" : ""
            }. Reconnect and approve the requested permissions.`
          );
        }

        const wm = await WalletManager.createFromExternalWallet(
          result.wallet,
          buildWalletConfig(),
          result.address
        );
        walletManagerRef.current = wm;
        externalWalletSimulationSupportRef.current = {
          supportsUtilitySimulation: result.supportsUtilitySimulation,
          supportsTransactionSimulation: result.supportsTransactionSimulation,
          supportsTransactionExecution: result.supportsTransactionExecution,
        };
        connectWallet(result.wallet, result.address);
        rememberSession(result.descriptor);
        lockWalletSelection("external");
        setLoadingPhase({ step: "done" });
        return wm;
      } catch (err) {
        externalWalletSimulationSupportRef.current = null;
        setLoadingPhase({ step: "done" });
        await releaseWalletSession();
        throw err;
      }
    },
    [
      buildWalletConfig,
      connectWallet,
      lockWalletSelection,
      releaseWalletSession,
      rememberSession,
      resetInitializationTerminalLogging,
    ]
  );

  /**
   * Destroy and recreate WalletManager so sponsor Connection settings overrides
   * (node URL, SponsoredFPC address) take effect without a full page reload.
   */
  const rebuildWalletAfterConnectionSave = useCallback(async () => {
    const prev = walletManagerRef.current;
    const activeStr = prev?.getActiveAddress()?.toString();
    if (!activeStr) {
      throw new Error("No active account to restore after connection change.");
    }
    const mode = selectedWalletModeRef.current;
    prev?.destroy();
    walletManagerRef.current = undefined;
    externalWalletSimulationSupportRef.current = null;

    if (mode === "local") {
      const next = await ensureEmbeddedWalletManager();
      await next.switchAccount(activeStr, () => {});
      return;
    }
    if (mode === "external") {
      const result = await reconnectRememberedWallet();
      await initializeExternalWalletManager(result);
      return;
    }
    throw new Error("Wallet mode is not selected.");
  }, [
    ensureEmbeddedWalletManager,
    initializeExternalWalletManager,
    reconnectRememberedWallet,
  ]);

  useEffect(() => {
    if (entryMode !== "quick") return;

    quickBootstrapEffectGenRef.current += 1;
    const generation = quickBootstrapEffectGenRef.current;

    void (async () => {
      try {
        const issues = await unsupportedFeatures();
        if (generation !== quickBootstrapEffectGenRef.current) return;

        if (issues.includes(Incompatibility.MobileOrTablet)) {
          terminalHandle.current?.println(
            "ERROR: Mobile or tablet device detected. Please use desktop.",
            TerminalTextStyle.Red
          );
        }

        if (issues.includes(Incompatibility.NoIDB)) {
          terminalHandle.current?.println(
            "ERROR: IndexedDB not found. Try using a different browser.",
            TerminalTextStyle.Red
          );
        }

        if (issues.includes(Incompatibility.UnsupportedBrowser)) {
          terminalHandle.current?.println(
            "ERROR: Browser unsupported. Try Brave, Firefox, or Chrome.",
            TerminalTextStyle.Red
          );
        }

        if (issues.length > 0) {
          const count = issues.length;
          terminalHandle.current?.print(
            `${count} ${count === 1 ? "error" : "errors"} found. `,
            TerminalTextStyle.Red
          );
          terminalHandle.current?.println(
            count === 1
              ? "Please resolve it and refresh the page."
              : "Please resolve them and refresh the page."
          );
          if (generation !== quickBootstrapEffectGenRef.current) return;
          quickBootstrapDoneRef.current = true;
          setTerminalVisible(true);
          setStep(TerminalPromptStep.TERMINATED);
          return;
        }

        skipTerminalPromptsRef.current = true;
        await selectWalletMode("local");
        if (generation !== quickBootstrapEffectGenRef.current) return;
        await ensureEmbeddedWalletManager();
        if (generation !== quickBootstrapEffectGenRef.current) return;
        const wm = walletManagerRef.current;
        if (!wm) {
          throw new Error("Local wallet failed to initialize.");
        }

        const accounts = wm.getAccounts();
        if (accounts.length === 0) {
          await wm.createAccount(undefined, (msg) => {
            terminalHandle.current?.println(msg, TerminalTextStyle.Sub);
          });
        } else {
          const chosen = resolveQuickJoinAccount(accounts);
          if (!chosen) {
            throw new Error("Local accounts list was unexpectedly empty.");
          }
          await wm.switchAccount(chosen.address, (msg) =>
            terminalHandle.current?.println(msg, TerminalTextStyle.Sub)
          );
        }
        if (generation !== quickBootstrapEffectGenRef.current) return;

        if (sponsorMode) {
          await runSponsorInfrastructurePreflightGate({
            terminal: terminalHandle,
            getWalletManager: () => walletManagerRef.current,
            purpose: "deploy",
            setConnectionSettingsOpen,
            setTerminalVisible,
            entryMode: "quick",
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        }
        if (generation !== quickBootstrapEffectGenRef.current) return;

        lockWalletSelection("local");
        refreshLocalAccountCount();
        quickBootstrapDoneRef.current = true;
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (err) {
        console.error(err);
        if (generation !== quickBootstrapEffectGenRef.current) return;
        quickBootstrapDoneRef.current = true;
        setTerminalVisible(true);
        terminalHandle.current?.println(
          err instanceof Error ? err.message : String(err),
          TerminalTextStyle.Red
        );
        terminalHandle.current?.println(
          "Refresh the page to try again.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.TERMINATED);
      }
    })();
  }, [
    entryMode,
    ensureEmbeddedWalletManager,
    lockWalletSelection,
    playRefreshPageTransition,
    rebuildWalletAfterConnectionSave,
    refreshLocalAccountCount,
    selectWalletMode,
    sponsorMode,
    setConnectionSettingsOpen,
    setTerminalVisible,
  ]);

  const ensureIndexerConnection = useCallback(async () => {
    if (indexerRef.current) {
      return indexerRef.current;
    }

    const bootstrapUrl = getEffectiveIndexerBootstrapUrl();
    const indexerConfig: IndexerConnectionConfig = {
      nodeUrl: getEffectiveNodeUrl(),
      startBlock: START_BLOCK,
      debounceMs: 1000,
      pollIntervalMs: 2000,
      maxBlocksPerRequest: 100,
    };

    setLoadingPhase({ step: "connecting" });
    if (bootstrapUrl) {
      indexerConfig.bootstrapUrl = bootstrapUrl;
      setLoadingPhase({ step: "snapshot" });
    } else {
      setLoadingPhase({ step: "syncing", detail: "Preparing..." });
    }

    indexerConfig.onSnapshotProgress = (progress) => {
      const pct = progress.percent ?? undefined;
      const detail =
        progress.phase === "parsing"
          ? "Parsing..."
          : progress.phase === "complete"
            ? "Complete"
            : `${formatBytes(progress.loadedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}`;
      setLoadingPhase({ step: "snapshot", detail, percent: pct });
    };
    indexerConfig.onBlockSyncProgress = (_from, to, latest) => {
      if (initialSyncDoneRef.current) return;
      const pct = latest > 0 ? Math.round((to / latest) * 100) : undefined;
      setLoadingPhase({
        step: "syncing",
        detail: `Block ${to} / ${latest}`,
        percent: pct,
      });
    };

    const { connection } = await createIndexerConnection(indexerConfig);
    indexerRef.current = connection;
    initialSyncDoneRef.current = true;

    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).dfDebug = {
        snapshot: () => JSON.parse(connection.getSnapshotAsJsonString()),
        snapshotJson: () => connection.getSnapshotAsJsonString(),
        downloadSnapshot: () => {
          const json = connection.getSnapshotAsJsonString();
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `client-snapshot-block-${connection.getProcessedBlockNumber()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        },
        connection,
      };
    }

    setLoadingPhase({ step: "done" });
    return connection;
  }, []);

  const promptForExternalAccountSelection = useCallback(
    async (
      terminal: React.MutableRefObject<TerminalHandle | undefined>,
      accounts: Aliased<AztecAddress>[]
    ): Promise<AztecAddress | null> => {
      for (;;) {
        terminal.current?.println("");
        terminal.current?.println(
          "Select one of the accounts currently granted by your wallet:",
          TerminalTextStyle.Text
        );
        accounts.forEach((account, index) => {
          terminal.current?.printOption(
            String(index + 1),
            account.alias
              ? `${account.alias} (${account.item.toString()})`
              : account.item.toString()
          );
        });
        terminal.current?.printOption("c", "Cancel");

        const selection = (await terminal.current?.getInput()) || "";
        if (selection === "c") {
          return null;
        }

        const selectedIndex = Number(selection);
        if (
          Number.isNaN(selectedIndex) ||
          selectedIndex < 1 ||
          selectedIndex > accounts.length
        ) {
          terminal.current?.println("Unrecognized input. Please try again.");
          continue;
        }

        return accounts[selectedIndex - 1].item;
      }
    },
    []
  );

  const promptForExternalWalletProviderSelection = useCallback(
    async (
      terminal: React.MutableRefObject<TerminalHandle | undefined>,
      providers: WalletProvider[]
    ): Promise<WalletProvider | "rescan" | "back"> => {
      for (;;) {
        terminal.current?.println("");
        terminal.current?.println(
          "Detected extension wallets:",
          TerminalTextStyle.Text
        );
        providers.forEach((provider, index) => {
          terminal.current?.printOption(String(index + 1), provider.name);
        });
        terminal.current?.printOption("r", "Rescan");
        terminal.current?.printOption("b", "Back");

        const input = (await terminal.current?.getInput()) || "";
        if (input === "r") {
          return "rescan";
        }
        if (input === "b") {
          return "back";
        }

        const selection = Number(input);
        if (
          Number.isNaN(selection) ||
          selection < 1 ||
          selection > providers.length
        ) {
          terminal.current?.println("Unrecognized input. Please try again.");
          continue;
        }

        return providers[selection - 1];
      }
    },
    []
  );

  const promptForExternalWalletVerification = useCallback(
    async (
      terminal: React.MutableRefObject<TerminalHandle | undefined>,
      pendingConnection: PendingConnection
    ): Promise<"confirm" | "cancel"> => {
      const verificationEmojis = Array.from(
        hashToEmoji(pendingConnection.verificationHash, 9)
      );

      for (;;) {
        terminal.current?.println("");
        terminal.current?.println(
          "Confirm this emoji sequence matches your wallet before proceeding.",
          TerminalTextStyle.Text
        );
        terminal.current?.println(
          "If your wallet extension shows the same sequence, approve there and continue here.",
          TerminalTextStyle.Text
        );
        for (
          let rowStart = 0;
          rowStart < verificationEmojis.length;
          rowStart += 3
        ) {
          terminal.current?.println(
            verificationEmojis.slice(rowStart, rowStart + 3).join(" "),
            TerminalTextStyle.White
          );
        }
        terminal.current?.printOption("y", "Emojis match");
        terminal.current?.printOption("c", "Cancel");

        const input = (await terminal.current?.getInput()) || "";
        if (input === "y") {
          return "confirm";
        }
        if (input === "c") {
          cancelConnection(pendingConnection);
          return "cancel";
        }

        terminal.current?.println("Unrecognized input. Please try again.");
      }
    },
    [cancelConnection]
  );

  const connectExternalWalletInTerminal = useCallback(
    async (
      terminal: React.MutableRefObject<TerminalHandle | undefined>
    ): Promise<ExternalWalletConnectionResult | null> => {
      terminal.current?.println("");
      terminal.current?.println(
        "External wallets are managed by an extension.",
        TerminalTextStyle.Text
      );
      terminal.current?.println(
        "Private keys are not stored in this app.",
        TerminalTextStyle.Text
      );

      for (;;) {
        let providerSessionActive = false;

        try {
          terminal.current?.println("Scanning for Aztec extension wallets...");
          const discovery = await discoverWallets();
          const providers: WalletProvider[] = [];

          try {
            for await (const provider of discovery.wallets) {
              if (providers.some((item) => item.id === provider.id)) continue;
              providers.push(provider);
            }
          } finally {
            discovery.cancel();
          }

          let selectedProvider: WalletProvider | null = null;
          if (providers.length === 0) {
            let shouldRescan = false;
            for (;;) {
              terminal.current?.println("No extension wallet detected yet.");
              terminal.current?.printOption("r", "Rescan");
              terminal.current?.printOption("b", "Back");

              const input = (await terminal.current?.getInput()) || "";
              if (input === "r") {
                shouldRescan = true;
                break;
              }
              if (input === "b") {
                terminal.current?.println(
                  "External wallet connection cancelled.",
                  TerminalTextStyle.Sub
                );
                return null;
              }

              terminal.current?.println(
                "Unrecognized input. Please try again."
              );
            }

            if (shouldRescan) {
              continue;
            }
          } else {
            const providerSelection =
              await promptForExternalWalletProviderSelection(
                terminal,
                providers
              );

            if (providerSelection === "rescan") {
              continue;
            }
            if (providerSelection === "back") {
              terminal.current?.println(
                "External wallet connection cancelled.",
                TerminalTextStyle.Sub
              );
              return null;
            }

            selectedProvider = providerSelection;
          }

          if (!selectedProvider) {
            continue;
          }

          terminal.current?.println(
            `Selected wallet: ${selectedProvider.name}`,
            TerminalTextStyle.Text
          );
          terminal.current?.println(
            "Establishing secure channel...",
            TerminalTextStyle.Text
          );
          const pendingConnection = await initiateConnection(selectedProvider);
          providerSessionActive = true;

          const verificationResult = await promptForExternalWalletVerification(
            terminal,
            pendingConnection
          );
          if (verificationResult === "cancel") {
            await releaseWalletSession();
            terminal.current?.println(
              "External wallet connection cancelled.",
              TerminalTextStyle.Sub
            );
            return null;
          }

          terminal.current?.println(
            "Connecting to wallet and requesting capabilities...",
            TerminalTextStyle.Text
          );
          terminal.current?.println(
            "Check your wallet extension and approve if prompted.",
            TerminalTextStyle.Text
          );

          const wallet = await confirmConnection(pendingConnection);
          const capabilityResolution =
            await resolveExternalWalletCapabilities(wallet);
          const {
            accounts,
            supportsUtilitySimulation,
            supportsTransactionSimulation,
            supportsTransactionExecution,
          } = capabilityResolution;

          if (import.meta.env.DEV) {
            console.debug(
              "[ExternalWallet] Connected provider capability check",
              {
                providerId: selectedProvider.id,
                providerName: selectedProvider.name,
                supportsUtilitySimulation,
                supportsTransactionSimulation,
                supportsTransactionExecution,
              }
            );
          }

          if (accounts.length === 0) {
            terminal.current?.println(
              "No accounts granted by wallet.",
              TerminalTextStyle.Red
            );
            await releaseWalletSession();
            return null;
          }

          const missingSupport = describeMissingExternalWalletSupport({
            supportsUtilitySimulation,
            supportsTransactionSimulation,
            supportsTransactionExecution,
          });
          if (missingSupport) {
            terminal.current?.println(
              `Wallet did not grant required ${missingSupport} permission${
                missingSupport.includes(" and ") ? "s" : ""
              }.`,
              TerminalTextStyle.Red
            );
            terminal.current?.println(
              "Reconnect and approve the requested permissions in your wallet extension.",
              TerminalTextStyle.Red
            );
            await releaseWalletSession();
            return null;
          }

          const selectedAddress = await promptForExternalAccountSelection(
            terminal,
            accounts
          );
          if (!selectedAddress) {
            await releaseWalletSession();
            terminal.current?.println(
              "External wallet connection cancelled.",
              TerminalTextStyle.Sub
            );
            return null;
          }

          return {
            wallet,
            address: selectedAddress,
            descriptor: {
              providerId: selectedProvider.id,
              providerName: selectedProvider.name,
              accountAddress: selectedAddress.toString(),
              savedAt: Date.now(),
            },
            supportsUtilitySimulation,
            supportsTransactionSimulation,
            supportsTransactionExecution,
          };
        } catch (err) {
          terminal.current?.println(
            err instanceof Error ? err.message : String(err),
            TerminalTextStyle.Red
          );
          if (providerSessionActive) {
            await releaseWalletSession();
          }
          return null;
        }
      }
    },
    [
      confirmConnection,
      discoverWallets,
      initiateConnection,
      promptForExternalAccountSelection,
      promptForExternalWalletProviderSelection,
      promptForExternalWalletVerification,
      releaseWalletSession,
    ]
  );

  useEffect(() => {
    return onWalletSessionLost((message) => {
      if (selectedWalletModeRef.current !== "external") return;
      if (walletLockStateRef.current === "unselected") return;
      enterFatalWalletSessionLoss(message);
    });
  }, [enterFatalWalletSessionLoss, onWalletSessionLost]);

  useEffect(() => {
    return () => {
      gameUIManagerRef.current?.destroy();
      walletManagerRef.current?.destroy();
      indexerRef.current?.destroy();
      void releaseWalletSession();
    };
  }, [releaseWalletSession]);

  useEffect(() => {
    if (!terminalHandle.current || loadingPhase.step === "done") {
      return;
    }

    if (
      (loadingPhase.step === "snapshot" || loadingPhase.step === "syncing") &&
      !connectingStagePrintedRef.current
    ) {
      printInitializationStage("connecting");
      connectingStagePrintedRef.current = true;
    }

    if (lastLoggedLoadingStepRef.current !== loadingPhase.step) {
      printInitializationStage(loadingPhase.step);
      lastLoggedLoadingStepRef.current = loadingPhase.step;
      if (loadingPhase.step === "connecting") {
        connectingStagePrintedRef.current = true;
      }
    }

    if (loadingPhase.step === "wallet") {
      const nextBucket = getWalletProgressBucket(loadingPhase.percent);
      if (
        nextBucket != null &&
        nextBucket !== lastLoggedWalletProgressBucketRef.current
      ) {
        if (nextBucket === 100) {
          printInitializationMilestone("Wallet initialization complete.");
        } else {
          printInitializationMilestone(
            `Wallet initialization ${nextBucket}% complete.`
          );
        }
        lastLoggedWalletProgressBucketRef.current = nextBucket;
      }
      return;
    }

    if (loadingPhase.step === "snapshot") {
      if (
        loadingPhase.detail === "Parsing..." &&
        !snapshotParsingPrintedRef.current
      ) {
        printInitializationMilestone("Parsing snapshot...");
        snapshotParsingPrintedRef.current = true;
      }
      if (
        loadingPhase.detail === "Complete" &&
        !snapshotCompletePrintedRef.current
      ) {
        printInitializationMilestone("Snapshot ready.");
        snapshotCompletePrintedRef.current = true;
      }
      return;
    }

    if (loadingPhase.step === "syncing") {
      if (
        loadingPhase.detail === "Preparing..." &&
        !syncStartPrintedRef.current
      ) {
        printInitializationMilestone("Preparing block sync...");
        syncStartPrintedRef.current = true;
      }
      return;
    }

    if (loadingPhase.step === "contracts") {
      if (
        loadingPhase.detail === "Syncing chain clock..." &&
        !chainClockSyncPrintedRef.current
      ) {
        printInitializationMilestone("Syncing chain clock...");
        chainClockSyncPrintedRef.current = true;
      }
      return;
    }

    if (
      loadingPhase.step === "gamestate" &&
      loadingPhase.gamestateSubStep != null &&
      loadingPhase.gamestateSubStepTotal != null
    ) {
      const nextSubStep = `${loadingPhase.gamestateSubStep}/${loadingPhase.gamestateSubStepTotal}`;
      const nextSubStepLogKey = `${nextSubStep}:${loadingPhase.detail ?? ""}`;
      if (lastLoggedGamestateSubStepRef.current !== nextSubStepLogKey) {
        const suffix = loadingPhase.detail ? `: ${loadingPhase.detail}` : "...";
        printInitializationMilestone(
          `Loading game data (step ${nextSubStep})${suffix}`
        );
        lastLoggedGamestateSubStepRef.current = nextSubStepLogKey;
      }
    }

    if (loadingPhase.step === "gamestate" && loadingPhase.activeEntity) {
      const nextBucket = getNormalizedProgressBucket(
        loadingPhase.activeEntityPercent
      );
      const lastBucket =
        lastLoggedGamestateEntityProgressRef.current[loadingPhase.activeEntity];

      if (nextBucket != null && nextBucket !== lastBucket) {
        printInitializationMilestone(
          `${loadingPhase.activeEntity} ${nextBucket}% complete.`
        );
        lastLoggedGamestateEntityProgressRef.current = {
          ...lastLoggedGamestateEntityProgressRef.current,
          [loadingPhase.activeEntity]: nextBucket,
        };
      }
    }
  }, [loadingPhase, printInitializationMilestone, printInitializationStage]);

  const advanceStateFromNone = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const issues = await unsupportedFeatures();

      if (issues.includes(Incompatibility.MobileOrTablet)) {
        terminal.current?.println(
          "ERROR: Mobile or tablet device detected. Please use desktop.",
          TerminalTextStyle.Red
        );
      }

      if (issues.includes(Incompatibility.NoIDB)) {
        terminal.current?.println(
          "ERROR: IndexedDB not found. Try using a different browser.",
          TerminalTextStyle.Red
        );
      }

      if (issues.includes(Incompatibility.UnsupportedBrowser)) {
        terminal.current?.println(
          "ERROR: Browser unsupported. Try Brave, Firefox, or Chrome.",
          TerminalTextStyle.Red
        );
      }

      if (issues.length > 0) {
        const count = issues.length;
        terminal.current?.print(
          `${count} ${count === 1 ? "error" : "errors"} found. `,
          TerminalTextStyle.Red
        );
        terminal.current?.println(
          count === 1
            ? "Please resolve it and refresh the page."
            : "Please resolve them and refresh the page."
        );
        setStep(TerminalPromptStep.TERMINATED);
      } else {
        setStep(TerminalPromptStep.WALLET_MENU);
      }
    },
    []
  );

  const advanceStateFromWalletMenu = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const rememberedSession = getRememberedSession();
      const selectedMode = selectedWalletModeRef.current;

      if (selectedMode === null) {
        if (isLobby) {
          terminal.current?.newline();
          terminal.current?.printElement(
            <MythicLabelText text={`You are joining a Dark Forest lobby`} />
          );
          terminal.current?.newline();
          terminal.current?.newline();
        } else {
          terminal.current?.newline();
          terminal.current?.newline();
          terminal.current?.printElement(
            <MythicLabelText text={`                 ${GAME_NAME}`} />
          );
          terminal.current?.newline();
          terminal.current?.newline();

          // Project description (Version/Date/Champion table commented out below)
          terminal.current?.println(
            "Decentralized space conquest. Explore, expand, and compete in a",
            TerminalTextStyle.Text
          );
          terminal.current?.println(
            "universe of planets and artifacts. Runs on " +
              CHAIN_DISPLAY_NAME +
              ".",
            TerminalTextStyle.Text
          );

          terminal.current?.println(
            `APP VERSION ${APP_VERSION}.`,
            TerminalTextStyle.Sub
          );

          terminal.current?.newline();
          terminal.current?.newline();

          if (sponsorMode && !walletMenuSponsorStatusPrintedRef.current) {
            walletMenuSponsorStatusPrintedRef.current = true;
            await printInitialSponsorStatus(terminal);
          }

          /* Version / Date / Champion table (commented out)
        terminal.current?.print("    ");
        terminal.current?.print("Version", TerminalTextStyle.Sub);
        terminal.current?.print("    ");
        terminal.current?.print("Date", TerminalTextStyle.Sub);
        terminal.current?.print("              ");
        terminal.current?.print("Champion", TerminalTextStyle.Sub);
        terminal.current?.newline();
        terminal.current?.print("    v0.1       ", TerminalTextStyle.Text);
        terminal.current?.print("02/05/2020        ", TerminalTextStyle.Text);
        terminal.current?.printLink("Dylan Field", () => { window.open("https://twitter.com/zoink"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.2       ", TerminalTextStyle.Text);
        terminal.current?.println("06/06/2020        Nate Foss", TerminalTextStyle.Text);
        terminal.current?.print("    v0.3       ", TerminalTextStyle.Text);
        terminal.current?.print("08/07/2020        ", TerminalTextStyle.Text);
        terminal.current?.printLink("@hideandcleanse", () => { window.open("https://twitter.com/hideandcleanse"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.4       ", TerminalTextStyle.Text);
        terminal.current?.print("10/02/2020        ", TerminalTextStyle.Text);
        terminal.current?.printLink("Jacob Rosenthal", () => { window.open("https://twitter.com/jacobrosenthal"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.5       ", TerminalTextStyle.Text);
        terminal.current?.print("12/25/2020        ", TerminalTextStyle.Text);
        terminal.current?.printElement(<TextPreview text={"0xb05d95422bf8d5024f9c340e8f7bd696d67ee3a9"} focusedWidth={"100px"} unFocusedWidth={"100px"} />);
        terminal.current?.println("");
        terminal.current?.print("    v0.6 r1    ", TerminalTextStyle.Text);
        terminal.current?.print("05/22/2021        ", TerminalTextStyle.Text);
        terminal.current?.printLink("Ansgar Dietrichs", () => { window.open("https://twitter.com/adietrichs"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.6 r2    ", TerminalTextStyle.Text);
        terminal.current?.print("06/28/2021        ", TerminalTextStyle.Text);
        terminal.current?.printLink("@orden_gg", () => { window.open("https://twitter.com/orden_gg"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.6 r3    ", TerminalTextStyle.Text);
        terminal.current?.print("08/22/2021        ", TerminalTextStyle.Text);
        terminal.current?.printLink("@dropswap_gg", () => { window.open("https://twitter.com/dropswap_gg"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.6 r4    ", TerminalTextStyle.Text);
        terminal.current?.print("10/01/2021        ", TerminalTextStyle.Text);
        terminal.current?.printLink("@orden_gg", () => { window.open("https://twitter.com/orden_gg"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.print("    v0.6 r5    ", TerminalTextStyle.Text);
        terminal.current?.print("02/18/2022        ", TerminalTextStyle.Text);
        terminal.current?.printLink("@d_fdao", () => { window.open("https://twitter.com/d_fdao"); }, TerminalTextStyle.Text);
        terminal.current?.print(" + ");
        terminal.current?.printLink("@orden_gg", () => { window.open("https://twitter.com/orden_gg"); }, TerminalTextStyle.Text);
        terminal.current?.newline();
        terminal.current?.newline();
        */
        }
        terminal.current?.println("");
        terminal.current?.println(
          "Wallet choice will be locked for this session after login completes.",
          TerminalTextStyle.Sub
        );
        terminal.current?.println(
          "Refresh the page to use a different wallet.",
          TerminalTextStyle.Sub
        );
        terminal.current?.println("");
      }

      if (selectedMode === null) {
        terminal.current?.printOption("1", "Use local wallet.");
        terminal.current?.printOption("2", "Connect extension wallet.");
        if (rememberedSession) {
          terminal.current?.printOption(
            "3",
            `Reconnect last extension wallet (${rememberedSession.providerName}, ${rememberedSession.accountAddress}).`
          );
        }
        terminal.current?.println("");
        const walletHint =
          entryModeRef.current === "terminal"
            ? "Type a number and press ENTER to select:"
            : "Click an option or type a number and press ENTER:";
        terminal.current?.println(walletHint, TerminalTextStyle.Text);

        const userInput = await terminal.current?.getInput();
        if (userInput === "1") {
          await selectWalletMode("local");
          await advanceStateFromWalletMenu(terminal);
          return;
        }
        if (userInput === "2") {
          await selectWalletMode("external");
          setStep(TerminalPromptStep.CONNECT_EXTERNAL);
          return;
        }
        if (userInput === "3" && rememberedSession) {
          await selectWalletMode("external");
          setStep(TerminalPromptStep.RECONNECT_EXTERNAL);
          return;
        }

        terminal.current?.println("Unrecognized input. Please try again.");
        await advanceStateFromWalletMenu(terminal);
        return;
      }

      if (selectedMode === "external") {
        selectedWalletModeRef.current = null;
        setWalletModeUi(null);
        await advanceStateFromWalletMenu(terminal);
        return;
      }

      if (selectedMode === "local") {
        terminal.current?.println(
          `Found ${localAccountCount} local account${localAccountCount === 1 ? "" : "s"} on this device.`
        );
        terminal.current?.println("");
        terminal.current?.println(
          "Selected wallet mode: local wallet.",
          TerminalTextStyle.Text
        );

        if (localAccountCount > 0) {
          terminal.current?.printOption(
            "1",
            "Login with existing local account."
          );
          terminal.current?.printOption("2", "Generate new Aztec account.");
          terminal.current?.printOption("3", "Import account.");
          terminal.current?.printOption("4", "Back to wallet selection.");
        } else {
          terminal.current?.printOption("1", "Generate new Aztec account.");
          terminal.current?.printOption("2", "Import account.");
          terminal.current?.printOption("3", "Back to wallet selection.");
        }
        terminal.current?.println("");
        const localWalletHint =
          entryModeRef.current === "terminal"
            ? "Type a number and press ENTER to select:"
            : "Click an option or type a number and press ENTER:";
        terminal.current?.println(localWalletHint, TerminalTextStyle.Text);

        const userInput = await terminal.current?.getInput();
        const pickExisting = localAccountCount > 0 && userInput === "1";
        const pickNew =
          localAccountCount > 0 ? userInput === "2" : userInput === "1";
        const pickImport =
          localAccountCount > 0 ? userInput === "3" : userInput === "2";
        const pickBack =
          localAccountCount > 0 ? userInput === "4" : userInput === "3";

        if (pickExisting) {
          try {
            await ensureEmbeddedWalletManager();
            setStep(TerminalPromptStep.LOCAL_ACCOUNT_LIST);
          } catch {
            terminal.current?.println(
              "Unable to initialize the local wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await advanceStateFromWalletMenu(terminal);
          }
        } else if (pickNew) {
          try {
            await ensureEmbeddedWalletManager();
            setStep(TerminalPromptStep.GENERATE_ACCOUNT);
          } catch {
            terminal.current?.println(
              "Unable to initialize the local wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await advanceStateFromWalletMenu(terminal);
          }
        } else if (pickImport) {
          try {
            await ensureEmbeddedWalletManager();
            setStep(TerminalPromptStep.IMPORT_ACCOUNT);
          } catch {
            terminal.current?.println(
              "Unable to initialize the local wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await advanceStateFromWalletMenu(terminal);
          }
        } else if (pickBack && !isWalletSelectionLocked()) {
          await clearUnlockedWalletState();
          selectedWalletModeRef.current = null;
          setWalletModeUi(null);
          await advanceStateFromWalletMenu(terminal);
        } else {
          terminal.current?.println("Unrecognized input. Please try again.");
          await advanceStateFromWalletMenu(terminal);
        }
        return;
      }
    },
    [
      clearUnlockedWalletState,
      ensureEmbeddedWalletManager,
      getRememberedSession,
      isWalletSelectionLocked,
      isLobby,
      localAccountCount,
      selectWalletMode,
      sponsorMode,
    ]
  );

  const advanceStateFromLocalAccountList = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      for (;;) {
        terminal.current?.println(``);
        const walletManager = walletManagerRef.current;
        const accounts = walletManager?.getAccounts() ?? [];
        if (accounts.length === 0) {
          terminal.current?.println(
            "No local accounts were found. Returning to the wallet menu.",
            TerminalTextStyle.Red
          );
          setStep(TerminalPromptStep.WALLET_MENU);
          return;
        }

        for (let i = 0; i < accounts.length; i += 1) {
          terminal.current?.printOption(
            String(i + 1),
            `${accounts[i].address}`,
            {
              tailAfterKey: ": ",
            }
          );
        }
        terminal.current?.println(``);
        terminal.current?.println(`Select an account:`, TerminalTextStyle.Text);

        const selection = +((await terminal.current?.getInput()) || "");

        if (
          Number.isNaN(selection) ||
          selection < 1 ||
          selection > accounts.length
        ) {
          terminal.current?.println("Unrecognized input. Please try again.");
          continue;
        }

        const account = accounts[selection - 1];
        try {
          terminal.current?.println("Restoring account...");
          const result = await walletManager?.switchAccount(
            account.address,
            (msg) => terminal.current?.println(msg, TerminalTextStyle.Sub)
          );
          lockWalletSelection("local");
          if (result?.deployed) {
            terminal.current?.println(
              "Account already deployed on this network.",
              TerminalTextStyle.Green
            );
          } else {
            terminal.current?.println(
              "Account not deployed on this network yet.",
              TerminalTextStyle.Sub
            );
          }
          setStep(TerminalPromptStep.ACCOUNT_SET);
          return;
        } catch (e) {
          terminal.current?.println(
            "An unknown error occurred. please try again.",
            TerminalTextStyle.Red
          );
        }
      }
    },
    [lockWalletSelection]
  );

  const advanceStateFromConnectExternal = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      if (selectedWalletModeRef.current !== "external") {
        terminal.current?.println(
          "Extension wallet mode is not selected for this session.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      const result = await connectExternalWalletInTerminal(terminal);
      if (!result) {
        await resetToWalletSelectionMenu();
        return;
      }

      try {
        await initializeExternalWalletManager(result);
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (err) {
        console.error("Failed to initialize external wallet:", err);
        terminal.current?.println(
          err instanceof Error
            ? err.message
            : "Failed to initialize the connected external wallet. Please try again.",
          TerminalTextStyle.Red
        );
        await resetToWalletSelectionMenu();
      }
    },
    [
      connectExternalWalletInTerminal,
      initializeExternalWalletManager,
      resetToWalletSelectionMenu,
    ]
  );

  const advanceStateFromReconnectExternal = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      if (selectedWalletModeRef.current !== "external") {
        terminal.current?.println(
          "Extension wallet mode is not selected for this session.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      const rememberedSession = getRememberedSession();
      if (!rememberedSession) {
        terminal.current?.println(
          "No remembered external wallet session found.",
          TerminalTextStyle.Red
        );
        await resetToWalletSelectionMenu();
        return;
      }

      terminal.current?.println("");
      terminal.current?.println(
        `Reconnecting ${rememberedSession.providerName}...`,
        TerminalTextStyle.Text
      );
      terminal.current?.println(
        `Remembered account: ${rememberedSession.accountAddress}`
      );
      terminal.current?.println(
        "Check your wallet extension and approve if prompted.",
        TerminalTextStyle.Text
      );

      try {
        resetInitializationTerminalLogging();
        const result = await reconnectRememberedWallet();
        await initializeExternalWalletManager(result);
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (err) {
        if (err instanceof RememberedExternalWalletAccountMismatchError) {
          terminal.current?.println(err.message, TerminalTextStyle.Red);
          const nextAddress = await promptForExternalAccountSelection(
            terminal,
            err.accounts
          );
          if (!nextAddress) {
            terminal.current?.println(
              "Extension wallet reconnection cancelled.",
              TerminalTextStyle.Sub
            );
            await resetToWalletSelectionMenu();
            return;
          }

          try {
            await initializeExternalWalletManager({
              wallet: err.wallet,
              address: nextAddress,
              descriptor: {
                ...rememberedSession,
                accountAddress: nextAddress.toString(),
                savedAt: Date.now(),
              },
              supportsUtilitySimulation: err.supportsUtilitySimulation,
              supportsTransactionSimulation: err.supportsTransactionSimulation,
              supportsTransactionExecution: err.supportsTransactionExecution,
            });
            setStep(TerminalPromptStep.ACCOUNT_SET);
          } catch (innerErr) {
            console.error(
              "Failed to initialize reselected external wallet:",
              innerErr
            );
            terminal.current?.println(
              innerErr instanceof Error
                ? innerErr.message
                : "Failed to initialize the connected external wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await resetToWalletSelectionMenu();
          }
          return;
        }

        terminal.current?.println(
          err instanceof Error ? err.message : String(err),
          TerminalTextStyle.Red
        );
        await resetToWalletSelectionMenu();
      }
    },
    [
      getRememberedSession,
      initializeExternalWalletManager,
      promptForExternalAccountSelection,
      reconnectRememberedWallet,
      resetInitializationTerminalLogging,
      resetToWalletSelectionMenu,
    ]
  );

  const advanceStateFromGenerateAccount = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const walletManager = walletManagerRef.current;
      if (!walletManager) {
        terminal.current?.println(
          "ERROR: Local wallet is unavailable. Please refresh and try again.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      const SPIN_CHARS = ["|", "/", "-", "\\"];
      const SPIN_MS = 120;
      let spinInterval: ReturnType<typeof setInterval> | undefined;
      let spinIndex = 0;
      let currentStep = "";
      try {
        terminal.current?.println(``);
        terminal.current?.println("Generating new Aztec account keys...");
        terminal.current?.println(
          "Key generation is quick. Deployment will happen after you get FeeJuice.",
          TerminalTextStyle.Sub
        );
        terminal.current?.print("  ");
        spinInterval = setInterval(() => {
          if (!terminal.current) return;
          terminal.current.removeLast(1);
          const line = currentStep
            ? `  ${currentStep} ${SPIN_CHARS[spinIndex]}`
            : `  ${SPIN_CHARS[spinIndex]}`;
          terminal.current.print(line, TerminalTextStyle.Sub);
          spinIndex = (spinIndex + 1) % SPIN_CHARS.length;
        }, SPIN_MS);
        const record = await walletManager.createAccount(undefined, (msg) => {
          if (!terminal.current) return;
          terminal.current.removeLast(1);
          currentStep = msg;
          terminal.current.print(
            `  ${msg} ${SPIN_CHARS[spinIndex]}`,
            TerminalTextStyle.Sub
          );
          spinIndex = (spinIndex + 1) % SPIN_CHARS.length;
        });
        if (spinInterval) clearInterval(spinInterval);
        spinInterval = undefined;
        terminal.current?.removeLast(1);
        terminal.current?.println(`  ${currentStep}`, TerminalTextStyle.Sub);
        terminal.current?.println("Done.", TerminalTextStyle.Green);
        const newAddr = record.address;
        terminal.current?.println(``);
        terminal.current?.print(`Created account with address `);
        terminal.current?.printElement(
          <TextPreview text={newAddr} unFocusedWidth={"100px"} />
        );
        terminal.current?.println(``);
        terminal.current?.println("");
        terminal.current?.println(
          "Note: Account keys are stored in local storage.",
          TerminalTextStyle.Text
        );
        terminal.current?.println(
          "Clearing browser local storage/cache will render your"
        );
        terminal.current?.println(
          "accounts inaccessible, unless you export your keys."
        );
        terminal.current?.println("");
        terminal.current?.println(
          "Press any key to continue:",
          TerminalTextStyle.Text
        );

        await terminal.current?.getInput();
        lockWalletSelection("local");
        refreshLocalAccountCount();
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (e) {
        if (spinInterval) clearInterval(spinInterval);
        terminal.current?.removeLast(1);
        console.error("Failed to create account:", e);
        terminal.current?.println(
          "An unknown error occurred. please try again.",
          TerminalTextStyle.Red
        );
      }
    },
    [lockWalletSelection, refreshLocalAccountCount]
  );

  const advanceStateFromImportAccount = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const walletManager = walletManagerRef.current;
      if (!walletManager) {
        terminal.current?.println(
          "ERROR: Local wallet is unavailable. Please refresh and try again.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      terminal.current?.println(
        "Enter the secretKey of the account you wish to import:",
        TerminalTextStyle.Text
      );
      const secretKey = (await terminal.current?.getInput()) || "";
      terminal.current?.println("Enter the salt:", TerminalTextStyle.Text);
      const salt = (await terminal.current?.getInput()) || "";
      terminal.current?.println(
        "Enter the signingKey (hex):",
        TerminalTextStyle.Text
      );
      const signingKey = (await terminal.current?.getInput()) || "";
      try {
        terminal.current?.println("Importing account...");
        const record = await walletManager.importAccount(
          secretKey,
          salt,
          signingKey,
          undefined,
          (msg) => terminal.current?.println(msg, TerminalTextStyle.Sub)
        );
        if (record.deployed) {
          terminal.current?.println(
            "Account already deployed on this network.",
            TerminalTextStyle.Green
          );
        } else {
          terminal.current?.println(
            "Account not deployed on this network yet.",
            TerminalTextStyle.Sub
          );
        }
        terminal.current?.println(
          `Imported account with address ${record.address}.`
        );
        lockWalletSelection("local");
        refreshLocalAccountCount();
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (e) {
        terminal.current?.println(
          "An unknown error occurred. please try again.",
          TerminalTextStyle.Red
        );
      }
    },
    [lockWalletSelection, refreshLocalAccountCount]
  );

  const advanceStateFromAccountSet = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const walletManager = walletManagerRef.current;
      if (!walletManager) {
        terminal.current?.println(
          "ERROR: wallet manager not ready.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.TERMINATED);
        return;
      }
      const playerAddress = walletManager?.getActiveAddress()?.toString();
      if (!playerAddress) {
        terminal.current?.println(
          "ERROR: No active account. Please refresh and try again.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.TERMINATED);
        return;
      }

      if (
        walletManager.isExternalWallet() &&
        !externalModeBannerPrintedRef.current
      ) {
        terminal.current?.println(
          "Using external wallet",
          TerminalTextStyle.Green
        );
        terminal.current?.println(`Account: ${playerAddress}`);
        terminal.current?.println("");
        externalModeBannerPrintedRef.current = true;
      }

      if (!walletLockMessagePrintedRef.current) {
        terminal.current?.println(
          "Wallet choice is locked for this session.",
          TerminalTextStyle.Sub
        );
        terminal.current?.println(
          "Refresh the page to use a different wallet.",
          TerminalTextStyle.Sub
        );
        terminal.current?.println("");
        walletLockMessagePrintedRef.current = true;
      }

      terminal.current?.println("");
      terminal.current?.println(`Welcome, player ${playerAddress}.`);
      if (walletManager.isExternalWallet()) {
        if (sponsorMode) {
          await runSponsorInfrastructurePreflightGate({
            terminal,
            getWalletManager: () => walletManagerRef.current,
            purpose: "transactions",
            setConnectionSettingsOpen,
            setTerminalVisible,
            entryMode: entryModeRef.current,
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        } else {
          await runAccountFeeJuicePreflightGate({
            terminal,
            getWalletManager: () => walletManagerRef.current,
            setConnectionSettingsOpen,
            setTerminalVisible,
            entryMode: entryModeRef.current,
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        }
        if (entryModeRef.current === "quick") {
          setTerminalVisible(false);
        }
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      if (sponsorMode) {
        await runSponsorInfrastructurePreflightGate({
          terminal,
          getWalletManager: () => walletManagerRef.current,
          purpose: "deploy",
          setConnectionSettingsOpen,
          setTerminalVisible,
          entryMode: entryModeRef.current,
          rebuildWalletAfterConnectionSave,
          onRefreshPage: playRefreshPageTransition,
        });
        terminal.current?.println(
          "Sponsor mode: deploying account if needed (sponsored fees)..."
        );
        try {
          await deployActiveAccountWithSponsorRecovery({
            terminal,
            getWalletManager: () => walletManagerRef.current,
            setConnectionSettingsOpen,
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        } catch (err) {
          console.error(err);
          terminal.current?.println(
            err instanceof Error ? err.message : String(err),
            TerminalTextStyle.Red
          );
          setStep(TerminalPromptStep.TERMINATED);
          return;
        }
        if (entryModeRef.current === "quick") {
          setTerminalVisible(false);
        }
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      await runAccountFeeJuicePreflightGate({
        terminal,
        getWalletManager: () => walletManagerRef.current,
        setConnectionSettingsOpen,
        setTerminalVisible,
        entryMode: entryModeRef.current,
        rebuildWalletAfterConnectionSave,
        onRefreshPage: playRefreshPageTransition,
      });
      terminal.current?.println("Deploying account if needed...");
      await walletManager.deployActiveAccountIfNeeded((msg) =>
        terminal.current?.println(msg, TerminalTextStyle.Sub)
      );
      if (entryModeRef.current === "quick") {
        setTerminalVisible(false);
      }
      setStep(TerminalPromptStep.FETCHING_ETH_DATA);
    },
    [playRefreshPageTransition, rebuildWalletAfterConnectionSave, sponsorMode]
  );

  const advanceStateFromCheckFeeJuice = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const walletManager = walletManagerRef.current;
      if (!walletManager) throw new Error("no wallet manager");

      if (walletManager.isExternalWallet()) {
        if (sponsorMode) {
          await runSponsorInfrastructurePreflightGate({
            terminal,
            getWalletManager: () => walletManagerRef.current,
            purpose: "transactions",
            setConnectionSettingsOpen,
            setTerminalVisible,
            entryMode: entryModeRef.current,
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        } else {
          await runAccountFeeJuicePreflightGate({
            terminal,
            getWalletManager: () => walletManagerRef.current,
            setConnectionSettingsOpen,
            setTerminalVisible,
            entryMode: entryModeRef.current,
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        }
        if (entryModeRef.current === "quick") {
          setTerminalVisible(false);
        }
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      if (sponsorMode) {
        await runSponsorInfrastructurePreflightGate({
          terminal,
          getWalletManager: () => walletManagerRef.current,
          purpose: "deploy",
          setConnectionSettingsOpen,
          setTerminalVisible,
          entryMode: entryModeRef.current,
          rebuildWalletAfterConnectionSave,
          onRefreshPage: playRefreshPageTransition,
        });
        terminal.current?.println(
          "Sponsor mode: deploying account if needed (sponsored fees)..."
        );
        try {
          await deployActiveAccountWithSponsorRecovery({
            terminal,
            getWalletManager: () => walletManagerRef.current,
            setConnectionSettingsOpen,
            rebuildWalletAfterConnectionSave,
            onRefreshPage: playRefreshPageTransition,
          });
        } catch (err) {
          console.error(err);
          terminal.current?.println(
            err instanceof Error ? err.message : String(err),
            TerminalTextStyle.Red
          );
          setStep(TerminalPromptStep.TERMINATED);
          return;
        }
        if (entryModeRef.current === "quick") {
          setTerminalVisible(false);
        }
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      await runAccountFeeJuicePreflightGate({
        terminal,
        getWalletManager: () => walletManagerRef.current,
        setConnectionSettingsOpen,
        setTerminalVisible,
        entryMode: entryModeRef.current,
        rebuildWalletAfterConnectionSave,
        onRefreshPage: playRefreshPageTransition,
      });
      terminal.current?.println("Deploying account if needed...");
      await walletManager.deployActiveAccountIfNeeded((msg) =>
        terminal.current?.println(msg, TerminalTextStyle.Sub)
      );
      if (entryModeRef.current === "quick") {
        setTerminalVisible(false);
      }
      setStep(TerminalPromptStep.FETCHING_ETH_DATA);
    },
    [playRefreshPageTransition, rebuildWalletAfterConnectionSave, sponsorMode]
  );

  const advanceStateFromFetchingEthData = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      let newGameManager: GameManager;
      markWalletSelectionInGame();

      try {
        if (selectedWalletModeRef.current === "external") {
          const support = externalWalletSimulationSupportRef.current;
          const missingSupport =
            support && describeMissingExternalWalletSupport(support);
          if (!support || missingSupport) {
            throw new Error(
              missingSupport
                ? `External wallet session is missing required ${missingSupport} permission${
                    missingSupport.includes(" and ") ? "s" : ""
                  }. Reconnect and approve the requested permissions.`
                : "External wallet session is missing required wallet permissions. Reconnect and approve the requested permissions."
            );
          }
        }

        const walletManager = walletManagerRef.current;
        if (!walletManager) throw new Error("no wallet manager");
        const indexerConnection = await ensureIndexerConnection();

        setLoadingPhase({
          step: "contracts",
          detail: "Syncing chain clock...",
        });
        terminal.current?.println("Building ContractsAPI...");

        const node = createAztecNodeClient(getEffectiveNodeUrl());
        const wallet = walletManager.getWallet();
        const configContract = ConfigContract.at(
          AztecAddress.fromString(CONFIG_CONTRACT_ADDRESS),
          wallet
        );

        const chainClock = new ChainClock(node);
        await chainClock.syncFromNode();
        terminal.current?.println(
          `Chain clock synced (offset: ${chainClock.getOffsetSec().toFixed(0)}s)`
        );

        setLoadingPhase({
          step: "contracts",
          detail: "Building contracts interface...",
        });
        const configCache = new ConfigCache(
          configContract,
          walletManager.getActiveAddress()!,
          {
            onProgress: (detail, current, total) =>
              setLoadingPhase((prev) =>
                prev.step === "gamestate" || prev.step === "contracts"
                  ? {
                      ...prev,
                      detail,
                      activeEntity: "Config constants",
                      activeEntityPercent:
                        total && total > 0 ? current! / total : undefined,
                    }
                  : prev
              ),
          }
        );
        const txExecutor = new TxExecutor(
          walletManager,
          indexerConnection,
          node,
          configCache,
          chainClock
        );
        const contractsAPI = await makeContractsAPI({
          indexerConnection,
          txExecutor,
          walletManager,
          configCache,
        });

        setLoadingPhase({
          step: "gamestate",
          detail: "Downloading game data...",
        });
        newGameManager = await GameManager.create({
          contractsAPI,
          terminal,
          contractAddress,
          chainClock,
          onLoadingProgress: (
            detail,
            percent,
            gamestateSubStep,
            gamestateSubStepTotal,
            activeEntity,
            activeEntityPercent
          ) =>
            setLoadingPhase((prev) =>
              prev.step === "gamestate"
                ? {
                    ...prev,
                    detail,
                    percent,
                    gamestateSubStep,
                    gamestateSubStepTotal,
                    activeEntity,
                    activeEntityPercent,
                  }
                : prev
            ),
        });
      } catch (e) {
        console.error(e);

        setLoadingPhase({ step: "done" });
        setStep(TerminalPromptStep.ERROR);

        if (selectedWalletModeRef.current === "external") {
          if (import.meta.env.DEV) {
            console.debug("[ExternalWallet] Startup failed", {
              error: e instanceof Error ? e.message : String(e),
              support: externalWalletSimulationSupportRef.current,
            });
          }
          terminal.current?.println(
            "External wallet failed during startup.",
            TerminalTextStyle.Red
          );
          terminal.current?.println(
            e instanceof Error
              ? e.message
              : "Required startup simulation did not complete.",
            TerminalTextStyle.Red
          );
          terminal.current?.println(
            "Refresh the page or reconnect your wallet and approve the requested permissions.",
            TerminalTextStyle.Red
          );
        } else {
          terminal.current?.println(
            "Network under heavy load. Please refresh the page and try again.",
            TerminalTextStyle.Red
          );
        }

        return;
      }

      setLoadingPhase({ step: "done" });
      setGameManager(newGameManager);

      window.df = newGameManager;

      const newGameUIManager = await GameUIManager.create(
        newGameManager,
        terminal
      );

      window.ui = newGameUIManager;

      terminal.current?.newline();
      terminal.current?.println("Connected to Dark Forest Contract");
      gameUIManagerRef.current = newGameUIManager;

      if (!newGameManager.hasJoinedGame()) {
        setStep(TerminalPromptStep.NO_HOME_PLANET);
      } else {
        const browserHasData = !!newGameManager.getHomeCoords();
        if (!browserHasData) {
          terminal.current?.println(
            "ERROR: Home coords not found on this browser.",
            TerminalTextStyle.Red
          );
          setStep(TerminalPromptStep.ASK_ADD_ACCOUNT);
          return;
        }
        terminal.current?.println("Validated Local Data...");
        setStep(TerminalPromptStep.ALL_CHECKS_PASS);
      }
    },
    [contractAddress, ensureIndexerConnection, markWalletSelectionInGame]
  );

  const advanceStateFromAskAddAccount = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      terminal.current?.println(
        "Import account home coordinates? (y/n)",
        TerminalTextStyle.Text
      );
      terminal.current?.println(
        "If you're importing an account, make sure you know what you're doing."
      );
      const userInput = await terminal.current?.getInput();

      if (userInput === "y") {
        setStep(TerminalPromptStep.ADD_ACCOUNT);
      } else if (userInput === "n") {
        terminal.current?.println("Try using a different account and reload.");
        setStep(TerminalPromptStep.TERMINATED);
      } else {
        terminal.current?.println("Unrecognized input. Please try again.");
        await advanceStateFromAskAddAccount(terminal);
      }
    },
    []
  );

  const advanceStateFromAddAccount = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const gameUIManager = gameUIManagerRef.current;

      if (gameUIManager) {
        try {
          terminal.current?.println("x: ", TerminalTextStyle.Blue);
          const x = parseInt((await terminal.current?.getInput()) || "");
          terminal.current?.println("y: ", TerminalTextStyle.Blue);
          const y = parseInt((await terminal.current?.getInput()) || "");

          const isValidCoordinate = (coord: number) =>
            !Number.isNaN(coord) && Math.abs(coord) <= 2 ** 32;

          if (!isValidCoordinate(x) || !isValidCoordinate(y)) {
            throw "Invalid home coordinates.";
          }

          if (await gameUIManager.addAccount({ x, y })) {
            terminal.current?.println("Successfully added account.");
            terminal.current?.println("Initializing game...");
            setStep(TerminalPromptStep.ALL_CHECKS_PASS);
          } else {
            throw "Invalid home coordinates.";
          }
        } catch (e) {
          terminal.current?.println(`ERROR: ${e}`, TerminalTextStyle.Red);
          terminal.current?.println("Please try again.");
        }
      } else {
        terminal.current?.println(
          "ERROR: Game UI Manager not found. Terminating session."
        );
        setStep(TerminalPromptStep.TERMINATED);
      }
    },
    []
  );

  const advanceStateFromNoHomePlanet = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      terminal.current?.println(`Welcome to ${GAME_NAME}.`);

      const gameUIManager = gameUIManagerRef.current;
      if (!gameUIManager) {
        terminal.current?.println(
          "ERROR: Game UI Manager not found. Terminating session."
        );
        setStep(TerminalPromptStep.TERMINATED);
        return;
      }

      if (Date.now() / 1000 > gameUIManager.getEndTimeSeconds()) {
        terminal.current?.println(
          "ERROR: This game has ended. Terminating session."
        );
        setStep(TerminalPromptStep.TERMINATED);
        return;
      }

      terminal.current?.newline();

      terminal.current?.println(
        "We collect a minimal set of statistics such as SNARK proving"
      );
      terminal.current?.println(
        "times and average transaction times across browsers, to help "
      );
      terminal.current?.println(
        "us optimize performance and fix bugs. You can opt out of this"
      );
      terminal.current?.println("in the Settings pane.");
      terminal.current?.println("");

      terminal.current?.newline();

      terminal.current?.println(
        "Press ENTER to find a home planet. This may take up to 120s."
      );
      terminal.current?.println("This will consume a lot of CPU.");

      if (!skipTerminalPromptsRef.current) {
        await terminal.current?.getInput();
      }

      gameUIManager
        .getGameManager()
        .on(GameManagerEvent.InitializedPlayer, () => {
          setTimeout(() => {
            terminal.current?.println("Initializing game...");
            setStep(TerminalPromptStep.ALL_CHECKS_PASS);
          });
        });

      gameUIManager
        .joinGame(async () => {
          terminal.current?.println("Error Joining Game:");
          terminal.current?.println("");
          terminal.current?.println(
            "Could not join the game right now. You can try again.",
            TerminalTextStyle.Red
          );
          terminal.current?.println("");
          terminal.current?.println("Press ENTER to try again:");

          if (!skipTerminalPromptsRef.current) {
            await terminal.current?.getInput();
          } else {
            await sleep(2000);
          }
          return true;
        })
        .catch(() => {
          terminal.current?.println(
            "Initialization failed. Please refresh the page and try again.",
            TerminalTextStyle.Red
          );
        });
    },
    []
  );

  const finalizeQuickPlayGameEntry = useCallback(() => {
    resetInitializationTerminalLogging();
    setStep(TerminalPromptStep.COMPLETE);
    setInitRenderState(InitRenderState.COMPLETE);
    const t = terminalHandle.current;
    t?.clear();
    t?.println(`Welcome to ${GAME_NAME}.`, TerminalTextStyle.Green);
    t?.println("");
    t?.println(
      "This is the Dark Forest interactive JavaScript terminal. Only use this if you know exactly what you're doing."
    );
    t?.println("");
    t?.println("Try running: df.getAccount()");
    t?.println("");
  }, [resetInitializationTerminalLogging]);

  const finalizeTerminalGameEntry = useCallback(
    (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      resetInitializationTerminalLogging();
      setStep(TerminalPromptStep.COMPLETE);
      setInitRenderState(InitRenderState.COMPLETE);
      terminal.current?.clear();

      terminal.current?.println(
        `Welcome to ${GAME_NAME}.`,
        TerminalTextStyle.Green
      );
      terminal.current?.println("");
      terminal.current?.println(
        "This is the Dark Forest interactive JavaScript terminal. Only use this if you know exactly what you're doing."
      );
      terminal.current?.println("");
      terminal.current?.println("Try running: df.getAccount()");
      terminal.current?.println("");
    },
    [resetInitializationTerminalLogging]
  );

  const playEnterTransition = useCallback(async (onComplete: () => void) => {
    if (quickEnterTimeoutRef.current !== null) {
      window.clearTimeout(quickEnterTimeoutRef.current);
    }
    setEnterTransitionVisible(true);
    await new Promise<void>((resolve) => {
      quickEnterTimeoutRef.current = window.setTimeout(() => {
        quickEnterTimeoutRef.current = null;
        resolve();
      }, QUICK_PLAY_ENTER_TRANSITION_MS);
    });
    onComplete();
    setEnterTransitionVisible(false);
  }, []);

  const advanceStateFromAllChecksPass = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      if (skipTerminalPromptsRef.current) {
        if (quickEnterFinalizeScheduledRef.current) {
          return;
        }
        quickEnterFinalizeScheduledRef.current = true;
        if (quickEnterTimeoutRef.current !== null) {
          window.clearTimeout(quickEnterTimeoutRef.current);
        }
        await playEnterTransition(() => {
          finalizeQuickPlayGameEntry();
          quickEnterFinalizeScheduledRef.current = false;
        });
        return;
      }

      terminal.current?.println("");
      if (entryModeRef.current === "standard") {
        terminal.current?.printOption("", "Enter game", { hideKey: true });
        terminal.current?.println("");
        terminal.current?.println(
          "Click Enter game, or press 's' then ENTER to begin in SAFE MODE - plugins disabled"
        );
      } else {
        terminal.current?.println("Press ENTER to begin");
        terminal.current?.println(
          "Press 's' then ENTER to begin in SAFE MODE - plugins disabled"
        );
      }

      const input = await terminal.current?.getInput();

      if (input === "s") {
        const gameUIManager = gameUIManagerRef.current;
        gameUIManager?.getGameManager()?.setSafeMode(true);
      }

      if (entryModeRef.current === "standard") {
        await playEnterTransition(() => finalizeTerminalGameEntry(terminal));
      } else {
        finalizeTerminalGameEntry(terminal);
      }
    },
    [finalizeQuickPlayGameEntry, finalizeTerminalGameEntry, playEnterTransition]
  );

  const advanceStateFromComplete = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const input = (await terminal.current?.getInput()) || "";
      let res = "";
      try {
        // indirect eval call: http://perfectionkills.com/global-eval-what-are-the-options/
        // Indirect eval for global scope (avoids comma-operator lint)
        const indirectEval = globalThis.eval;
        res = indirectEval(input) as string;
        if (res !== undefined) {
          terminal.current?.println(res.toString(), TerminalTextStyle.Text);
        }
      } catch (e) {
        res = e instanceof Error ? e.message : String(e);
        terminal.current?.println(`ERROR: ${res}`, TerminalTextStyle.Red);
      }
      advanceStateFromComplete(terminal);
    },
    []
  );

  const advanceStateFromError = useCallback(async () => {
    await new Promise(() => {});
  }, []);

  const advanceState = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      if (step === TerminalPromptStep.NONE) {
        await advanceStateFromNone(terminal);
      } else if (step === TerminalPromptStep.WALLET_MENU) {
        await advanceStateFromWalletMenu(terminal);
      } else if (step === TerminalPromptStep.LOCAL_ACCOUNT_LIST) {
        await advanceStateFromLocalAccountList(terminal);
      } else if (step === TerminalPromptStep.GENERATE_ACCOUNT) {
        await advanceStateFromGenerateAccount(terminal);
      } else if (step === TerminalPromptStep.IMPORT_ACCOUNT) {
        await advanceStateFromImportAccount(terminal);
      } else if (step === TerminalPromptStep.CONNECT_EXTERNAL) {
        await advanceStateFromConnectExternal(terminal);
      } else if (step === TerminalPromptStep.RECONNECT_EXTERNAL) {
        await advanceStateFromReconnectExternal(terminal);
      } else if (step === TerminalPromptStep.ACCOUNT_SET) {
        await advanceStateFromAccountSet(terminal);
      } else if (step === TerminalPromptStep.CHECK_FEE_JUICE) {
        await advanceStateFromCheckFeeJuice(terminal);
      } else if (step === TerminalPromptStep.FETCHING_ETH_DATA) {
        await advanceStateFromFetchingEthData(terminal);
      } else if (step === TerminalPromptStep.ASK_ADD_ACCOUNT) {
        await advanceStateFromAskAddAccount(terminal);
      } else if (step === TerminalPromptStep.ADD_ACCOUNT) {
        await advanceStateFromAddAccount(terminal);
      } else if (step === TerminalPromptStep.NO_HOME_PLANET) {
        await advanceStateFromNoHomePlanet(terminal);
      } else if (step === TerminalPromptStep.ALL_CHECKS_PASS) {
        await advanceStateFromAllChecksPass(terminal);
      } else if (step === TerminalPromptStep.COMPLETE) {
        await advanceStateFromComplete(terminal);
      } else if (step === TerminalPromptStep.ERROR) {
        await advanceStateFromError();
      }
    },
    [
      step,
      advanceStateFromAccountSet,
      advanceStateFromCheckFeeJuice,
      advanceStateFromAddAccount,
      advanceStateFromAllChecksPass,
      advanceStateFromAskAddAccount,
      advanceStateFromConnectExternal,
      advanceStateFromComplete,
      advanceStateFromError,
      advanceStateFromFetchingEthData,
      advanceStateFromGenerateAccount,
      advanceStateFromImportAccount,
      advanceStateFromLocalAccountList,
      advanceStateFromNoHomePlanet,
      advanceStateFromNone,
      advanceStateFromReconnectExternal,
      advanceStateFromWalletMenu,
    ]
  );

  useEffect(() => {
    const uiEmitter = UIEmitter.getInstance();
    uiEmitter.emit(UIEmitterEvent.UIChange);
  }, [initRenderState]);

  useEffect(() => {
    const gameUiManager = gameUIManagerRef.current;
    if (!terminalVisible && gameUiManager) {
      const tutorialManager = TutorialManager.getInstance(gameUiManager);
      tutorialManager.acceptInput(TutorialState.Terminal);
    }
  }, [terminalVisible]);

  const handleEntryModeSelected = useCallback((choice: EntryModeChoice) => {
    setEntryMode(choice);
    if (choice === "quick") {
      setTerminalVisible(false);
    } else {
      setTerminalVisible(true);
    }
  }, []);

  useEffect(() => {
    if (entryMode === "pending") return;
    if (entryMode === "quick" && !quickBootstrapDoneRef.current) return;
    if (terminalHandle.current && topLevelContainer.current) {
      void advanceState(terminalHandle);
    }
  }, [terminalHandle, topLevelContainer, advanceState, entryMode]);

  const terminalOptionMode: TerminalOptionMode =
    entryMode === "standard" || entryMode === "quick" ? "buttons" : "classic";

  return (
    <>
      <ConnectionSettingsModal
        open={connectionSettingsOpen}
        onClose={() => setConnectionSettingsOpen(false)}
      />
      <QuickJoinSettingsModal
        open={quickJoinSettingsOpen}
        onClose={() => setQuickJoinSettingsOpen(false)}
        onPreferenceSaved={refreshLocalAccountCount}
      />
      {entryMode === "pending" && (
        <GameLandingEntryOverlay
          onSelect={handleEntryModeSelected}
          onConfigureQuickJoin={() => setQuickJoinSettingsOpen(true)}
        />
      )}
      {enterTransitionVisible && <EnterTransition aria-hidden />}
      {refreshTransitionVisible && (
        <RefreshPageTransition aria-hidden>
          <RefreshTransitionHud>
            <span>RECALIBRATING STARFIELD</span>
            <strong>REFRESHING UNIVERSE</strong>
          </RefreshTransitionHud>
        </RefreshPageTransition>
      )}
      <Wrapper initRender={initRenderState} terminalEnabled={terminalVisible}>
        <GameWindowWrapper
          initRender={initRenderState}
          terminalEnabled={terminalVisible}
        >
          {gameUIManagerRef.current &&
            topLevelContainer.current &&
            gameManager && (
              <TopLevelDivProvider value={topLevelContainer.current}>
                <UIManagerProvider value={gameUIManagerRef.current}>
                  <GameWindowLayout
                    terminalVisible={terminalVisible}
                    setTerminalVisible={setTerminalVisible}
                    universeView={universeView}
                    setUniverseView={setUniverseView}
                  />
                </UIManagerProvider>
              </TopLevelDivProvider>
            )}
        </GameWindowWrapper>
        <TerminalToggler
          terminalEnabled={terminalVisible}
          setTerminalEnabled={setTerminalVisible}
          initRender={initRenderState}
        />
        <TerminalWrapper
          initRender={initRenderState}
          terminalEnabled={terminalVisible}
        >
          <Terminal
            ref={terminalHandle as React.Ref<TerminalHandle>}
            promptCharacter={"$"}
            optionMode={terminalOptionMode}
          />
          <StartupLoadingStatus
            loadingPhase={loadingPhase}
            elapsedSeconds={loadingElapsedSeconds}
          />
          {initRenderState === InitRenderState.COMPLETE &&
            indexerRef.current && (
              <BlockSyncStatus connection={indexerRef.current} />
            )}
        </TerminalWrapper>
        <div ref={topLevelContainer}></div>
      </Wrapper>
    </>
  );
}

const CopyAccountAddressRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
`;

const StartupStatusBar = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px solid ${dfstyles.colors.borderDark};
  padding: 7px 8px;
  font-family: monospace;
  font-size: 11px;
  color: ${dfstyles.colors.subtext};
  background: rgba(0, 0, 0, 0.2);
`;

const StartupStatusHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: ${dfstyles.colors.text};

  strong {
    color: ${dfstyles.colors.dfgreen};
    font-weight: 400;
  }
`;

const StartupStatusDetail = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  span:not(:last-child)::after {
    content: "·";
    margin-left: 8px;
    color: ${dfstyles.colors.subbertext};
  }
`;

const CopyAccountAddressButtonElement = styled.button`
  color: ${dfstyles.colors.dfgreen};
  background: rgba(0, 220, 130, 0.08);
  border: 1px solid ${dfstyles.colors.dfgreen};
  border-radius: 2px;
  cursor: pointer;
  font: inherit;
  padding: 2px 8px;

  &:hover {
    color: ${dfstyles.colors.background};
    background: ${dfstyles.colors.dfgreen};
  }

  &:focus,
  &:focus-visible {
    outline: none;
    box-shadow: none;
  }
`;

const CopyAccountAddressStatus = styled.span`
  color: ${dfstyles.colors.subtext};
`;

const EnterTransition = styled.div`
  position: fixed;
  inset: 0;
  z-index: 4000;
  pointer-events: none;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4vmin;
    height: 4vmin;
    border-radius: 50%;
    background: #000;
    transform: translate(-50%, -50%) scale(0);
    animation: quick-play-enter-core ${QUICK_PLAY_ENTER_TRANSITION_MS}ms
      forwards;
  }

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle at 50% 45%,
      rgba(0, 220, 130, 0.22),
      transparent 55%
    );
    opacity: 0;
    animation: quick-play-enter-flash ${QUICK_PLAY_ENTER_TRANSITION_MS}ms
      ease-out forwards;
  }

  @keyframes quick-play-enter-core {
    0% {
      transform: translate(-50%, -50%) scale(0);
      box-shadow: 0 0 0 0 transparent;
    }
    4% {
      transform: translate(-50%, -50%) scale(1);
      box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.9),
        0 0 60px 20px rgba(0, 220, 130, 0.8),
        0 0 120px 40px rgba(187, 187, 187, 0.3);
    }
    15% {
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.6),
        0 0 40px 10px rgba(0, 220, 130, 0.6),
        0 0 80px 20px rgba(187, 187, 187, 0.2);
    }
    60% {
      transform: translate(-50%, -50%) scale(1.4);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.4),
        0 0 80px 20px rgba(0, 220, 130, 0.8),
        0 0 160px 40px rgba(187, 187, 187, 0.2);
    }
    100% {
      transform: translate(-50%, -50%) scale(150);
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @keyframes quick-play-enter-flash {
    0% {
      opacity: 0;
    }
    12% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
`;

const RefreshPageTransition = styled.div`
  position: fixed;
  inset: 0;
  z-index: 4500;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% 50%,
      rgba(0, 220, 130, 0.18),
      transparent 30%
    ),
    linear-gradient(
      90deg,
      transparent 49.85%,
      rgba(0, 220, 130, 0.32) 50%,
      transparent 50.15%
    ),
    linear-gradient(
      0deg,
      transparent 49.85%,
      rgba(0, 220, 130, 0.32) 50%,
      transparent 50.15%
    ),
    rgba(0, 0, 0, 0.18);
  animation: refresh-page-veil ${REFRESH_PAGE_TRANSITION_MS}ms ease-in forwards;

  &::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4vmin;
    height: 4vmin;
    border-radius: 50%;
    background: #000;
    transform: translate(-50%, -50%) scale(0);
    animation: refresh-page-core ${REFRESH_PAGE_TRANSITION_MS}ms forwards;
  }

  &::after {
    content: "";
    position: absolute;
    inset: -35%;
    background:
      repeating-linear-gradient(
        90deg,
        transparent 0 22px,
        rgba(0, 220, 130, 0.16) 23px,
        transparent 26px
      ),
      radial-gradient(
        circle at 50% 50%,
        transparent 0 10vmin,
        rgba(255, 255, 255, 0.65) 10.3vmin,
        transparent 10.8vmin,
        transparent 18vmin,
        rgba(0, 220, 130, 0.58) 18.4vmin,
        transparent 19.2vmin,
        transparent 30vmin,
        rgba(0, 220, 130, 0.28) 30.5vmin,
        transparent 31.5vmin
      );
    opacity: 0;
    mix-blend-mode: screen;
    transform: scale(0.55) rotate(0deg);
    animation: refresh-page-orbits ${REFRESH_PAGE_TRANSITION_MS}ms ease-out
      forwards;
  }

  @keyframes refresh-page-veil {
    0% {
      opacity: 0;
      filter: saturate(1) contrast(1);
    }
    8% {
      opacity: 1;
      filter: saturate(1.8) contrast(1.2);
    }
    72% {
      opacity: 1;
      filter: saturate(2.4) contrast(1.45);
    }
    100% {
      opacity: 1;
      filter: saturate(0.7) contrast(1.9);
    }
  }

  @keyframes refresh-page-core {
    0% {
      transform: translate(-50%, -50%) scale(0);
      box-shadow: 0 0 0 0 transparent;
    }
    4% {
      transform: translate(-50%, -50%) scale(1);
      box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.95),
        0 0 50px 16px rgba(0, 220, 130, 0.95),
        0 0 120px 46px rgba(0, 140, 255, 0.28);
    }
    22% {
      transform: translate(-50%, -50%) scale(1.15);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.75),
        0 0 72px 22px rgba(0, 220, 130, 0.9),
        0 0 170px 56px rgba(0, 140, 255, 0.34);
    }
    58% {
      transform: translate(-50%, -50%) scale(1.45);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.5),
        0 0 110px 32px rgba(0, 220, 130, 0.95),
        0 0 220px 76px rgba(255, 255, 255, 0.16);
    }
    100% {
      transform: translate(-50%, -50%) scale(170);
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @keyframes refresh-page-orbits {
    0% {
      opacity: 0;
      transform: scale(0.55) rotate(-12deg);
      filter: blur(4px);
    }
    10% {
      opacity: 1;
      filter: blur(0);
    }
    62% {
      opacity: 0.95;
      transform: scale(1.08) rotate(32deg);
    }
    100% {
      opacity: 0;
      transform: scale(1.55) rotate(78deg);
      filter: blur(3px);
    }
  }
`;

const RefreshTransitionHud = styled.div`
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  display: flex;
  width: min(520px, calc(100vw - 48px));
  height: min(520px, calc(100vw - 48px));
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border-radius: 50%;
  color: ${dfstyles.colors.dfgreen};
  text-align: center;
  text-shadow:
    0 0 10px rgba(0, 220, 130, 0.9),
    0 0 28px rgba(0, 220, 130, 0.58);
  transform: translate(-50%, -50%) scale(0.86);
  animation: refresh-hud-collapse ${REFRESH_PAGE_TRANSITION_MS}ms ease-in
    forwards;

  &::before,
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid rgba(0, 220, 130, 0.82);
    box-shadow:
      inset 0 0 32px rgba(0, 220, 130, 0.24),
      0 0 42px rgba(0, 220, 130, 0.38);
  }

  &::before {
    animation: refresh-hud-spin ${REFRESH_PAGE_TRANSITION_MS}ms linear forwards;
  }

  &::after {
    inset: 8%;
    border-color: rgba(255, 255, 255, 0.48);
    border-style: dashed;
    animation: refresh-hud-spin-reverse ${REFRESH_PAGE_TRANSITION_MS}ms linear
      forwards;
  }

  span {
    color: ${dfstyles.colors.subbertext};
    font-size: clamp(10px, 1.2vw, 14px);
    letter-spacing: 0.28em;
    text-transform: uppercase;
    opacity: 0;
    animation: refresh-hud-text ${REFRESH_PAGE_TRANSITION_MS}ms ease-out
      forwards;
  }

  strong {
    margin-top: 10px;
    color: ${dfstyles.colors.textLight};
    font-size: clamp(18px, 3vw, 34px);
    font-weight: 400;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    opacity: 0;
    animation: refresh-hud-text ${REFRESH_PAGE_TRANSITION_MS}ms ease-out 80ms
      forwards;
  }

  @keyframes refresh-hud-collapse {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.62);
    }
    12% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    58% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.08);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.08);
      filter: blur(10px);
    }
  }

  @keyframes refresh-hud-spin {
    0% {
      transform: rotate(0deg) scale(0.82);
    }
    100% {
      transform: rotate(390deg) scale(1.42);
    }
  }

  @keyframes refresh-hud-spin-reverse {
    0% {
      transform: rotate(0deg) scale(1.18);
    }
    100% {
      transform: rotate(-300deg) scale(0.72);
    }
  }

  @keyframes refresh-hud-text {
    0% {
      opacity: 0;
      transform: translateY(10px);
    }
    16% {
      opacity: 1;
      transform: translateY(0);
    }
    62% {
      opacity: 1;
      transform: translateY(0);
    }
    100% {
      opacity: 0;
      transform: translateY(-8px) scale(0.92);
    }
  }
`;
