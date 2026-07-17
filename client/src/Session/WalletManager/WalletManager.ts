/**
 * WalletManager: EthConnection-equivalent for Aztec.
 *
 * Connects to an Aztec Node via createAztecNodeClient, creates a browser-embedded
 * EmbeddedWallet (with internal PXE), and manages ECDSAR accounts with
 * localStorage persistence via KeyStore.
 */

import { AcceleratorProver } from "@alejoamiras/aztec-accelerator";
import { NO_FROM } from "@aztec/aztec.js/account";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { BlockNumber, Fr } from "@aztec/aztec.js/fields";
import type { AztecNode } from "@aztec/aztec.js/node";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import {
  type AccountManager,
  ContractInitializationStatus,
  type Wallet,
} from "@aztec/aztec.js/wallet";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { Gas } from "@aztec/stdlib/gas";
import { getGasLimits } from "@aztec/wallet-sdk/base-wallet";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import {
  ACCOUNT_ADDRESS,
  ADMIN_DEPLOYER_ADDRESS,
  ADMIN_DEPLOYMENT_SALT,
  ARRIVAL_STORAGE_DEPLOYER_ADDRESS,
  ARRIVAL_STORAGE_DEPLOYMENT_SALT,
  ARTIFACT_ACTION_SYSTEM_DEPLOYER_ADDRESS,
  ARTIFACT_ACTION_SYSTEM_DEPLOYMENT_SALT,
  ARTIFACT_FIND_SYSTEM_DEPLOYER_ADDRESS,
  ARTIFACT_FIND_SYSTEM_DEPLOYMENT_SALT,
  ARTIFACT_LOCATION_STORAGE_DEPLOYER_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_DEPLOYMENT_SALT,
  ARTIFACT_PROSPECT_SYSTEM_DEPLOYER_ADDRESS,
  ARTIFACT_PROSPECT_SYSTEM_DEPLOYMENT_SALT,
  ARTIFACT_STORAGE_DEPLOYER_ADDRESS,
  ARTIFACT_STORAGE_DEPLOYMENT_SALT,
  ARTIFACT_VAULT_SYSTEM_DEPLOYER_ADDRESS,
  ARTIFACT_VAULT_SYSTEM_DEPLOYMENT_SALT,
  CONFIG_DEPLOYER_ADDRESS,
  CONFIG_DEPLOYMENT_SALT,
  CORE_DEPLOYER_ADDRESS,
  CORE_DEPLOYMENT_SALT,
  MOVE_DEPLOYER_ADDRESS,
  MOVE_DEPLOYMENT_SALT,
  PLANET_ARTIFACTS_STORAGE_DEPLOYER_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_DEPLOYMENT_SALT,
  PLANET_EVENTS_STORAGE_DEPLOYER_ADDRESS,
  PLANET_EVENTS_STORAGE_DEPLOYMENT_SALT,
  PLANET_STORAGE_DEPLOYER_ADDRESS,
  PLANET_STORAGE_DEPLOYMENT_SALT,
  PLAYER_STORAGE_DEPLOYER_ADDRESS,
  PLAYER_STORAGE_DEPLOYMENT_SALT,
  WORLD_STORAGE_DEPLOYER_ADDRESS,
  WORLD_STORAGE_DEPLOYMENT_SALT,
} from "@dfpunk/contracts";
import { AdminContractArtifact } from "@dfpunk/contracts/artifacts/Admin";
import { ArrivalStorageContractArtifact } from "@dfpunk/contracts/artifacts/ArrivalStorage";
import { ArtifactActionContractArtifact } from "@dfpunk/contracts/artifacts/ArtifactAction";
import { ArtifactFindContractArtifact } from "@dfpunk/contracts/artifacts/ArtifactFind";
import { ArtifactLocationStorageContractArtifact } from "@dfpunk/contracts/artifacts/ArtifactLocationStorage";
import { ArtifactProspectContractArtifact } from "@dfpunk/contracts/artifacts/ArtifactProspect";
import { ArtifactStorageContractArtifact } from "@dfpunk/contracts/artifacts/ArtifactStorage";
import { ArtifactValutContractArtifact } from "@dfpunk/contracts/artifacts/ArtifactValut";
import { ConfigContractArtifact } from "@dfpunk/contracts/artifacts/Config";
import { CoreContractArtifact } from "@dfpunk/contracts/artifacts/Core";
import { MoveContractArtifact } from "@dfpunk/contracts/artifacts/Move";
import { PlanetArtifactsStorageContractArtifact } from "@dfpunk/contracts/artifacts/PlanetArtifactsStorage";
import { PlanetEventsStorageContractArtifact } from "@dfpunk/contracts/artifacts/PlanetEventsStorage";
import { PlanetStorageContractArtifact } from "@dfpunk/contracts/artifacts/PlanetStorage";
import { PlayerStorageContractArtifact } from "@dfpunk/contracts/artifacts/PlayerStorage";
import { WorldStorageContractArtifact } from "@dfpunk/contracts/artifacts/WorldStorage";
import type { Monomitter } from "@dfpunk/events";
import { monomitter } from "@dfpunk/events";

