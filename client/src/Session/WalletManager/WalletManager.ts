/**
 * WalletManager: EthConnection-equivalent for Aztec.
 *
 * Connects to an Aztec Node via createAztecNodeClient, creates a browser-embedded
 * EmbeddedWallet (with internal PXE), registers SponsoredFPC for fee-free transactions,
 * and manages ECDSAR accounts with localStorage persistence via KeyStore.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import type { AztecNode } from "@aztec/aztec.js/node";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import {
  ACCOUNT_ADDRESS,
  ADMIN_DEPLOYER_ADDRESS,
  ADMIN_DEPLOYMENT_SALT,
  CORE_DEPLOYER_ADDRESS,
  CORE_DEPLOYMENT_SALT,
  MOVE_DEPLOYER_ADDRESS,
  MOVE_DEPLOYMENT_SALT,
} from "@dfpunk/contracts";
import { AdminContractArtifact } from "@dfpunk/contracts/artifacts/Admin";
import { CoreContractArtifact } from "@dfpunk/contracts/artifacts/Core";
import { MoveContractArtifact } from "@dfpunk/contracts/artifacts/Move";
import type { Monomitter } from "@dfpunk/events";
import { monomitter } from "@dfpunk/events";

import { KeyStore } from "./KeyStore";
import type { AccountRecord, WalletManagerConfig } from "./types";

const DEFAULT_BALANCE_POLL_MS = 15_000;
const DEPLOY_TIMEOUT_MS = 120_000;
/** Default PXE data store size: 128 MB (in KB). SDK default is ~128 GB which is too large for browser. */
const DEFAULT_PXE_DATA_STORE_MAP_SIZE_KB = 128 * 1024;

/**
 * Register Core, Move, Admin with the wallet's PXE so simulate() and send() can run.
 * Requires deployer + salt from @dfpunk/contracts (run sync-env-and-artifacts after deploy).
 */
