import type { ChainInfo } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import type { Wallet } from "@aztec/aztec.js/wallet";
import {
  type DiscoverySession,
  type PendingConnection,
  WalletManager,
  type WalletProvider,
} from "@aztec/wallet-sdk/manager";

const APP_ID = "dfpunk";
// App-level default so wallet discovery completes quickly without requiring
// every caller to override the SDK's longer fallback timeout.
const DEFAULT_WALLET_DISCOVERY_TIMEOUT_MS = 5_000;

async function getChainInfo(nodeUrl: string): Promise<ChainInfo> {
  const node = createAztecNodeClient(nodeUrl);
  const info = await node.getNodeInfo();
  return {
    chainId: Fr.fromString(info.l1ChainId.toString()),
    version: Fr.fromString(info.rollupVersion.toString()),
  };
}

export async function discoverExtensionWallets(
  nodeUrl: string,
  timeout?: number
): Promise<DiscoverySession> {
  const chainInfo = await getChainInfo(nodeUrl);
  const discoveryTimeout = timeout ?? DEFAULT_WALLET_DISCOVERY_TIMEOUT_MS;

  return WalletManager.configure({
    extensions: { enabled: true },
  }).getAvailableWallets({
    chainInfo,
    appId: APP_ID,
    timeout: discoveryTimeout,
  });
}

export async function discoverExtensionWalletById(
  nodeUrl: string,
  providerId: string,
  timeout?: number
): Promise<WalletProvider | null> {
  const discovery = await discoverExtensionWallets(nodeUrl, timeout);

  try {
    for await (const provider of discovery.wallets) {
      if (provider.id === providerId) {
        discovery.cancel();
        return provider;
      }
    }

    await discovery.done;
    return null;
  } finally {
    discovery.cancel();
  }
}

export async function initiateConnection(
  provider: WalletProvider
): Promise<PendingConnection> {
  return provider.establishSecureChannel(APP_ID);
}

export async function confirmConnection(
  pendingConnection: PendingConnection
): Promise<Wallet> {
  return pendingConnection.confirm();
}

export function cancelConnection(pendingConnection: PendingConnection): void {
  pendingConnection.cancel();
}

export async function disconnectProvider(
  provider: WalletProvider
): Promise<void> {
  await provider.disconnect();
}

export type { DiscoverySession, PendingConnection, WalletProvider };
