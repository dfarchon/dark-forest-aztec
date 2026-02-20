/**
 * WalletManager types: configuration, persisted account records, and status snapshot.
 */

/** Initialization config for createWalletManager(). */
export interface WalletManagerConfig {
  nodeUrl: string;
  storagePrefix?: string;
  balancePollIntervalMs?: number;
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
