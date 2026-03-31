import { START_BLOCK } from "@dfpunk/contracts";
import React, {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import GameManager from "../../Backend/GameLogic/GameManager";
import GameUIManager from "../../Backend/GameLogic/GameUIManager";
import {
  getEffectiveIndexerBootstrapUrl,
  getEffectiveNodeUrl,
  getEffectiveProverUrl,
} from "../../config/connection";
import { getProverEnabled } from "../../config/env";
import {
  createIndexerConnection,
  type IndexerConnection,
  type IndexerConnectionConfig,
} from "../../Session/Indexer/IndexerConnection";
import {
  createWalletManager,
  WalletManager,
} from "../../Session/WalletManager";
import { KeyStore } from "../../Session/WalletManager/KeyStore";
import {
  type ExternalWalletConnectionResult,
  useExternalWallet,
} from "../Contexts/ExternalWalletContext";
import type { TerminalHandle } from "../Views/Terminal";
import {
  describeMissingExternalWalletSupport,
  type ExternalWalletSimulationSupport,
  formatBytes,
  getWalletProgressBucket,
  LOADING_STEP_LABELS,
  type LoadingPhase,
  type SelectedWalletMode,
  TerminalPromptStep,
  type WalletLockState,
} from "./GameLandingPageShared";
import { TerminalTextStyle } from "./TerminalTypes";

type UseGameLandingSessionParams = {
  sponsorMode: boolean;
  terminalHandle: MutableRefObject<TerminalHandle | undefined>;
  setGameManager: Dispatch<SetStateAction<GameManager | undefined>>;
  setStep: Dispatch<SetStateAction<TerminalPromptStep>>;
  setTerminalVisible: Dispatch<SetStateAction<boolean>>;
};

export function useGameLandingSession({
  sponsorMode,
  terminalHandle,
  setGameManager,
  setStep,
  setTerminalVisible,
}: UseGameLandingSessionParams) {
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

  const gameUIManagerRef = useRef<GameUIManager | undefined>(undefined);
  const walletManagerRef = useRef<WalletManager | undefined>(undefined);
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
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>({
    step: "done",
  });

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
    [terminalHandle]
  );

  const printInitializationMilestone = useCallback(
    (message: string) => {
      terminalHandle.current?.println(message, TerminalTextStyle.Sub);
    },
    [terminalHandle]
  );

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
    [
      resetInitializationTerminalLogging,
      setGameManager,
      setStep,
      setTerminalVisible,
      terminalHandle,
    ]
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
  }, [
    loadingPhase,
    printInitializationMilestone,
    printInitializationStage,
    terminalHandle,
  ]);

  return {
    cancelConnection,
    confirmConnection,
    connectWallet,
    discoverWallets,
    ensureEmbeddedWalletManager,
    ensureIndexerConnection,
    enterFatalWalletSessionLoss,
    externalModeBannerPrintedRef,
    externalWalletSimulationSupportRef,
    fatalWalletSessionPrintedRef,
    gameUIManagerRef,
    getRememberedSession,
    indexerRef,
    initializeExternalWalletManager,
    initiateConnection,
    isWalletSelectionLocked,
    loadingPhase,
    localAccountCount,
    lockWalletSelection,
    markWalletSelectionInGame,
    reconnectRememberedWallet,
    refreshLocalAccountCount,
    releaseWalletSession,
    rememberSession,
    resetInitializationTerminalLogging,
    selectedWalletModeRef,
    setLoadingPhase,
    walletLockMessagePrintedRef,
    walletLockStateRef,
    walletManagerRef,
    clearUnlockedWalletState,
  };
}
