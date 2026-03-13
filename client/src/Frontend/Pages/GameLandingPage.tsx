import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { APP_VERSION, CHAIN_DISPLAY_NAME, GAME_NAME } from "@dfpunk/constants";
import {
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  START_BLOCK,
} from "@dfpunk/contracts";
import { ConfigContract } from "@dfpunk/contracts/artifacts/Config";
import { address } from "@dfpunk/serde";
import { reverse } from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

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
} from "../../config/connection";
import { getProverEnabled } from "../../config/env";
import { makeContractsAPI } from "../../ContractsAPI/ContractsAPI";
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
import {
  GameWindowWrapper,
  InitRenderState,
  TerminalToggler,
  TerminalWrapper,
  Wrapper,
} from "../Components/GameLandingPageComponents";
import { MythicLabelText } from "../Components/Labels/MythicLabel";
import { TextPreview } from "../Components/TextPreview";
import { TopLevelDivProvider, UIManagerProvider } from "../Utils/AppHooks";
import { Incompatibility, unsupportedFeatures } from "../Utils/BrowserChecks";
import { TerminalTextStyle } from "../Utils/TerminalTypes";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";
import { GameWindowLayout } from "../Views/GameWindowLayout";
import { Terminal, TerminalHandle } from "../Views/Terminal";

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
}

const LOADING_STEP_LABELS: Record<LoadingPhase["step"], string> = {
  connecting: "Connecting to node",
  wallet: "Initializing wallet",
  snapshot: "Downloading snapshot",
  syncing: "Syncing blocks",
  contracts: "Building contracts",
  gamestate: "Loading game data",
  done: "Done",
};

const LOADING_STEP_ORDER: LoadingPhase["step"][] = [
  "connecting",
  "wallet",
  "snapshot",
  "syncing",
  "contracts",
  "gamestate",
];

