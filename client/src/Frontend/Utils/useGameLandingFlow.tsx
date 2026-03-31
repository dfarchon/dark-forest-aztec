import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import type { Aliased } from "@aztec/aztec.js/wallet";
import { hashToEmoji } from "@aztec/wallet-sdk/crypto";
import { APP_VERSION, CHAIN_DISPLAY_NAME, GAME_NAME } from "@dfpunk/constants";
import { CONFIG_CONTRACT_ADDRESS } from "@dfpunk/contracts";
import { ConfigContract } from "@dfpunk/contracts/artifacts/Config";
import type { EthAddress } from "@dfpunk/types";
import React, {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";

import GameManager, {
  GameManagerEvent,
} from "../../Backend/GameLogic/GameManager";
import GameUIManager from "../../Backend/GameLogic/GameUIManager";
import { ChainClock } from "../../Backend/Utils/ChainClock";
import { getEffectiveNodeUrl } from "../../config/connection";
import { makeContractsAPI } from "../../ContractsAPI/ContractsAPI";
import { resolveExternalWalletCapabilities } from "../../Session/ExternalWallet/capabilityValidation";
import type {
  PendingConnection,
  WalletProvider,
} from "../../Session/ExternalWallet/walletService";
import { ConfigCache } from "../../Session/TxExecutor/ConfigCache";
import { TxExecutor } from "../../Session/TxExecutor/TxExecutor";
import { InitRenderState } from "../Components/GameLandingPageComponents";
import { MythicLabelText } from "../Components/Labels/MythicLabel";
import { TextPreview } from "../Components/TextPreview";
import {
  type ExternalWalletConnectionResult,
  RememberedExternalWalletAccountMismatchError,
} from "../Contexts/ExternalWalletContext";
import type { TerminalHandle } from "../Views/Terminal";
import { Incompatibility, unsupportedFeatures } from "./BrowserChecks";
import {
  describeMissingExternalWalletSupport,
  formatFeeJuice,
  sleep,
  TerminalPromptStep,
} from "./GameLandingPageShared";
import { TerminalTextStyle } from "./TerminalTypes";
import { useGameLandingSession } from "./useGameLandingSession";

type GameLandingSession = ReturnType<typeof useGameLandingSession>;
type Handler = (
  terminal: MutableRefObject<TerminalHandle | undefined>
) => Promise<void>;

type UseGameLandingFlowParams = {
  contractAddress: EthAddress;
  isLobby: boolean;
  setGameManager: Dispatch<SetStateAction<GameManager | undefined>>;
  setInitRenderState: Dispatch<SetStateAction<InitRenderState>>;
  setStep: Dispatch<SetStateAction<TerminalPromptStep>>;
  sponsorMode: boolean;
  step: TerminalPromptStep;
  session: GameLandingSession;
};

export function useGameLandingFlow({
  contractAddress,
  isLobby,
  setGameManager,
  setInitRenderState,
  setStep,
  sponsorMode,
  step,
  session,
}: UseGameLandingFlowParams) {
  const promptForExternalAccountSelection = useCallback(
    async (
      terminal: MutableRefObject<TerminalHandle | undefined>,
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
      terminal: MutableRefObject<TerminalHandle | undefined>,
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
      terminal: MutableRefObject<TerminalHandle | undefined>,
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
          session.cancelConnection(pendingConnection);
          return "cancel";
        }

        terminal.current?.println("Unrecognized input. Please try again.");
      }
    },
    [session]
  );

  const connectExternalWalletInTerminal = useCallback(
    async (
      terminal: MutableRefObject<TerminalHandle | undefined>
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
          const discovery = await session.discoverWallets();
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
          const pendingConnection =
            await session.initiateConnection(selectedProvider);
          providerSessionActive = true;

          const verificationResult = await promptForExternalWalletVerification(
            terminal,
            pendingConnection
          );
          if (verificationResult === "cancel") {
            await session.releaseWalletSession();
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

          const wallet = await session.confirmConnection(pendingConnection);
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
            await session.releaseWalletSession();
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
            await session.releaseWalletSession();
            return null;
          }

          const selectedAddress = await promptForExternalAccountSelection(
            terminal,
            accounts
          );
          if (!selectedAddress) {
            await session.releaseWalletSession();
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
            await session.releaseWalletSession();
          }
          return null;
        }
      }
    },
    [
      promptForExternalAccountSelection,
      promptForExternalWalletProviderSelection,
      promptForExternalWalletVerification,
      session,
    ]
  );

  const advanceStateFromNone = useCallback<Handler>(
    async (terminal) => {
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
    [setStep]
  );

  const advanceStateFromWalletMenu = useCallback<Handler>(
    async function advanceStateFromWalletMenuHandler(terminal) {
      const rememberedSession = session.getRememberedSession();
      const selectedMode = session.selectedWalletModeRef.current;

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
          await session.clearUnlockedWalletState();
          session.selectedWalletModeRef.current = "local";
          await advanceStateFromWalletMenuHandler(terminal);
          return;
        }
        if (userInput === "e") {
          await session.clearUnlockedWalletState();
          session.selectedWalletModeRef.current = "external";
          await advanceStateFromWalletMenuHandler(terminal);
          return;
        }
        if (userInput === "r" && rememberedSession) {
          await session.clearUnlockedWalletState();
          session.selectedWalletModeRef.current = "external";
          setStep(TerminalPromptStep.RECONNECT_EXTERNAL);
          return;
        }

        terminal.current?.println("Unrecognized input. Please try again.");
        await advanceStateFromWalletMenuHandler(terminal);
        return;
      }

      if (selectedMode === "local") {
        terminal.current?.println(
          `Found ${session.localAccountCount} local account${
            session.localAccountCount === 1 ? "" : "s"
          } on this device.`
        );
        terminal.current?.println("");
        terminal.current?.println(
          "Selected wallet mode: local wallet.",
          TerminalTextStyle.Text
        );

        if (session.localAccountCount > 0) {
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
        if (userInput === "a" && session.localAccountCount > 0) {
          try {
            await session.ensureEmbeddedWalletManager();
            setStep(TerminalPromptStep.LOCAL_ACCOUNT_LIST);
          } catch {
            terminal.current?.println(
              "Unable to initialize the local wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await advanceStateFromWalletMenuHandler(terminal);
          }
        } else if (userInput === "n") {
          try {
            await session.ensureEmbeddedWalletManager();
            setStep(TerminalPromptStep.GENERATE_ACCOUNT);
          } catch {
            terminal.current?.println(
              "Unable to initialize the local wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await advanceStateFromWalletMenuHandler(terminal);
          }
        } else if (userInput === "i") {
          try {
            await session.ensureEmbeddedWalletManager();
            setStep(TerminalPromptStep.IMPORT_ACCOUNT);
          } catch {
            terminal.current?.println(
              "Unable to initialize the local wallet. Please try again.",
              TerminalTextStyle.Red
            );
            await advanceStateFromWalletMenuHandler(terminal);
          }
        } else if (userInput === "b" && !session.isWalletSelectionLocked()) {
          await session.clearUnlockedWalletState();
          session.selectedWalletModeRef.current = null;
          await advanceStateFromWalletMenuHandler(terminal);
        } else {
          terminal.current?.println("Unrecognized input. Please try again.");
          await advanceStateFromWalletMenuHandler(terminal);
        }
        return;
      }

      terminal.current?.println(
        "Selected wallet mode: extension wallet.",
        TerminalTextStyle.Text
      );
      terminal.current?.print("(c) ", TerminalTextStyle.Sub);
      terminal.current?.println("Connect extension wallet.");
      if (rememberedSession) {
        terminal.current?.print("(r) ", TerminalTextStyle.Sub);
        terminal.current?.println(
          `Reconnect last extension wallet (${rememberedSession.providerName}, ${rememberedSession.accountAddress}).`
        );
      }
      terminal.current?.print("(b) ", TerminalTextStyle.Sub);
      terminal.current?.println("Back to wallet selection.");
      terminal.current?.println("");
      terminal.current?.println("Select an option:", TerminalTextStyle.Text);

      const userInput = await terminal.current?.getInput();
      if (userInput === "c") {
        setStep(TerminalPromptStep.CONNECT_EXTERNAL);
      } else if (userInput === "r" && rememberedSession) {
        setStep(TerminalPromptStep.RECONNECT_EXTERNAL);
      } else if (userInput === "b" && !session.isWalletSelectionLocked()) {
        await session.clearUnlockedWalletState();
        session.selectedWalletModeRef.current = null;
        await advanceStateFromWalletMenuHandler(terminal);
      } else {
        terminal.current?.println("Unrecognized input. Please try again.");
        await advanceStateFromWalletMenuHandler(terminal);
      }
    },
    [isLobby, session, setStep]
  );

  const advanceStateFromLocalAccountList = useCallback<Handler>(
    async (terminal) => {
      for (;;) {
        terminal.current?.println("");
        const walletManager = session.walletManagerRef.current;
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
        terminal.current?.println("");
        terminal.current?.println("Select an account:", TerminalTextStyle.Text);

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
          session.lockWalletSelection("local");
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
        } catch {
          terminal.current?.println(
            "An unknown error occurred. please try again.",
            TerminalTextStyle.Red
          );
        }
      }
    },
    [session, setStep]
  );

  const advanceStateFromConnectExternal = useCallback<Handler>(
    async (terminal) => {
      if (session.selectedWalletModeRef.current !== "external") {
        terminal.current?.println(
          "Extension wallet mode is not selected for this session.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      const result = await connectExternalWalletInTerminal(terminal);
      if (!result) {
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      try {
        await session.initializeExternalWalletManager(result);
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (err) {
        console.error("Failed to initialize external wallet:", err);
        terminal.current?.println(
          err instanceof Error
            ? err.message
            : "Failed to initialize the connected external wallet. Please try again.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
      }
    },
    [connectExternalWalletInTerminal, session, setStep]
  );

  const advanceStateFromReconnectExternal = useCallback<Handler>(
    async (terminal) => {
      if (session.selectedWalletModeRef.current !== "external") {
        terminal.current?.println(
          "Extension wallet mode is not selected for this session.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
        return;
      }

      const rememberedSession = session.getRememberedSession();
      if (!rememberedSession) {
        terminal.current?.println(
          "No remembered external wallet session found.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
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
        session.resetInitializationTerminalLogging();
        const result = await session.reconnectRememberedWallet();
        await session.initializeExternalWalletManager(result);
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch (err) {
        if (err instanceof RememberedExternalWalletAccountMismatchError) {
          terminal.current?.println(err.message, TerminalTextStyle.Red);
          const nextAddress = await promptForExternalAccountSelection(
            terminal,
            err.accounts
          );
          if (!nextAddress) {
            await session.releaseWalletSession();
            terminal.current?.println(
              "Extension wallet reconnection cancelled.",
              TerminalTextStyle.Sub
            );
            setStep(TerminalPromptStep.WALLET_MENU);
            return;
          }

          try {
            await session.initializeExternalWalletManager({
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
            setStep(TerminalPromptStep.WALLET_MENU);
          }
          return;
        }

        terminal.current?.println(
          err instanceof Error ? err.message : String(err),
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.WALLET_MENU);
      }
    },
    [promptForExternalAccountSelection, session, setStep]
  );

  const advanceStateFromGenerateAccount = useCallback<Handler>(
    async (terminal) => {
      const walletManager = session.walletManagerRef.current;
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
        terminal.current?.println("");
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
        terminal.current?.println("");
        terminal.current?.print("Created account with address ");
        terminal.current?.printElement(
          <TextPreview text={newAddr} unFocusedWidth={"100px"} />
        );
        terminal.current?.println("");
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
        session.lockWalletSelection("local");
        session.refreshLocalAccountCount();
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
    [session, setStep]
  );

  const advanceStateFromImportAccount = useCallback<Handler>(
    async (terminal) => {
      const walletManager = session.walletManagerRef.current;
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
        session.lockWalletSelection("local");
        session.refreshLocalAccountCount();
        setStep(TerminalPromptStep.ACCOUNT_SET);
      } catch {
        terminal.current?.println(
          "An unknown error occurred. please try again.",
          TerminalTextStyle.Red
        );
      }
    },
    [session, setStep]
  );

  const advanceStateFromAccountSet = useCallback<Handler>(
    async (terminal) => {
      const walletManager = session.walletManagerRef.current;
      if (!walletManager) {
        terminal.current?.println(
          "ERROR: wallet manager not ready.",
          TerminalTextStyle.Red
        );
        setStep(TerminalPromptStep.TERMINATED);
        return;
      }
      const playerAddress = walletManager.getActiveAddress()?.toString();
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
        !session.externalModeBannerPrintedRef.current
      ) {
        terminal.current?.println(
          "Using external wallet",
          TerminalTextStyle.Green
        );
        terminal.current?.println(`Account: ${playerAddress}`);
        terminal.current?.println("");
        session.externalModeBannerPrintedRef.current = true;
      }

      if (!session.walletLockMessagePrintedRef.current) {
        terminal.current?.println(
          "Wallet choice is locked for this session.",
          TerminalTextStyle.Sub
        );
        terminal.current?.println(
          "Refresh the page to use a different wallet.",
          TerminalTextStyle.Sub
        );
        terminal.current?.println("");
        session.walletLockMessagePrintedRef.current = true;
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
    [session, setStep, sponsorMode]
  );

  const advanceStateFromCheckFeeJuice = useCallback<Handler>(
    async (terminal) => {
      const walletManager = session.walletManagerRef.current;
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

          await sleep(1500);

          if (spinnerInterval) clearInterval(spinnerInterval);
          spinnerInterval = undefined;

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
                "https://gregojuice.anothercoffeefor.me/",
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
    [session, setStep, sponsorMode]
  );

  const advanceStateFromFetchingEthData = useCallback<Handler>(
    async (terminal) => {
      let newGameManager: GameManager;
      session.markWalletSelectionInGame();

      try {
        if (session.selectedWalletModeRef.current === "external") {
          const support = session.externalWalletSimulationSupportRef.current;
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

        const walletManager = session.walletManagerRef.current;
        if (!walletManager) throw new Error("no wallet manager");
        const indexerConnection = await session.ensureIndexerConnection();

        session.setLoadingPhase({
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

        session.setLoadingPhase({
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

        session.setLoadingPhase({
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
            session.setLoadingPhase((prev) =>
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

        session.setLoadingPhase({ step: "done" });
        setStep(TerminalPromptStep.ERROR);

        if (session.selectedWalletModeRef.current === "external") {
          if (import.meta.env.DEV) {
            console.debug("[ExternalWallet] Startup failed", {
              error: e instanceof Error ? e.message : String(e),
              support: session.externalWalletSimulationSupportRef.current,
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

      session.setLoadingPhase({ step: "done" });
      setGameManager(newGameManager);

      window.df = newGameManager;

      const newGameUIManager = await GameUIManager.create(
        newGameManager,
        terminal
      );

      window.ui = newGameUIManager;

      terminal.current?.newline();
      terminal.current?.println("Connected to Dark Forest Contract");
      session.gameUIManagerRef.current = newGameUIManager;

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
    [contractAddress, session, setGameManager, setStep]
  );

  const advanceStateFromAskAddAccount = useCallback<Handler>(
    async function advanceStateFromAskAddAccountHandler(terminal) {
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
        await advanceStateFromAskAddAccountHandler(terminal);
      }
    },
    [setStep]
  );

  const advanceStateFromAddAccount = useCallback<Handler>(
    async (terminal) => {
      const gameUIManager = session.gameUIManagerRef.current;

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
    [session, setStep]
  );

  const advanceStateFromNoHomePlanet = useCallback<Handler>(
    async (terminal) => {
      terminal.current?.println("Welcome to DARK FOREST.");

      const gameUIManager = session.gameUIManagerRef.current;
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
    [session, setStep]
  );

  const advanceStateFromAllChecksPass = useCallback<Handler>(
    async (terminal) => {
      terminal.current?.println("");
      terminal.current?.println("Press ENTER to begin");
      terminal.current?.println(
        "Press 's' then ENTER to begin in SAFE MODE - plugins disabled"
      );

      const input = await terminal.current?.getInput();

      if (input === "s") {
        const gameUIManager = session.gameUIManagerRef.current;
        gameUIManager?.getGameManager()?.setSafeMode(true);
      }

      session.resetInitializationTerminalLogging();
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
    [session, setInitRenderState, setStep]
  );

  const advanceStateFromComplete = useCallback<Handler>(async (terminal) => {
    async function advanceStateFromCompleteHandler(
      terminalRef: MutableRefObject<TerminalHandle | undefined>
    ) {
      const input = (await terminalRef.current?.getInput()) || "";
      let res = "";
      try {
        const indirectEval = globalThis.eval;
        res = indirectEval(input) as string;
        if (res !== undefined) {
          terminalRef.current?.println(res.toString(), TerminalTextStyle.Text);
        }
      } catch (e) {
        res = e instanceof Error ? e.message : String(e);
        terminalRef.current?.println(`ERROR: ${res}`, TerminalTextStyle.Red);
      }
      await advanceStateFromCompleteHandler(terminalRef);
    }

    await advanceStateFromCompleteHandler(terminal);
  }, []);

  const advanceStateFromTerminated = useCallback<Handler>(async () => {
    return;
  }, []);

  const advanceStateFromError = useCallback<Handler>(async () => {
    await new Promise(() => {});
  }, []);

  const advanceState = useCallback<Handler>(
    async (terminal) => {
      const handlers: Partial<Record<TerminalPromptStep, Handler>> = {
        [TerminalPromptStep.NONE]: advanceStateFromNone,
        [TerminalPromptStep.WALLET_MENU]: advanceStateFromWalletMenu,
        [TerminalPromptStep.LOCAL_ACCOUNT_LIST]:
          advanceStateFromLocalAccountList,
        [TerminalPromptStep.GENERATE_ACCOUNT]: advanceStateFromGenerateAccount,
        [TerminalPromptStep.IMPORT_ACCOUNT]: advanceStateFromImportAccount,
        [TerminalPromptStep.CONNECT_EXTERNAL]: advanceStateFromConnectExternal,
        [TerminalPromptStep.RECONNECT_EXTERNAL]:
          advanceStateFromReconnectExternal,
        [TerminalPromptStep.ACCOUNT_SET]: advanceStateFromAccountSet,
        [TerminalPromptStep.CHECK_FEE_JUICE]: advanceStateFromCheckFeeJuice,
        [TerminalPromptStep.FETCHING_ETH_DATA]: advanceStateFromFetchingEthData,
        [TerminalPromptStep.ASK_ADD_ACCOUNT]: advanceStateFromAskAddAccount,
        [TerminalPromptStep.ADD_ACCOUNT]: advanceStateFromAddAccount,
        [TerminalPromptStep.NO_HOME_PLANET]: advanceStateFromNoHomePlanet,
        [TerminalPromptStep.SEARCHING_FOR_HOME_PLANET]:
          advanceStateFromTerminated,
        [TerminalPromptStep.ALL_CHECKS_PASS]: advanceStateFromAllChecksPass,
        [TerminalPromptStep.COMPLETE]: advanceStateFromComplete,
        [TerminalPromptStep.TERMINATED]: advanceStateFromTerminated,
        [TerminalPromptStep.ERROR]: advanceStateFromError,
      };
      const handler = handlers[step] ?? advanceStateFromTerminated;
      await handler(terminal);
    },
    [
      advanceStateFromAccountSet,
      advanceStateFromAddAccount,
      advanceStateFromAllChecksPass,
      advanceStateFromAskAddAccount,
      advanceStateFromCheckFeeJuice,
      advanceStateFromComplete,
      advanceStateFromConnectExternal,
      advanceStateFromError,
      advanceStateFromFetchingEthData,
      advanceStateFromGenerateAccount,
      advanceStateFromImportAccount,
      advanceStateFromLocalAccountList,
      advanceStateFromNoHomePlanet,
      advanceStateFromNone,
      advanceStateFromReconnectExternal,
      advanceStateFromTerminated,
      advanceStateFromWalletMenu,
      step,
    ]
  );

  return { advanceState };
}