import { getSponsoredFpcMinBalanceFjWei } from "../../config/env";
import { feeJuiceWeiFromGasPair } from "../../utils/sponsorFeeJuice";
import { KeyStore } from "./KeyStore";
import type {
  AccountRecord,
  SponsorDeployPreflight,
  WalletManagerConfig,
} from "./types";

const DEFAULT_BALANCE_POLL_MS = 15_000;
const DEPLOY_TIMEOUT_MS = 120_000;
/** Default PXE data store size: 128 MB (in KB). SDK default is ~128 GB which is too large for browser. */
const DEFAULT_PXE_DATA_STORE_MAP_SIZE_KB = 128 * 1024;
const GENESIS_PENDING_SENTINEL = "genesis-pending";

const WALLET_INIT_TOTAL_STEPS_BASE = 21;
const WALLET_INIT_SPONSOR_EXTRA_STEPS = 1;

/**
 * Compute a fingerprint for the current network instance by hashing block 1's header.
 * Returns a sentinel value when the network has not yet produced block 1.
 */
async function getNetworkFingerprint(node: AztecNode): Promise<string> {
  const blockNumber = await node.getBlockNumber();
  if (blockNumber < 1) return GENESIS_PENDING_SENTINEL;
  const block = await node.getBlock(BlockNumber(1));
  if (!block) return GENESIS_PENDING_SENTINEL;
  return block.hash.toString();
}

/**
 * Best-effort deletion of PXE and wallet IndexedDB databases from previous network instances.
 * Skips the database matching `currentPrefix` (belonging to the active network).
 * Uses the non-standard `indexedDB.databases()` API available in modern browsers.
 */
async function clearStaleIndexedDBs(currentPrefix?: string): Promise<void> {
  if (
    typeof indexedDB === "undefined" ||
    typeof indexedDB.databases !== "function"
  ) {
    return;
  }
  try {
    const databases = await indexedDB.databases();
    const stalePatterns = [/^pxe_data_/, /^wallet_data_/];
    const deletions = databases
      .filter(
        (db) =>
          db.name &&
          stalePatterns.some((p) => p.test(db.name!)) &&
          (!currentPrefix || !db.name!.startsWith(currentPrefix))
      )
      .map(
        (db) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(db.name!);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })
      );
    await Promise.all(deletions);
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Register game contracts (system + storage) with the wallet's PXE so simulate() and send() can run.
 * Requires deployer + salt from @dfpunk/contracts (run sync-env-and-artifacts after deploy).
 * Optionally reports progress per contract via onRegisterProgress(currentStep, contractName).
 */
