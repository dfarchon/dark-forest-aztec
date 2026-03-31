import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Aliased } from "@aztec/aztec.js/wallet";
import type { Wallet } from "@aztec/aztec.js/wallet";
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { getEffectiveNodeUrl } from "../../config/connection";
import { resolveExternalWalletCapabilities } from "../../Session/ExternalWallet/capabilityValidation";
import {
  cancelConnection as cancelConnectionService,
  confirmConnection as confirmConnectionService,
  disconnectProvider,
  discoverExtensionWalletById,
  discoverExtensionWallets,
  type DiscoverySession,
  initiateConnection as initiateConnectionService,
  type PendingConnection,
  type WalletProvider,
} from "../../Session/ExternalWallet/walletService";

const REMEMBERED_EXTERNAL_WALLET_KEY = "dfpunk:lastExternalWallet";

export type RememberedExternalWalletSession = {
  providerId: string;
  providerName: string;
  accountAddress: string;
  savedAt: number;
};

export type ExternalWalletConnectionResult = {
  wallet: Wallet;
  address: AztecAddress;
  descriptor: RememberedExternalWalletSession;
  supportsUtilitySimulation: boolean;
  supportsTransactionSimulation: boolean;
  supportsTransactionExecution: boolean;
};

export type WalletSessionLostCallback = (message: string) => void;

export class RememberedExternalWalletAccountMismatchError extends Error {
  constructor(
    public readonly descriptor: RememberedExternalWalletSession,
    public readonly wallet: Wallet,
    public readonly accounts: Aliased<AztecAddress>[],
    public readonly supportsUtilitySimulation: boolean,
    public readonly supportsTransactionSimulation: boolean,
    public readonly supportsTransactionExecution: boolean
  ) {
    super(
      "Last external wallet account is no longer granted. Select another granted account to continue."
    );
    this.name = "RememberedExternalWalletAccountMismatchError";
  }
}

function isRememberedSession(
  value: unknown
): value is RememberedExternalWalletSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.providerId === "string" &&
    typeof session.providerName === "string" &&
    typeof session.accountAddress === "string" &&
    typeof session.savedAt === "number"
  );
}

function readRememberedSession(): RememberedExternalWalletSession | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_EXTERNAL_WALLET_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRememberedSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeRememberedSession(
  descriptor: RememberedExternalWalletSession
): void {
  try {
    localStorage.setItem(
      REMEMBERED_EXTERNAL_WALLET_KEY,
      JSON.stringify(descriptor)
    );
  } catch {
    /* noop */
  }
}

function removeRememberedSession(): void {
  try {
    localStorage.removeItem(REMEMBERED_EXTERNAL_WALLET_KEY);
  } catch {
    /* noop */
  }
}

type ExternalWalletContextValue = {
  wallet: Wallet | null;
  address: AztecAddress | null;
  isConnecting: boolean;
  error: string | null;
  discoverWallets: (timeout?: number) => Promise<DiscoverySession>;
  initiateConnection: (provider: WalletProvider) => Promise<PendingConnection>;
  confirmConnection: (pendingConnection: PendingConnection) => Promise<Wallet>;
  cancelConnection: (pendingConnection: PendingConnection) => void;
  connectWallet: (wallet: Wallet, address: AztecAddress) => void;
  releaseWalletSession: () => Promise<void>;
  onWalletSessionLost: (callback: WalletSessionLostCallback) => () => void;
  clearError: () => void;
  getRememberedSession: () => RememberedExternalWalletSession | null;
  rememberSession: (descriptor: RememberedExternalWalletSession) => void;
  clearRememberedSession: () => void;
  reconnectRememberedWallet: () => Promise<ExternalWalletConnectionResult>;
};

const ExternalWalletContext = createContext<
  ExternalWalletContextValue | undefined
>(undefined);

