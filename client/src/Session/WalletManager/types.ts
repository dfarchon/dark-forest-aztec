/**
 * WalletManager types: configuration, persisted account records, and status snapshot.
 */

/** Progress callback for wallet init: (currentStep, totalSteps, message). */
export type WalletProgressCallback = (
  current: number,
  total: number,
  message: string
) => void;

/** Initialization config for createWalletManager(). */
export interface WalletManagerConfig {
  nodeUrl: string;
  storagePrefix?: string;
  balancePollIntervalMs?: number;
  /** HTTP base URL for native accelerator (host:port), e.g. from getEffectiveProverUrl(). */
  proverUrl?: string;
  /** PXE config overrides. In browser, dataStoreMapSizeKb defaults to 128 GB which fails; use ~128 MB. */
  pxeConfig?: {
    dataStoreMapSizeKb?: number;
    proverEnabled?: boolean;
  };
  /** Optional progress callback during wallet init (e.g. for loading overlay). */
  onWalletProgress?: WalletProgressCallback;
}

/**
 * Persisted account record stored in localStorage via KeyStore.
 * Credential triple (secretKey, salt, signingKey) maps to an ECDSAR account contract.
 */
export interface AccountRecord {
  address: string;
  secretKey: string;
  salt: string;
  signingKey: string;
  label?: string;
  createdAt: number;
}

/** Reactive status snapshot exposed by WalletManager. */
export interface WalletStatus {
  connected: boolean;
  activeAddress: string | undefined;
  accounts: AccountRecord[];
  balance: bigint;
}