async function registerGameContractsWithPxe(
  wallet: EmbeddedWallet,
  admin: AztecAddress
): Promise<void> {
  const specs: Array<{
    deployer: string;
    salt: string;
    artifact: typeof CoreContractArtifact;
    name: string;
  }> = [
    {
      deployer: CORE_DEPLOYER_ADDRESS,
      salt: CORE_DEPLOYMENT_SALT,
      artifact: CoreContractArtifact,
      name: "Core",
    },
    {
      deployer: MOVE_DEPLOYER_ADDRESS,
      salt: MOVE_DEPLOYMENT_SALT,
      artifact: MoveContractArtifact,
      name: "Move",
    },
    {
      deployer: ADMIN_DEPLOYER_ADDRESS,
      salt: ADMIN_DEPLOYMENT_SALT,
      artifact: AdminContractArtifact,
      name: "Admin",
    },
  ];
  for (const { deployer, salt, artifact, name } of specs) {
    if (!deployer || !salt) continue;
    try {
      const instance = await getContractInstanceFromInstantiationParams(
        artifact,
        {
          deployer: AztecAddress.fromString(deployer),
          salt: Fr.fromString(salt),
          constructorArgs: [admin],
        }
      );
      await wallet.registerContract(instance, artifact);
    } catch (err) {
      console.warn(
        `[WalletManager] Skip PXE registration for ${name}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export class WalletManager {
  private readonly node: AztecNode;
  private readonly wallet: EmbeddedWallet;
  private readonly sponsoredFpcAddress: AztecAddress;
  private readonly keyStore: KeyStore;
  private activeAddress: AztecAddress | undefined;
  private balanceInterval: ReturnType<typeof setInterval> | undefined;
  private balance: bigint = 0n;

  public readonly walletChanged$: Monomitter<AztecAddress | undefined>;
  public readonly myBalance$: Monomitter<bigint>;

  private constructor(
    node: AztecNode,
    wallet: EmbeddedWallet,
    sponsoredFpcAddress: AztecAddress,
    keyStore: KeyStore
  ) {
    this.node = node;
    this.wallet = wallet;
    this.sponsoredFpcAddress = sponsoredFpcAddress;
    this.keyStore = keyStore;
    this.walletChanged$ = monomitter(true);
    this.myBalance$ = monomitter(true);
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static async create(config: WalletManagerConfig): Promise<WalletManager> {
    const node = createAztecNodeClient(config.nodeUrl);
    await waitForNode(node);

    const wallet = await EmbeddedWallet.create(node, {
      pxeConfig: {
        dataStoreMapSizeKb:
          config.pxeConfig?.dataStoreMapSizeKb ??
          DEFAULT_PXE_DATA_STORE_MAP_SIZE_KB,
        ...config.pxeConfig,
      },
    });

    const sponsoredFPC = await getContractInstanceFromInstantiationParams(
      SponsoredFPCContractArtifact,
      { salt: new Fr(SPONSORED_FPC_SALT) }
    );
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const admin = AztecAddress.fromString(ACCOUNT_ADDRESS);
    await registerGameContractsWithPxe(wallet, admin);

    const keyStore = new KeyStore(config.storagePrefix);

    const mgr = new WalletManager(node, wallet, sponsoredFPC.address, keyStore);

    const savedAddr = keyStore.getActiveAddress();
    if (savedAddr) {
      try {
        await mgr.restoreAccount(savedAddr);
      } catch (err) {
        console.warn("[WalletManager] Failed to restore saved account:", err);
        keyStore.clearActiveAddress();
      }
    }

    mgr.startBalancePolling(
      config.balancePollIntervalMs ?? DEFAULT_BALANCE_POLL_MS
    );

    return mgr;
  }

  // ---------------------------------------------------------------------------
  // Account management
  // ---------------------------------------------------------------------------

  async createAccount(label?: string): Promise<AccountRecord> {
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKeyBuf = Fr.random().toBuffer().slice(0, 32);

    const accountManager = await this.wallet.createECDSARAccount(
      secretKey,
      salt,
      Buffer.from(signingKeyBuf)
    );

    const deployMethod = await accountManager.getDeployMethod();
    const deployOpts = {
      from: AztecAddress.ZERO,
      fee: {
        paymentMethod: new SponsoredFeePaymentMethod(this.sponsoredFpcAddress),
      },
      skipClassPublication: true,
      skipInstancePublication: true,
      wait: { timeout: DEPLOY_TIMEOUT_MS },
    };
    await deployMethod.send(deployOpts);

    const record: AccountRecord = {
      address: accountManager.address.toString(),
      secretKey: secretKey.toString(),
      salt: salt.toString(),
      signingKey: Buffer.from(signingKeyBuf).toString("hex"),
      label,
      createdAt: Date.now(),
    };

    this.keyStore.saveAccount(record);
    this.setActive(accountManager.address, record.address);

    return record;
  }

  async restoreAccount(address: string): Promise<void> {
    const record = this.keyStore.getAccount(address);
    if (!record) {
      throw new Error(`KeyStore: no account found for ${address}`);
    }

    await this.wallet.createECDSARAccount(
      Fr.fromString(record.secretKey),
      Fr.fromString(record.salt),
      Buffer.from(record.signingKey, "hex")
    );

    this.setActive(AztecAddress.fromString(address), address);
  }

  async switchAccount(address: string): Promise<void> {
    await this.restoreAccount(address);
  }

  async importAccount(
    secretKey: string,
    salt: string,
    signingKey: string,
    label?: string
  ): Promise<AccountRecord> {
    const accountManager = await this.wallet.createECDSARAccount(
      Fr.fromString(secretKey),
      Fr.fromString(salt),
      Buffer.from(signingKey, "hex")
    );

    const record: AccountRecord = {
      address: accountManager.address.toString(),
      secretKey,
      salt,
      signingKey,
      label,
      createdAt: Date.now(),
    };

    this.keyStore.saveAccount(record);
    this.setActive(accountManager.address, record.address);

    return record;
  }

  removeAccount(address: string): void {
    this.keyStore.removeAccount(address);
    if (this.activeAddress?.toString() === address) {
      this.activeAddress = undefined;
      this.walletChanged$.publish(undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getWallet(): EmbeddedWallet {
    return this.wallet;
  }

  getSponsoredFpcAddress(): AztecAddress {
    return this.sponsoredFpcAddress;
  }

  getActiveAddress(): AztecAddress | undefined {
    return this.activeAddress;
  }

  hasActiveAccount(): boolean {
    return this.activeAddress !== undefined;
  }

  getAccounts(): AccountRecord[] {
    return this.keyStore.listAccounts();
  }

  /** Last known balance (synchronous). Updated by getBalance() and polling. */
  getLastBalance(): bigint {
    return this.balance;
  }

  /** Query the active account's FeeJuice balance from the Aztec Node. */
  async getBalance(): Promise<bigint> {
    if (!this.activeAddress) return 0n;
    try {
      const bal = await getFeeJuiceBalance(this.activeAddress, this.node);
      this.balance = bal;
      this.myBalance$.publish(bal);
      return bal;
    } catch {
      return this.balance;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  destroy(): void {
    if (this.balanceInterval !== undefined) {
      clearInterval(this.balanceInterval);
      this.balanceInterval = undefined;
    }
    this.walletChanged$.clear();
    this.myBalance$.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private setActive(aztecAddr: AztecAddress, addressStr: string): void {
    this.activeAddress = aztecAddr;
    this.keyStore.setActiveAddress(addressStr);
    this.walletChanged$.publish(aztecAddr);
    this.getBalance().catch(() => {});
  }

  private startBalancePolling(intervalMs: number): void {
    this.balanceInterval = setInterval(() => {
      this.getBalance().catch(() => {});
    }, intervalMs);
  }
}

/** Convenience factory matching createEthConnection() / createIndexerConnection() pattern. */
export async function createWalletManager(
  config: WalletManagerConfig
): Promise<WalletManager> {
  return WalletManager.create(config);
}