export function ExternalWalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [address, setAddress] = useState<AztecAddress | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProviderRef = useRef<WalletProvider | null>(null);
  const providerDisconnectCleanupRef = useRef<(() => void) | null>(null);
  const sessionLostCallbacksRef = useRef<Set<WalletSessionLostCallback>>(
    new Set()
  );
  const clearRememberedSession = useCallback(() => {
    removeRememberedSession();
  }, []);

  const clearProviderDisconnectListener = useCallback(() => {
    providerDisconnectCleanupRef.current?.();
    providerDisconnectCleanupRef.current = null;
  }, []);

  const notifyWalletSessionLost = useCallback((message: string) => {
    setWallet(null);
    setAddress(null);
    setIsConnecting(false);
    setError(message);

    for (const callback of sessionLostCallbacksRef.current) {
      try {
        callback(message);
      } catch {
        /* noop */
      }
    }
  }, []);

  const bindProviderDisconnectListener = useCallback(() => {
    clearProviderDisconnectListener();

    const provider = activeProviderRef.current as
      | (WalletProvider & {
          onDisconnect?: (callback: () => void) => (() => void) | void;
        })
      | null;
    if (!provider || typeof provider.onDisconnect !== "function") {
      return;
    }

    const maybeCleanup = provider.onDisconnect(() => {
      activeProviderRef.current = null;
      clearProviderDisconnectListener();
      notifyWalletSessionLost(
        "Wallet session lost. Refresh the page to continue."
      );
    });

    if (typeof maybeCleanup === "function") {
      providerDisconnectCleanupRef.current = maybeCleanup;
    }
  }, [clearProviderDisconnectListener, notifyWalletSessionLost]);

  const discoverWallets = useCallback(async (timeout?: number) => {
    setError(null);
    return discoverExtensionWallets(getEffectiveNodeUrl(), timeout);
  }, []);

  const initiateConnection = useCallback(
    async (provider: WalletProvider) => {
      setError(null);
      setIsConnecting(true);

      if (
        activeProviderRef.current &&
        activeProviderRef.current.id !== provider.id
      ) {
        clearProviderDisconnectListener();
        try {
          await disconnectProvider(activeProviderRef.current);
        } catch {
          // Best effort while changing providers.
        }
      }

      activeProviderRef.current = provider;
      return initiateConnectionService(provider);
    },
    [clearProviderDisconnectListener]
  );

  const confirmConnection = useCallback(
    async (pendingConnection: PendingConnection) => {
      try {
        return await confirmConnectionService(pendingConnection);
      } catch (err) {
        setIsConnecting(false);
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    []
  );

  const cancelConnection = useCallback(
    (pendingConnection: PendingConnection) => {
      cancelConnectionService(pendingConnection);
      setIsConnecting(false);
    },
    []
  );

  const connectWallet = useCallback(
    (nextWallet: Wallet, nextAddress: AztecAddress) => {
      setWallet(nextWallet);
      setAddress(nextAddress);
      setError(null);
      setIsConnecting(false);
      bindProviderDisconnectListener();
    },
    [bindProviderDisconnectListener]
  );

  const releaseWalletSession = useCallback(async () => {
    clearProviderDisconnectListener();

    if (activeProviderRef.current) {
      try {
        await disconnectProvider(activeProviderRef.current);
      } catch {
        // Best effort while releasing session resources.
      }
    }

    activeProviderRef.current = null;
    setWallet(null);
    setAddress(null);
    setError(null);
    setIsConnecting(false);
  }, [clearProviderDisconnectListener]);

  const onWalletSessionLost = useCallback(
    (callback: WalletSessionLostCallback) => {
      sessionLostCallbacksRef.current.add(callback);
      return () => {
        sessionLostCallbacksRef.current.delete(callback);
      };
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);
  const getRememberedSession = useCallback(() => readRememberedSession(), []);
  const rememberSession = useCallback(
    (descriptor: RememberedExternalWalletSession) => {
      writeRememberedSession(descriptor);
    },
    []
  );

  const reconnectRememberedWallet = useCallback(async () => {
    const descriptor = readRememberedSession();
    if (!descriptor) {
      throw new Error("No remembered external wallet session found.");
    }

    setError(null);
    setIsConnecting(true);

    if (
      activeProviderRef.current &&
      activeProviderRef.current.id !== descriptor.providerId
    ) {
      clearProviderDisconnectListener();
      try {
        await disconnectProvider(activeProviderRef.current);
      } catch {
        // Best effort while switching providers.
      }
      activeProviderRef.current = null;
    }

    try {
      const provider = await discoverExtensionWalletById(
        getEffectiveNodeUrl(),
        descriptor.providerId
      );

      if (!provider) {
        clearRememberedSession();
        throw new Error(
          "Last external wallet is unavailable on this device/browser session."
        );
      }

      activeProviderRef.current = provider;

      const pendingConnection = await initiateConnectionService(provider);
      const wallet = await confirmConnectionService(pendingConnection);
      const capabilityResolution =
        await resolveExternalWalletCapabilities(wallet);
      const {
        accounts,
        supportsUtilitySimulation,
        supportsTransactionSimulation,
        supportsTransactionExecution,
      } = capabilityResolution;

      if (accounts.length === 0) {
        clearRememberedSession();
        throw new Error("No accounts granted by wallet.");
      }

      if (
        !supportsUtilitySimulation ||
        !supportsTransactionSimulation ||
        !supportsTransactionExecution
      ) {
        clearRememberedSession();
        throw new Error(
          "Last external wallet session no longer grants the required permissions. Reconnect and approve the requested permissions."
        );
      }

      const matchedAccount = accounts.find(
        (account) => account.item.toString() === descriptor.accountAddress
      );

      if (!matchedAccount) {
        setIsConnecting(false);
        throw new RememberedExternalWalletAccountMismatchError(
          descriptor,
          wallet,
          accounts,
          supportsUtilitySimulation,
          supportsTransactionSimulation,
          supportsTransactionExecution
        );
      }

      setIsConnecting(false);
      return {
        wallet,
        address: matchedAccount.item,
        descriptor,
        supportsUtilitySimulation,
        supportsTransactionSimulation,
        supportsTransactionExecution,
      };
    } catch (err) {
      setIsConnecting(false);
      if (err instanceof RememberedExternalWalletAccountMismatchError) {
        setError(err.message);
        throw err;
      }

      const provider = activeProviderRef.current;
      activeProviderRef.current = null;
      clearProviderDisconnectListener();

      if (provider) {
        try {
          await disconnectProvider(provider);
        } catch {
          // Best effort on failed reconnect attempts.
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      clearRememberedSession();
      throw err;
    }
  }, [clearProviderDisconnectListener, clearRememberedSession]);

  const value = useMemo(
    () => ({
      wallet,
      address,
      isConnecting,
      error,
      discoverWallets,
      initiateConnection,
      confirmConnection,
      cancelConnection,
      connectWallet,
      releaseWalletSession,
      onWalletSessionLost,
      clearError,
      getRememberedSession,
      rememberSession,
      clearRememberedSession,
      reconnectRememberedWallet,
    }),
    [
      wallet,
      address,
      isConnecting,
      error,
      discoverWallets,
      initiateConnection,
      confirmConnection,
      cancelConnection,
      connectWallet,
      releaseWalletSession,
      onWalletSessionLost,
      clearError,
      getRememberedSession,
      rememberSession,
      clearRememberedSession,
      reconnectRememberedWallet,
    ]
  );

  return (
    <ExternalWalletContext.Provider value={value}>
      {children}
    </ExternalWalletContext.Provider>
  );
}

export function useExternalWallet(): ExternalWalletContextValue {
  const ctx = useContext(ExternalWalletContext);
  if (!ctx) {
    throw new Error(
      "useExternalWallet must be used within ExternalWalletProvider"
    );
  }
  return ctx;
}
