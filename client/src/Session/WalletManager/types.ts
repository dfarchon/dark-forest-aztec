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
  /** When enabled, use the project's Sponsored FPC for transaction fees. */
  sponsorMode?: boolean;
  /**
   * Deployed project Sponsored FPC address. Required when sponsorMode is enabled.
   */
  sponsoredFpcAddressOverride?: string;
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
 * Credential triple (secretKey, salt, signingKey) maps to a Schnorr
 * initializerless account contract (Fr secret/salt + Fq signing key hex).
 */
export interface AccountRecord {
  address: string;
  secretKey: string;
  salt: string;
  /** Grumpkin scalar (Fq) as hex without 0x prefix. */
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

/** How required FeeJuice was derived for sponsor-mode FeeJuice preflight. */
export type SponsorFeeJuicePreflightSource = "threshold";

/** Sponsor-mode SponsoredFPC FeeJuice preflight result. */
export interface SponsorFeeJuicePreflight {
  balanceWei: bigint;
  requiredWei: bigint;
  sufficient: boolean;
  estimateSource: SponsorFeeJuicePreflightSource;
}