async function registerGameContractsWithPxe(
  wallet: Wallet,
  admin: AztecAddress,
  contractStartStep: number,
  onRegisterProgress?: (currentStep: number, contractName: string) => void
): Promise<void> {
  const specs: Array<{
    deployer: string;
    salt: string;
    artifact: typeof CoreContractArtifact;
    name: string;
  }> = [
    {
      deployer: CONFIG_DEPLOYER_ADDRESS,
      salt: CONFIG_DEPLOYMENT_SALT,
      artifact: ConfigContractArtifact,
      name: "Config",
    },
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
    {
      deployer: PLANET_STORAGE_DEPLOYER_ADDRESS,
      salt: PLANET_STORAGE_DEPLOYMENT_SALT,
      artifact: PlanetStorageContractArtifact,
      name: "PlanetStorage",
    },
    {
      deployer: PLAYER_STORAGE_DEPLOYER_ADDRESS,
      salt: PLAYER_STORAGE_DEPLOYMENT_SALT,
      artifact: PlayerStorageContractArtifact,
      name: "PlayerStorage",
    },
    {
      deployer: PLANET_EVENTS_STORAGE_DEPLOYER_ADDRESS,
      salt: PLANET_EVENTS_STORAGE_DEPLOYMENT_SALT,
      artifact: PlanetEventsStorageContractArtifact,
      name: "PlanetEventsStorage",
    },
    {
      deployer: PLANET_ARTIFACTS_STORAGE_DEPLOYER_ADDRESS,
      salt: PLANET_ARTIFACTS_STORAGE_DEPLOYMENT_SALT,
      artifact: PlanetArtifactsStorageContractArtifact,
      name: "PlanetArtifactsStorage",
    },
    {
      deployer: ARRIVAL_STORAGE_DEPLOYER_ADDRESS,
      salt: ARRIVAL_STORAGE_DEPLOYMENT_SALT,
      artifact: ArrivalStorageContractArtifact,
      name: "ArrivalStorage",
    },
    {
      deployer: ARTIFACT_STORAGE_DEPLOYER_ADDRESS,
      salt: ARTIFACT_STORAGE_DEPLOYMENT_SALT,
      artifact: ArtifactStorageContractArtifact,
      name: "ArtifactStorage",
    },
    {
      deployer: ARTIFACT_LOCATION_STORAGE_DEPLOYER_ADDRESS,
      salt: ARTIFACT_LOCATION_STORAGE_DEPLOYMENT_SALT,
      artifact: ArtifactLocationStorageContractArtifact,
      name: "ArtifactLocationStorage",
    },
    {
      deployer: WORLD_STORAGE_DEPLOYER_ADDRESS,
      salt: WORLD_STORAGE_DEPLOYMENT_SALT,
      artifact: WorldStorageContractArtifact,
      name: "WorldStorage",
    },
    {
      deployer: ARTIFACT_ACTION_SYSTEM_DEPLOYER_ADDRESS,
      salt: ARTIFACT_ACTION_SYSTEM_DEPLOYMENT_SALT,
      artifact: ArtifactActionContractArtifact,
      name: "ArtifactAction",
    },
    {
      deployer: ARTIFACT_FIND_SYSTEM_DEPLOYER_ADDRESS,
      salt: ARTIFACT_FIND_SYSTEM_DEPLOYMENT_SALT,
      artifact: ArtifactFindContractArtifact,
      name: "ArtifactFind",
    },
    {
      deployer: ARTIFACT_PROSPECT_SYSTEM_DEPLOYER_ADDRESS,
      salt: ARTIFACT_PROSPECT_SYSTEM_DEPLOYMENT_SALT,
      artifact: ArtifactProspectContractArtifact,
      name: "ArtifactProspect",
    },
    {
      deployer: ARTIFACT_VAULT_SYSTEM_DEPLOYER_ADDRESS,
      salt: ARTIFACT_VAULT_SYSTEM_DEPLOYMENT_SALT,
      artifact: ArtifactValutContractArtifact,
      name: "ArtifactVault",
    },
  ];
  let step = contractStartStep;
  for (const { deployer, salt, artifact, name } of specs) {
    if (!deployer || !salt) continue;
    onRegisterProgress?.(step, name);
    try {
      const instance = await getContractInstanceFromInstantiationParams(
        artifact,
        {
          deployer: AztecAddress.fromStringUnsafe(deployer),
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
    step += 1;
  }
}

/**
 * Register SponsoredFPC with the wallet for sponsor mode: optional address override
 * (fetched from node) or canonical salt-derived instance.
 */
async function registerSponsoredFpcWithWallet(
  node: AztecNode,
  wallet: Wallet,
  config: WalletManagerConfig,
  onRegisterProgress?: (message: string) => void
): Promise<AztecAddress | undefined> {
  if (!config.sponsorMode) return undefined;

  const override = config.sponsoredFpcAddressOverride?.trim();
  if (override) {
    const addr = AztecAddress.fromStringUnsafe(override);
    const instance = await node.getContract(addr);
    if (!instance) {
      throw new Error(
        `SponsoredFPC not found on node at ${override}. Check Aztec node URL and address, or clear the override in Connection settings.`
      );
    }
    onRegisterProgress?.("Registering Sponsored FPC (custom address)");
    await wallet.registerContract(instance, SponsoredFPCContractArtifact);
    return instance.address;
  }

  const sponsoredFPC = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
  onRegisterProgress?.("Registering Sponsored FPC");
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  return sponsoredFPC.address;
}

export class WalletManager {
  private readonly node: AztecNode;
  private readonly wallet: Wallet;
  private readonly sponsoredFpcAddress: AztecAddress | undefined;
  private readonly keyStore: KeyStore;
  private readonly isExternal: boolean;
  private activeAddress: AztecAddress | undefined;
  private balanceInterval: ReturnType<typeof setInterval> | undefined;
  private balance: bigint = 0n;

  public readonly walletChanged$: Monomitter<AztecAddress | undefined>;
  public readonly myBalance$: Monomitter<bigint>;

  private constructor(
    node: AztecNode,
    wallet: Wallet,
    sponsoredFpcAddress: AztecAddress | undefined,
    keyStore: KeyStore,
    isExternal: boolean
  ) {
    this.node = node;
    this.wallet = wallet;
    this.sponsoredFpcAddress = sponsoredFpcAddress;
    this.keyStore = keyStore;
    this.isExternal = isExternal;
    this.walletChanged$ = monomitter(true);
    this.myBalance$ = monomitter(true);
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static async create(config: WalletManagerConfig): Promise<WalletManager> {
    const node = createAztecNodeClient(config.nodeUrl);
    const onProgress = config.onWalletProgress;
    const total =
      WALLET_INIT_TOTAL_STEPS_BASE +
      (config.sponsorMode ? WALLET_INIT_SPONSOR_EXTRA_STEPS : 0);

    onProgress?.(1, total, "Connecting to node");
    await waitForNode(node);

    const mgr = await WalletManager._initWallet(node, config, onProgress);

    const savedAddr = mgr.keyStore.getActiveAddress();
    if (savedAddr) {
      try {
        onProgress?.(total, total, "Restoring account");
        await mgr.restoreAccount(savedAddr);
      } catch (err) {
        console.warn("[WalletManager] Failed to restore saved account:", err);
        console.warn("[WalletManager] Clearing stale PXE data and retrying...");
        mgr.destroy();
        await clearStaleIndexedDBs();
        mgr.keyStore.clearActiveAddress();

        const retryMgr = await WalletManager._initWallet(
          node,
          config,
          onProgress
        );
        retryMgr.startBalancePolling(
          config.balancePollIntervalMs ?? DEFAULT_BALANCE_POLL_MS
        );
        return retryMgr;
      }
    }

    onProgress?.(total, total, "Finalizing");
    mgr.startBalancePolling(
      config.balancePollIntervalMs ?? DEFAULT_BALANCE_POLL_MS
    );

    return mgr;
  }

  /**
   * Force-clear all PXE IndexedDB databases and reset the active account pointer,
   * then create a fresh WalletManager. Account records are preserved so they can
   * be re-deployed on the new network. Useful as a manual "reset wallet cache" action in UI.
   */
  static async resetAndCreate(
    config: WalletManagerConfig
  ): Promise<WalletManager> {
    await clearStaleIndexedDBs();
    new KeyStore(config.storagePrefix).clearActiveAddress();
    return WalletManager.create(config);
  }

  /**
   * Build WalletManager around an externally connected wallet (browser extension).
   * Keeps game contract registration and sponsored fee flow unchanged.
   */
  static async createFromExternalWallet(
    wallet: Wallet,
    config: WalletManagerConfig,
    preferredAddress?: AztecAddress
  ): Promise<WalletManager> {
    const node = createAztecNodeClient(config.nodeUrl);
    await waitForNode(node);

    let sponsoredFpcAddress: AztecAddress | undefined = undefined;
    if (config.sponsorMode) {
      try {
        sponsoredFpcAddress = await registerSponsoredFpcWithWallet(
          node,
          wallet,
          config
        );
      } catch (err) {
        console.warn(
          "[WalletManager] Failed to register SponsoredFPC on external wallet:",
          err
        );
      }
    }

    const admin = AztecAddress.fromStringUnsafe(ACCOUNT_ADDRESS);
    const contractStartStep = config.sponsorMode ? 6 : 5;
    await registerGameContractsWithPxe(wallet, admin, contractStartStep);

    const keyStore = new KeyStore(
      `${config.storagePrefix ?? "dfpunk"}:external`
    );
    const mgr = new WalletManager(
      node,
      wallet,
      sponsoredFpcAddress,
      keyStore,
      true
    );

    mgr.activeAddress = await WalletManager.resolveExternalAddress(
      wallet,
      preferredAddress
    );
    if (!mgr.activeAddress) {
      throw new Error(
        "External wallet did not provide any account. Please reconnect and select an account."
      );
    }

    mgr.walletChanged$.publish(mgr.activeAddress);
    mgr.startBalancePolling(
      config.balancePollIntervalMs ?? DEFAULT_BALANCE_POLL_MS
    );

    return mgr;
  }

  /**
   * Core wallet initialisation: fingerprint check, PXE creation, contract registration.
   * Extracted so `create()` can retry with a clean slate on stale-data errors.
   */
  private static async _initWallet(
    node: AztecNode,
    config: WalletManagerConfig,
    onProgress?: WalletManagerConfig["onWalletProgress"]
  ): Promise<WalletManager> {
    const keyStore = new KeyStore(config.storagePrefix);
    const total =
      WALLET_INIT_TOTAL_STEPS_BASE +
      (config.sponsorMode ? WALLET_INIT_SPONSOR_EXTRA_STEPS : 0);

    const fingerprint = await getNetworkFingerprint(node);
    const storedFingerprint = keyStore.getNetworkFingerprint();
    const networkChanged = storedFingerprint !== fingerprint;

    const l1Addresses = await node.getL1ContractAddresses();
    const rollupAddr = l1Addresses.rollupAddress.toString();
    const fpSuffix =
      fingerprint === GENESIS_PENDING_SENTINEL
        ? "genesis"
        : fingerprint.slice(2, 10);
    const pxeDataDir = `pxe_data_${rollupAddr}_${fpSuffix}`;

    onProgress?.(2, total, "Checking network");

    onProgress?.(3, total, "Preparing storage");
    if (networkChanged) {
      if (storedFingerprint) {
        console.warn(
          "[WalletManager] Network change detected, clearing stale PXE data"
        );
      } else {
        console.info(
          "[WalletManager] No stored fingerprint, clearing PXE data to avoid stale state"
        );
      }
      await clearStaleIndexedDBs(pxeDataDir);
      keyStore.clearActiveAddress();
      keyStore.setNetworkFingerprint(fingerprint);
    }

    onProgress?.(4, total, "Creating PXE");
    const wallet = await EmbeddedWallet.create(node, {
      pxe: {
        dataDirectory: pxeDataDir,
        dataStoreMapSizeKb:
          config.pxeConfig?.dataStoreMapSizeKb ??
          DEFAULT_PXE_DATA_STORE_MAP_SIZE_KB,
        ...config.pxeConfig,
        ...(config.pxeConfig?.proverEnabled && config.proverUrl
          ? (() => {
              const url = new URL(config.proverUrl!);
              const prover = new AcceleratorProver({
                accelerator: {
                  port: parseInt(url.port, 10) || 59833,
                  host: url.hostname,
                },
                onPhase: (phase, data) => {
                  console.log(`Phase: ${phase}`, data);
                },
              });
              return { proverOrOptions: prover };
            })()
          : {}),
      },
    });

    const admin = AztecAddress.fromStringUnsafe(ACCOUNT_ADDRESS);
    let sponsoredFpcAddress: AztecAddress | undefined = undefined;

    if (config.sponsorMode) {
      sponsoredFpcAddress = await registerSponsoredFpcWithWallet(
        node,
        wallet,
        config,
        (msg) => onProgress?.(5, total, msg)
      );
    }

    const contractStartStep = config.sponsorMode ? 6 : 5;
    await registerGameContractsWithPxe(
      wallet,
      admin,
      contractStartStep,
      (step, name) => onProgress?.(step, total, `Registering ${name}`)
    );

    return new WalletManager(
      node,
      wallet,
      sponsoredFpcAddress,
      keyStore,
      false
    );
  }

  // ---------------------------------------------------------------------------
  // Account management
  // ---------------------------------------------------------------------------

  async createAccount(
    label?: string,
    onStatus?: (msg: string) => void
  ): Promise<AccountRecord & { deployed: boolean }> {
    const wallet = this.getEmbeddedWallet("createAccount");
    const salt = Fr.random();
    const secretKey = Fr.random();
    const signingKeyBuf = Fr.random().toBuffer().slice(0, 32);

    onStatus?.("Creating account keys...");
    const accountManager = await wallet.createECDSARAccount(
      secretKey,
      salt,
      Buffer.from(signingKeyBuf)
    );

    onStatus?.("Checking deployment status...");
    const metadata = await this.wallet.getContractMetadata(
      accountManager.address
    );
    const deployed =
      metadata.initializationStatus ===
      ContractInitializationStatus.INITIALIZED;

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

    return { ...record, deployed };
  }

  async restoreAccount(
    address: string,
    onStatus?: (msg: string) => void
  ): Promise<{ deployed: boolean }> {
    const wallet = this.getEmbeddedWallet("restoreAccount");
    const record = this.keyStore.getAccount(address);
    if (!record) {
      throw new Error(`KeyStore: no account found for ${address}`);
    }

    const accountManager = await wallet.createECDSARAccount(
      Fr.fromString(record.secretKey),
      Fr.fromString(record.salt),
      Buffer.from(record.signingKey, "hex")
    );

    onStatus?.("Checking deployment status...");
    const metadata = await this.wallet.getContractMetadata(
      accountManager.address
    );
    const deployed =
      metadata.initializationStatus ===
      ContractInitializationStatus.INITIALIZED;

    // Use the selected account address from options/list as active target.
    this.setActive(AztecAddress.fromStringUnsafe(address), address);
    return { deployed };
  }

  async switchAccount(
    address: string,
    onStatus?: (msg: string) => void
  ): Promise<{ deployed: boolean }> {
    return this.restoreAccount(address, onStatus);
  }

  async importAccount(
    secretKey: string,
    salt: string,
    signingKey: string,
    label?: string,
    onStatus?: (msg: string) => void
  ): Promise<AccountRecord & { deployed: boolean }> {
    const wallet = this.getEmbeddedWallet("importAccount");
    const accountManager = await wallet.createECDSARAccount(
      Fr.fromString(secretKey),
      Fr.fromString(salt),
      Buffer.from(signingKey, "hex")
    );

    onStatus?.("Checking deployment status...");
    const metadata = await this.wallet.getContractMetadata(
      accountManager.address
    );
    const deployed =
      metadata.initializationStatus ===
      ContractInitializationStatus.INITIALIZED;

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

    return { ...record, deployed };
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

  getWallet(): Wallet {
    return this.wallet;
  }

  /**
   * When sponsorMode is enabled, returns the SponsoredFPC address so we can
   * pay fees via SponsoredFeePaymentMethod during account deployment.
   */
  getSponsoredFpcAddress(): AztecAddress | undefined {
    return this.sponsoredFpcAddress;
  }

  getActiveAddress(): AztecAddress | undefined {
    return this.activeAddress;
  }

  isExternalWallet(): boolean {
    return this.isExternal;
  }

  hasActiveAccount(): boolean {
    return this.activeAddress !== undefined;
  }

  getAccounts(): AccountRecord[] {
    return this.keyStore.listAccounts();
  }

  getActiveAccountRecord(): AccountRecord | null {
    const addr = this.activeAddress?.toString();
    if (!addr) return null;
    return this.keyStore.getAccount(addr);
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
    } catch (err) {
      console.error(
        "[WalletManager] getBalance failed for",
        this.activeAddress.toString(),
        err
      );
      return this.balance;
    }
  }

  /**
   * FeeJuice balance held by the SponsoredFPC used for sponsored fees.
   * @returns `undefined` when not using sponsored fees; `0n` when depleted or on query failure.
   */
  async getSponsoredFpcFeeJuiceBalance(): Promise<bigint | undefined> {
    if (!this.sponsoredFpcAddress) return undefined;
    try {
      return await getFeeJuiceBalance(this.sponsoredFpcAddress, this.node);
    } catch (err) {
      console.error(
        "[WalletManager] getSponsoredFpcFeeJuiceBalance failed for",
        this.sponsoredFpcAddress.toString(),
        err
      );
      return 0n;
    }
  }

  /**
   * Preflight SponsoredFPC FeeJuice vs estimated account-deploy cost (simulate when embedded).
   */
  async getSponsorDeployPreflight(): Promise<
    SponsorDeployPreflight | undefined
  > {
    if (!this.sponsoredFpcAddress) return undefined;

    const minWei = getSponsoredFpcMinBalanceFjWei();
    const balanceWei = await getFeeJuiceBalance(
      this.sponsoredFpcAddress,
      this.node
    );

    if (this.isExternal) {
      return {
        balanceWei,
        requiredWei: minWei,
        sufficient: balanceWei >= minWei,
        estimateSource: "threshold",
      };
    }

    const active = this.activeAddress;
    if (!active) return undefined;
    const addrStr = active.toString();
    const record = this.keyStore.getAccount(addrStr);
    if (!record) return undefined;

    const wallet = this.getEmbeddedWallet("getSponsorDeployPreflight");
    const accountManager = await wallet.createECDSARAccount(
      Fr.fromString(record.secretKey),
      Fr.fromString(record.salt),
      Buffer.from(record.signingKey, "hex")
    );

    const metadata = await this.wallet.getContractMetadata(
      accountManager.address
    );
    if (
      metadata.initializationStatus === ContractInitializationStatus.INITIALIZED
    ) {
      return {
        balanceWei,
        requiredWei: minWei,
        sufficient: balanceWei >= minWei,
        estimateSource: "threshold",
      };
    }

    try {
      const deployMethod = await accountManager.getDeployMethod();
      const sim = await deployMethod.simulate({
        from: NO_FROM,
        fee: {
          paymentMethod: new SponsoredFeePaymentMethod(
            this.sponsoredFpcAddress
          ),
        },
        skipClassPublication: true,
        skipInstancePublication: true,
        includeMetadata: true,
      });
      const fees = await this.node.getCurrentMinFees();
      const gasUsed = sim.gasUsed;
      if (!gasUsed) {
        console.warn(
          "[WalletManager] sponsor deploy simulate returned no gasUsed"
        );
        return {
          balanceWei,
          requiredWei: minWei,
          sufficient: balanceWei >= minWei,
          estimateSource: "simulate_failed",
        };
      }
      const { txsLimits } = await this.node.getNodeInfo();
      const { gasLimits, teardownGasLimits } = getGasLimits(
        gasUsed,
        Gas.from(txsLimits.gas),
        0.1
      );
      const estWei = feeJuiceWeiFromGasPair(gasLimits, teardownGasLimits, fees);
      const requiredWei = estWei > minWei ? estWei : minWei;
      return {
        balanceWei,
        requiredWei,
        sufficient: balanceWei >= requiredWei,
        estimateSource: "simulate",
      };
    } catch (err) {
      console.warn("[WalletManager] sponsor deploy simulate failed:", err);
      return {
        balanceWei,
        requiredWei: minWei,
        sufficient: balanceWei >= minWei,
        estimateSource: "simulate_failed",
      };
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

  /**
   * Deploy the account contract on-chain if it is not already deployed.
   * Queries the node for the contract instance; if absent, sends a deploy tx.
   * @returns `true` if a deployment was performed, `false` if already deployed.
   */
  private async deployAccountIfNeeded(
    accountManager: AccountManager,
    onStatus?: (msg: string) => void
  ): Promise<boolean> {
    onStatus?.("Checking deployment status...");
    const metadata = await this.wallet.getContractMetadata(
      accountManager.address
    );
    if (
      metadata.initializationStatus === ContractInitializationStatus.INITIALIZED
    )
      return false;

    onStatus?.("Account not deployed on current network. Deploying...");
    console.info(
      `[WalletManager] Account ${accountManager.address} not deployed on-chain, deploying...`
    );
    const deployMethod = await accountManager.getDeployMethod();
    onStatus?.("Waiting for deploy transaction...");
    const commonOpts = {
      skipClassPublication: true,
      skipInstancePublication: true,
      wait: { timeout: DEPLOY_TIMEOUT_MS },
    } as const;

    if (this.sponsoredFpcAddress) {
      try {
        await deployMethod.send({
          from: NO_FROM,
          fee: {
            paymentMethod: new SponsoredFeePaymentMethod(
              this.sponsoredFpcAddress
            ),
          },
          ...commonOpts,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("Insufficient fee payer balance") ||
          msg.includes("insufficient fee payer balance")
        ) {
          throw new Error(
            `Account deployment failed: SponsoredFPC fee payer balance too low (${msg}). Fund the SponsoredFPC contract or update SponsoredFPC in Connection settings, save, then choose Continue after updating SponsoredFPC in the terminal to retry. Use Refresh page if the app still does not pick up your changes.`
          );
        }
        throw err;
      }
      return true;
    }

    // Non-sponsor mode: follow doc-recommended NO_FROM sender.
    try {
      await deployMethod.send({
        from: NO_FROM,
        ...commonOpts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[WalletManager] NO_FROM deploy sender failed: ${msg}`);
      throw err;
    }
    return true;
  }

  /**
   * Ensures the currently active account contract is deployed.
   * Intended flow: after user gets FeeJuice, call this before submitting gameplay txs.
   */
  public async deployActiveAccountIfNeeded(
    onStatus?: (msg: string) => void
  ): Promise<{ deployedNow: boolean }> {
    const active = this.activeAddress;
    if (!active) throw new Error("No active account");

    const addrStr = active.toString();
    const record = this.keyStore.getAccount(addrStr);
    if (!record) throw new Error(`KeyStore: no account found for ${addrStr}`);

    const wallet = this.getEmbeddedWallet("deployActiveAccountIfNeeded");
    const accountManager = await wallet.createECDSARAccount(
      Fr.fromString(record.secretKey),
      Fr.fromString(record.salt),
      Buffer.from(record.signingKey, "hex")
    );

    const deployedNow = await this.deployAccountIfNeeded(
      accountManager,
      onStatus
    );
    return { deployedNow };
  }

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

  private assertEmbeddedOnly(action: string): void {
    if (this.isExternal) {
      throw new Error(
        `WalletManager.${action} is unavailable for external wallets`
      );
    }
  }

  private getEmbeddedWallet(action: string): EmbeddedWallet {
    this.assertEmbeddedOnly(action);
    return this.wallet as EmbeddedWallet;
  }

  private static async resolveExternalAddress(
    wallet: Wallet,
    preferredAddress?: AztecAddress
  ): Promise<AztecAddress | undefined> {
    const accounts = await wallet.getAccounts();
    if (preferredAddress) {
      const preferred = preferredAddress.toString();
      const matched = accounts.find(
        (account) => account.item.toString() === preferred
      );
      if (matched) return matched.item;
    }

    const walletWithGetAddress = wallet as Wallet & {
      getAddress?: () => Promise<AztecAddress> | AztecAddress;
    };
    if (typeof walletWithGetAddress.getAddress === "function") {
      const maybeAddr = await walletWithGetAddress.getAddress();
      if (maybeAddr) return maybeAddr;
    }

    return accounts[0]?.item;
  }
}

/** Convenience factory matching createEthConnection() / createIndexerConnection() pattern. */
export async function createWalletManager(
  config: WalletManagerConfig
): Promise<WalletManager> {
  return WalletManager.create(config);
}