function LoadingOverlay({ phase }: { phase: LoadingPhase }) {
  const currentIdx = LOADING_STEP_ORDER.indexOf(phase.step);
  const hasPercent = phase.percent != null;

  return (
    <div
      style={{
        position: "fixed",
        left: "12px",
        bottom: "12px",
        zIndex: 1200,
        padding: "10px 14px",
        background: "rgba(10, 10, 10, 0.92)",
        border: "1px solid #4d4d4d",
        color: "#e6e6e6",
        fontSize: "12px",
        fontFamily: "monospace",
        lineHeight: 1.6,
        minWidth: "260px",
      }}
    >
      <div style={{ marginBottom: "6px", color: "#999" }}>Initializing...</div>
      {LOADING_STEP_ORDER.map((s, i) => {
        const isCurrent = s === phase.step;
        const isDone = i < currentIdx;
        const isPending = i > currentIdx;
        let marker: string;
        let color: string;
        if (isDone) {
          marker = "\u2713";
          color = "#5b5";
        } else if (isCurrent) {
          marker = "\u25b8";
          color = "#fff";
        } else {
          marker = "\u00b7";
          color = "#555";
        }
        const label = LOADING_STEP_LABELS[s];
        return (
          <div
            key={s}
            style={{
              color,
              opacity: isPending ? 0.5 : 1,
            }}
          >
            <span style={{ display: "inline-block", width: "16px" }}>
              {marker}
            </span>
            {label}
            {isCurrent && phase.detail ? (
              <span style={{ color: "#aaa" }}> — {phase.detail}</span>
            ) : null}
          </div>
        );
      })}
      <div
        style={{
          marginTop: "8px",
          width: "100%",
          height: "4px",
          background: "#2a2a2a",
          border: "1px solid #3a3a3a",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: hasPercent
              ? `${Math.max(0, Math.min(100, phase.percent!))}%`
              : undefined,
            background: hasPercent ? "#e6e6e6" : "#8a8a8a",
            transition: hasPercent ? "width 120ms linear" : "none",
            animation: hasPercent
              ? undefined
              : "loadingIndeterminate 1.2s ease-in-out infinite",
          }}
        />
      </div>
      <style>{`
        @keyframes loadingIndeterminate {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 40%; margin-left: 30%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}

const enum TerminalPromptStep {
  NONE,
  COMPATIBILITY_CHECKS_PASSED,
  DISPLAY_ACCOUNTS,
  GENERATE_ACCOUNT,
  IMPORT_ACCOUNT,
  ACCOUNT_SET,
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
  const location = useLocation();
  const terminalHandle = useRef<TerminalHandle | undefined>(undefined);
  const gameUIManagerRef = useRef<GameUIManager | undefined>(undefined);
  const topLevelContainer = useRef<HTMLDivElement | null>(null);

  const [gameManager, setGameManager] = useState<GameManager | undefined>();
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [initRenderState, setInitRenderState] = useState(InitRenderState.NONE);
  const [walletManager, setWalletManager] = useState<
    WalletManager | undefined
  >();
  const indexerRef = useRef<IndexerConnection | undefined>(undefined);
  const [step, setStep] = useState(TerminalPromptStep.NONE);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>({
    step: "connecting",
  });

  const params = new URLSearchParams(location.search);
  const selectedAddress = params.get("account");
  const contractAddress = contract
    ? address(contract)
    : address(CORE_CONTRACT_ADDRESS);
  const isLobby = contractAddress !== address(CORE_CONTRACT_ADDRESS);

  useEffect(() => {
    let destroyed = false;
    const bootstrapUrl = getEffectiveIndexerBootstrapUrl();
    setLoadingPhase({ step: "connecting" });
    (async () => {
      try {
        const nodeUrl = getEffectiveNodeUrl();

        setLoadingPhase({ step: "wallet" });
        const wm = await createWalletManager({
          nodeUrl,
          storagePrefix: "dfpunk",
          pxeConfig: {
            proverEnabled: getProverEnabled(),
          },
        });
        if (destroyed) {
          wm.destroy();
          return;
        }

        const indexerConfig: IndexerConnectionConfig = {
          nodeUrl,
          startBlock: START_BLOCK,
          debounceMs: 1000,
          pollIntervalMs: 2000,
          maxBlocksPerRequest: 100,
        };
        if (bootstrapUrl) {
          indexerConfig.bootstrapUrl = bootstrapUrl;
          setLoadingPhase({ step: "snapshot" });
        }
        indexerConfig.onSnapshotProgress = (progress) => {
          if (destroyed) return;
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
          if (destroyed) return;
          const pct = latest > 0 ? Math.round((to / latest) * 100) : undefined;
          setLoadingPhase({
            step: "syncing",
            detail: `Block ${to} / ${latest}`,
            percent: pct,
          });
        };
        if (!bootstrapUrl) {
          setLoadingPhase({ step: "syncing", detail: "Preparing..." });
        }
        const { connection } = await createIndexerConnection(indexerConfig);
        if (destroyed) {
          connection.destroy();
          wm.destroy();
          return;
        }

        indexerRef.current = connection;
        setLoadingPhase({ step: "done" });
        setWalletManager(wm);
      } catch (e) {
        setLoadingPhase({ step: "done" });
        console.error("Failed to initialize Aztec session:", e);
        alert("Error connecting to Aztec network");
      }
    })();
    return () => {
      destroyed = true;
    };
  }, []);

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
        terminal.current?.print(
          `${issues.length.toString()} errors found. `,
          TerminalTextStyle.Red
        );
        terminal.current?.println("Please resolve them and refresh the page.");
        setStep(TerminalPromptStep.TERMINATED);
      } else {
        setStep(TerminalPromptStep.COMPATIBILITY_CHECKS_PASSED);
      }
    },
    []
  );

  const advanceStateFromCompatibilityPassed = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
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

      const accounts = walletManager?.getAccounts() ?? [];
      terminal.current?.println(
        `Found ${accounts.length} accounts on this device.`
      );
      terminal.current?.println(``);

      if (accounts.length > 0) {
        terminal.current?.print("(a) ", TerminalTextStyle.Sub);
        terminal.current?.println("Login with existing account.");
      }

      terminal.current?.print("(n) ", TerminalTextStyle.Sub);
      terminal.current?.println(`Generate new Aztec account.`);
      terminal.current?.print("(i) ", TerminalTextStyle.Sub);
      terminal.current?.println(`Import account.`);
      terminal.current?.println(``);
      terminal.current?.println(`Select an option:`, TerminalTextStyle.Text);

      if (selectedAddress !== null) {
        terminal.current?.println(
          `Selecting account ${selectedAddress} from url...`,
          TerminalTextStyle.Green
        );

        const account = reverse(walletManager?.getAccounts() ?? []).find(
          (a) => a.address === selectedAddress
        );
        if (!account) {
          terminal.current?.println(
            "Unrecognized account found in url.",
            TerminalTextStyle.Red
          );
          return;
        }

        try {
          terminal.current?.println("Restoring account...");
          const result = await walletManager?.switchAccount(
            account.address,
            (msg) => terminal.current?.println(msg, TerminalTextStyle.Sub)
          );
          if (result?.deployed) {
            terminal.current?.println(
              "Deployed to new network.",
              TerminalTextStyle.Green
            );
          } else {
            terminal.current?.println("Done.", TerminalTextStyle.Green);
          }
          setStep(TerminalPromptStep.ACCOUNT_SET);
        } catch (e) {
          terminal.current?.println(
            "An unknown error occurred. please try again.",
            TerminalTextStyle.Red
          );
        }
      } else {
        const userInput = await terminal.current?.getInput();

        if (userInput === "a" && accounts.length > 0) {
          setStep(TerminalPromptStep.DISPLAY_ACCOUNTS);
        } else if (userInput === "n") {
          setStep(TerminalPromptStep.GENERATE_ACCOUNT);
        } else if (userInput === "i") {
          setStep(TerminalPromptStep.IMPORT_ACCOUNT);
        } else {
          terminal.current?.println("Unrecognized input. Please try again.");
          await advanceStateFromCompatibilityPassed(terminal);
        }
      }
    },
    [isLobby, walletManager, selectedAddress]
  );

  const advanceStateFromDisplayAccounts = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      terminal.current?.println(``);
      const accounts = walletManager?.getAccounts() ?? [];
      for (let i = 0; i < accounts.length; i += 1) {
        terminal.current?.print(`(${i + 1}): `, TerminalTextStyle.Sub);
        terminal.current?.println(`${accounts[i].address}`);
      }
      terminal.current?.println(``);
      terminal.current?.println(`Select an account:`, TerminalTextStyle.Text);

      const selection = +((await terminal.current?.getInput()) || "");

      if (isNaN(selection) || selection > accounts.length) {
        terminal.current?.println("Unrecognized input. Please try again.");
        await advanceStateFromDisplayAccounts(terminal);
        return;
      }

      const account = accounts[selection - 1];
      try {
        terminal.current?.println("Restoring account...");
        const result = await walletManager?.switchAccount(
          account.address,
          (msg) => terminal.current?.println(msg, TerminalTextStyle.Sub)
        );
        if (result?.deployed) {
          terminal.current?.println(
            "Deployed to new network.",
            TerminalTextStyle.Green
          );
        } else {
          terminal.current?.println("Done.", TerminalTextStyle.Green);
        }
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (e) {
        terminal.current?.println(
          "An unknown error occurred. please try again.",
          TerminalTextStyle.Red
        );
      }
    },
    [walletManager]
  );

  const advanceStateFromGenerateAccount = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      try {
        terminal.current?.println(``);
        terminal.current?.print("Deploying new Aztec account... ");
        const record = await walletManager!.createAccount();
        const newAddr = record.address;

        terminal.current?.println("Done.", TerminalTextStyle.Green);
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
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (e) {
        console.error("Failed to create account:", e);
        terminal.current?.println(
          "An unknown error occurred. please try again.",
          TerminalTextStyle.Red
        );
      }
    },
    [walletManager]
  );

  const advanceStateFromImportAccount = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
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
        const record = await walletManager!.importAccount(
          secretKey,
          salt,
          signingKey,
          undefined,
          (msg) => terminal.current?.println(msg, TerminalTextStyle.Sub)
        );
        if (record.deployed) {
          terminal.current?.println(
            "Deployed to network.",
            TerminalTextStyle.Green
          );
        } else {
          terminal.current?.println("Done.", TerminalTextStyle.Green);
        }
        terminal.current?.println(
          `Imported account with address ${record.address}.`
        );
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (e) {
        terminal.current?.println(
          "An unknown error occurred. please try again.",
          TerminalTextStyle.Red
        );
      }
    },
    [walletManager]
  );

  const advanceStateFromAccountSet = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      const playerAddress = walletManager?.getActiveAddress()?.toString();
      if (!playerAddress) {
        terminal.current?.println(
          "ERROR: No active account. Please refresh and try again.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.TERMINATED);
        return;
      }

      terminal.current?.println("");
      terminal.current?.println(`Welcome, player ${playerAddress}.`);
      setStep(TerminalPromptStep.FETCHING_ETH_DATA);
    },
    [walletManager]
  );

  const advanceStateFromFetchingEthData = useCallback(
    async (terminal: React.MutableRefObject<TerminalHandle | undefined>) => {
      let newGameManager: GameManager;

      try {
        if (!walletManager) throw new Error("no wallet manager");
        const indexerConnection = indexerRef.current;
        if (!indexerConnection) throw new Error("no indexer connection");

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
        contractsAPI.setupEventListeners();

        setLoadingPhase({
          step: "gamestate",
          detail: "Downloading game data...",
        });
        newGameManager = await GameManager.create({
          contractsAPI,
          terminal,
          contractAddress,
          chainClock,
        });
      } catch (e) {
        console.error(e);

        setStep(TerminalPromptStep.ERROR);

        terminal.current?.println(
          "Network under heavy load. Please refresh the page and try again.",
          TerminalTextStyle.Red
        );

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
    [walletManager, contractAddress]
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
        .joinGame(async (e) => {
          console.error(e);

          terminal.current?.println("Error Joining Game:");
          terminal.current?.println("");
          terminal.current?.println(e.message, TerminalTextStyle.Red);
          terminal.current?.println("");
          terminal.current?.println("Press Enter to Try Again:");

          await terminal.current?.getInput();
          return true;
        })
        .catch((error: Error) => {
          terminal.current?.println(
            `[ERROR] An error occurred: ${error.toString().slice(0, 10000)}`,
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
    []
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
      if (step === TerminalPromptStep.NONE && walletManager) {
        await advanceStateFromNone(terminal);
      } else if (step === TerminalPromptStep.COMPATIBILITY_CHECKS_PASSED) {
        await advanceStateFromCompatibilityPassed(terminal);
      } else if (step === TerminalPromptStep.DISPLAY_ACCOUNTS) {
        await advanceStateFromDisplayAccounts(terminal);
      } else if (step === TerminalPromptStep.GENERATE_ACCOUNT) {
        await advanceStateFromGenerateAccount(terminal);
      } else if (step === TerminalPromptStep.IMPORT_ACCOUNT) {
        await advanceStateFromImportAccount(terminal);
      } else if (step === TerminalPromptStep.ACCOUNT_SET) {
        await advanceStateFromAccountSet(terminal);
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
      advanceStateFromAddAccount,
      advanceStateFromAllChecksPass,
      advanceStateFromAskAddAccount,
      advanceStateFromCompatibilityPassed,
      advanceStateFromComplete,
      advanceStateFromDisplayAccounts,
      advanceStateFromError,
      advanceStateFromFetchingEthData,
      advanceStateFromGenerateAccount,
      advanceStateFromImportAccount,
      advanceStateFromNoHomePlanet,
      advanceStateFromNone,
      walletManager,
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
      </TerminalWrapper>
      {loadingPhase.step !== "done" && <LoadingOverlay phase={loadingPhase} />}
      <div ref={topLevelContainer}></div>
    </Wrapper>
  );
}
