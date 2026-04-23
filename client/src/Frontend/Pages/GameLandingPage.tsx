import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import type { Aliased } from "@aztec/aztec.js/wallet";
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
} from "../../config/connection";
import { getProverEnabled, getSponsorMode } from "../../config/env";
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
import {
  GameWindowWrapper,
  InitRenderState,
  TerminalToggler,
  TerminalWrapper,
  Wrapper,
} from "../Components/GameLandingPageComponents";
import { MythicLabelText } from "../Components/Labels/MythicLabel";
import { TextPreview } from "../Components/TextPreview";
import {
  type ExternalWalletConnectionResult,
  RememberedExternalWalletAccountMismatchError,
  useExternalWallet,
} from "../Contexts/ExternalWalletContext";
import { TopLevelDivProvider, UIManagerProvider } from "../Utils/AppHooks";
import { Incompatibility, unsupportedFeatures } from "../Utils/BrowserChecks";
import { TerminalTextStyle } from "../Utils/TerminalTypes";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";
import { GameWindowLayout } from "../Views/GameWindowLayout";
import { Terminal, TerminalHandle } from "../Views/Terminal";

function formatFeeJuice(amount: bigint): string {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
}

type SelectedWalletMode = "local" | "external" | null;
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
  const [terminalVisible, setTerminalVisible] = useState(true);
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
  const externalWalletSimulationSupportRef =
    useRef<ExternalWalletSimulationSupport | null>(null);
  const selectedWalletModeRef = useRef<SelectedWalletMode>(null);
  const walletLockStateRef = useRef<WalletLockState>("unselected");
  const [localAccountCount, setLocalAccountCount] = useState(
    () => new KeyStore("dfpunk").listAccounts().length
  );
  const [step, setStep] = useState(TerminalPromptStep.NONE);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>({
    step: "done",
  });
  const contractAddress = contract
    ? address(contract)
    : address(CORE_CONTRACT_ADDRESS);
  const isLobby = contractAddress !== address(CORE_CONTRACT_ADDRESS);

  const sponsorMode = getSponsorMode();
  const refreshLocalAccountCount = useCallback(() => {
    setLocalAccountCount(new KeyStore("dfpunk").listAccounts().length);
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
    setStep(TerminalPromptStep.WALLET_MENU);
  }, [clearUnlockedWalletState]);

  const selectWalletMode = useCallback(
    async (mode: Exclude<SelectedWalletMode, null>) => {
      await clearUnlockedWalletState();
      selectedWalletModeRef.current = mode;
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
          terminal.current?.print(`(${index + 1}) `, TerminalTextStyle.Sub);
          terminal.current?.println(
            account.alias
              ? `${account.alias} (${account.item.toString()})`
              : account.item.toString()
          );
        });
        terminal.current?.print("(c) ", TerminalTextStyle.Sub);
        terminal.current?.println("Cancel");

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
          terminal.current?.print(`(${index + 1}) `, TerminalTextStyle.Sub);
          terminal.current?.println(provider.name);
        });
        terminal.current?.print("(r) ", TerminalTextStyle.Sub);
        terminal.current?.println("Rescan");
        terminal.current?.print("(b) ", TerminalTextStyle.Sub);
        terminal.current?.println("Back");

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
        terminal.current?.print("(y) ", TerminalTextStyle.Sub);
        terminal.current?.println("Emojis match");
        terminal.current?.print("(c) ", TerminalTextStyle.Sub);
        terminal.current?.println("Cancel");

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
              terminal.current?.print("(r) ", TerminalTextStyle.Sub);
              terminal.current?.println("Rescan");
              terminal.current?.print("(b) ", TerminalTextStyle.Sub);
              terminal.current?.println("Back");

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
      if (lastLoggedGamestateSubStepRef.current !== nextSubStep) {
        const suffix = loadingPhase.detail ? `: ${loadingPhase.detail}` : "...";
        printInitializationMilestone(
          `Loading game data (step ${nextSubStep})${suffix}`
        );
        lastLoggedGamestateSubStepRef.current = nextSubStep;
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

      if (selectedMode === null) {
        if (rememberedSession) {
          terminal.current?.print("(r) ", TerminalTextStyle.Sub);
          terminal.current?.println(
            `Reconnect last extension wallet (${rememberedSession.providerName}, ${rememberedSession.accountAddress}).`
          );
        }

        terminal.current?.print("(l) ", TerminalTextStyle.Sub);
        terminal.current?.println("Use local wallet.");
        terminal.current?.print("(e) ", TerminalTextStyle.Sub);
        terminal.current?.println("Connect extension wallet.");
        terminal.current?.println("");
        terminal.current?.println(
          "Select a wallet mode:",
          TerminalTextStyle.Text
        );

        const userInput = await terminal.current?.getInput();
        if (userInput === "l") {
          await selectWalletMode("local");
          await advanceStateFromWalletMenu(terminal);
          return;
        }
        if (userInput === "e") {
          await selectWalletMode("external");
          setStep(TerminalPromptStep.CONNECT_EXTERNAL);
          return;
        }
        if (userInput === "r" && rememberedSession) {
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
          terminal.current?.print("(a) ", TerminalTextStyle.Sub);
          terminal.current?.println("Login with existing local account.");
        }

        terminal.current?.print("(n) ", TerminalTextStyle.Sub);
        terminal.current?.println("Generate new Aztec account.");
        terminal.current?.print("(i) ", TerminalTextStyle.Sub);
        terminal.current?.println("Import account.");
        terminal.current?.print("(b) ", TerminalTextStyle.Sub);
        terminal.current?.println("Back to wallet selection.");
        terminal.current?.println("");
        terminal.current?.println("Select an option:", TerminalTextStyle.Text);

        const userInput = await terminal.current?.getInput();
        if (userInput === "a" && localAccountCount > 0) {
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
        } else if (userInput === "n") {
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
        } else if (userInput === "i") {
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
        } else if (userInput === "b" && !isWalletSelectionLocked()) {
          await clearUnlockedWalletState();
          selectedWalletModeRef.current = null;
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
          terminal.current?.print(`(${i + 1}): `, TerminalTextStyle.Sub);
          terminal.current?.println(`${accounts[i].address}`);
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
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      if (sponsorMode) {
        terminal.current?.println(
          "Sponsor mode enabled. Deploying account without FeeJuice check..."
        );
        await walletManager.deployActiveAccountIfNeeded((msg) =>
          terminal.current?.println(msg, TerminalTextStyle.Sub)
        );
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      // Pre-check balance so we can skip the faucet warning when already funded.
      try {
        const bal = await walletManager.getBalance();
        if (bal > 0n) {
          terminal.current?.println(
            "FeeJuice OK. Deploying account if needed..."
          );
          await walletManager.deployActiveAccountIfNeeded((msg) =>
            terminal.current?.println(msg, TerminalTextStyle.Sub)
          );
          setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        } else {
          setStep(TerminalPromptStep.CHECK_FEE_JUICE);
        }
      } catch (e) {
        console.error("Failed to pre-check FeeJuice balance:", e);
        setStep(TerminalPromptStep.CHECK_FEE_JUICE);
      }
    },
    [sponsorMode]
  );

  const advanceStateFromCheckFeeJuice = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const walletManager = walletManagerRef.current;
      if (!walletManager) throw new Error("no wallet manager");
      if (walletManager.isExternalWallet()) {
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      if (sponsorMode) {
        terminal.current?.println(
          "Sponsor mode enabled. Deploying account without FeeJuice faucet..."
        );
        await walletManager.deployActiveAccountIfNeeded((msg) =>
          terminal.current?.println(msg, TerminalTextStyle.Sub)
        );
        setStep(TerminalPromptStep.FETCHING_ETH_DATA);
        return;
      }

      let opened = false;
      let bal: bigint = 0n;
      let firstRender = true;
      let balanceLinePrinted = false;
      let requeryInFlight = false;
      // One "balance line" is printed as:
      // - print(...)          -> 1 fragment
      // - printLink/print(...) -> 1 fragment
      // - newline()           -> 1 fragment (<br/>)
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
              void requery().catch(() => {});
            },
            TerminalTextStyle.Blue
          );
        }
        terminal.current?.newline();
      };

      const requery = async () => {
        if (requeryInFlight) return;
        requeryInFlight = true;
        let spinnerInterval: ReturnType<typeof setInterval> | undefined;
        try {
          // Replace the previous balance line with a rotating loading icon.
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

          const next = await walletManager.getBalance();
          bal = next;

          // Keep the loading rotation a bit longer for smoother UX.
          await sleep(1500);

          if (spinnerInterval) clearInterval(spinnerInterval);
          spinnerInterval = undefined;

          // Replace loading with final value (single-line; no stacking)
          if (balanceLinePrinted) {
            terminal.current?.removeLast(BALANCE_LINE_FRAGMENTS);
          }
          printBalanceLine(formatFeeJuice(next), "ready");
          balanceLinePrinted = true;
        } finally {
          if (spinnerInterval) clearInterval(spinnerInterval);
          requeryInFlight = false;
        }
      };

      while (bal === 0n) {
        if (firstRender) {
          firstRender = false;
          terminal.current?.println("");
          terminal.current?.println(
            "⚠ FeeJuice is required to continue.",
            TerminalTextStyle.Yellow
          );
          terminal.current?.println(
            "Step 1: open faucet, Step 2: come back & re-check.",
            TerminalTextStyle.Subber
          );
          terminal.current?.println("");
          terminal.current?.printLink(
            "↗ Open gregojuice faucet",
            () => {
              if (!opened) opened = true;
              window.open(
                "https://bridge.gregojuice.anothercoffeefor.me/",
                "_blank",
                "noopener,noreferrer"
              );
            },
            TerminalTextStyle.Blue
          );
          terminal.current?.newline();
          terminal.current?.println(
            "You can click re-query, or just wait a few seconds for auto-refresh."
          );
        }

        await requery();

        if (bal > 0n) {
          terminal.current?.println(
            "FeeJuice OK. Deploying account if needed..."
          );
          await walletManager.deployActiveAccountIfNeeded((msg) =>
            terminal.current?.println(msg, TerminalTextStyle.Sub)
          );
          setStep(TerminalPromptStep.FETCHING_ETH_DATA);
          return;
        }

        await sleep(8000);
      }
    },
    [sponsorMode]
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
          walletManager.getActiveAddress()!
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
            gamestateSubStepTotal
          ) =>
            setLoadingPhase((prev) =>
              prev.step === "gamestate"
                ? {
                    ...prev,
                    detail,
                    percent,
                    gamestateSubStep,
                    gamestateSubStepTotal,
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
      terminal.current?.println("Welcome to DARK FOREST.");

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

      await terminal.current?.getInput();

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

          await terminal.current?.getInput();
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

  const advanceStateFromAllChecksPass = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      terminal.current?.println("");
      terminal.current?.println("Press ENTER to begin");
      terminal.current?.println(
        "Press 's' then ENTER to begin in SAFE MODE - plugins disabled"
      );

      const input = await terminal.current?.getInput();

      if (input === "s") {
        const gameUIManager = gameUIManagerRef.current;
        gameUIManager?.getGameManager()?.setSafeMode(true);
      }

      resetInitializationTerminalLogging();
      setStep(TerminalPromptStep.COMPLETE);
      setInitRenderState(InitRenderState.COMPLETE);
      terminal.current?.clear();

      terminal.current?.println(
        "Welcome to the Dark Forest.",
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

  useEffect(() => {
    if (terminalHandle.current && topLevelContainer.current) {
      advanceState(terminalHandle);
    }
  }, [terminalHandle, topLevelContainer, advanceState]);

  return (
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
        />
        {initRenderState === InitRenderState.COMPLETE && indexerRef.current && (
          <BlockSyncStatus connection={indexerRef.current} />
        )}
      </TerminalWrapper>
      <div ref={topLevelContainer}></div>
    </Wrapper>
  );
}
