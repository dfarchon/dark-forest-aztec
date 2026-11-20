/**
 * Zero-invasion `GameUIManager` -> `FogNameService` session registry and React hooks.
 *
 * Binds one `FogNameService` per `GameUIManager` via a `WeakMap` using existing
 * public Dark Forest APIs so `GameManager`, `GameUIManager`, `WalletManager`,
 * and `AppHooks` remain completely untouched.
 */

import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import type { EthAddress } from "@dfpunk/types";
import { useEffect, useState } from "react";

import type GameUIManager from "../../Backend/GameLogic/GameUIManager";
import {
  getEffectiveNodeUrl,
  getEffectiveUseSponsoredFpc,
} from "../../config/connection";
import {
  addressesEqual,
  FOG_DEPLOYMENT,
  FOG_NAMESERVER_URL,
  FogError,
  FogNameService,
  type FogNameServiceState,
  type FogNameWriteOutcome,
  type InspectableAztecNode,
  normalizeRootFogName,
} from "./FogNameService";

export {
  addressesEqual,
  FOG_DEPLOYMENT,
  FOG_NAMESERVER_URL,
  FogError,
  type FogNameServiceState,
  type FogNameWriteOutcome,
  normalizeRootFogName,
};

interface BoundSession {
  readonly service: FogNameService;
  readonly dispose: () => void;
}

const sessions = new WeakMap<GameUIManager, BoundSession>();
let cachedNode: { url: string; node: InspectableAztecNode } | undefined;

export function getAztecNodeClientOptions(
  url: string
): { maxBatchSize?: number } | undefined {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "drpc.org" || hostname.endsWith(".drpc.org")) {
    return { maxBatchSize: 3 };
  }
  return undefined;
}

function getSharedAztecNode(): InspectableAztecNode | undefined {
  if (typeof window === "undefined") return undefined;
  let url = "";
  try {
    url = getEffectiveNodeUrl().trim();
  } catch {
    return undefined;
  }
  if (!url) return undefined;
  if (cachedNode?.url === url) return cachedNode.node;
  let opts: { maxBatchSize?: number } | undefined;
  try {
    opts = getAztecNodeClientOptions(url);
  } catch {
    return undefined;
  }
  const node = createAztecNodeClient(url, opts) as InspectableAztecNode;
  cachedNode = { url, node };
  return node;
}

function readActiveAccount(
  uiManager: GameUIManager | undefined
): EthAddress | undefined {
  if (!uiManager) return undefined;
  const walletAddr = uiManager
    .getGameManager?.()
    ?.getContractAPI?.()
    ?.getWalletManager?.()
    ?.getActiveAddress?.()
    ?.toString();
  return (walletAddr as EthAddress | undefined) ?? uiManager.getAccount();
}

export function getFogNameService(
  uiManager: GameUIManager | undefined
): FogNameService | undefined {
  if (!uiManager) return undefined;
  const existing = sessions.get(uiManager);
  if (existing) return existing.service;

  const getWalletManager = () =>
    uiManager.getGameManager?.()?.getContractAPI?.()?.getWalletManager?.();

  const service = new FogNameService({
    getNode: getSharedAztecNode,
    getActiveAddress: () => readActiveAccount(uiManager),
    getBurnerSession: () => {
      const wm = getWalletManager();
      if (!wm || wm.isClosed()) return undefined;
      const account = wm.getActiveAddress();
      if (!account) return undefined;
      let useSponsoredFpc = false;
      if (typeof window !== "undefined") {
        try {
          useSponsoredFpc = getEffectiveUseSponsoredFpc();
        } catch {
          useSponsoredFpc = false;
        }
      }
      return {
        wallet: wm.getWallet(),
        account,
        isBurner: !wm.isExternalWallet(),
        useSponsoredFpc,
        sponsoredFpcAddress: wm.getSponsoredFpcAddress(),
      };
    },
  });

  const walletSub = getWalletManager()?.walletChanged$?.subscribe(() => {
    service.notifyContextChanged();
  });

  const dispose = () => {
    walletSub?.unsubscribe();
    service.destroy();
  };

  sessions.set(uiManager, { service, dispose });
  return service;
}

export function destroyFogNameService(
  uiManager: GameUIManager | undefined
): void {
  if (!uiManager) return;
  const existing = sessions.get(uiManager);
  if (!existing) return;
  sessions.delete(uiManager);
  existing.dispose();
}

/** Reactive active account hook subscribing to `WalletManager.walletChanged$`. */
export function useActiveAccount(
  uiManager: GameUIManager | undefined
): EthAddress | undefined {
  const [account, setAccount] = useState<EthAddress | undefined>(() =>
    readActiveAccount(uiManager)
  );
  useEffect(() => {
    setAccount(readActiveAccount(uiManager));
    const walletChanged$ = uiManager
      ?.getGameManager?.()
      ?.getContractAPI?.()
      ?.getWalletManager?.()?.walletChanged$;
    if (!walletChanged$) return;
    const sub = walletChanged$.subscribe(() => {
      setAccount(readActiveAccount(uiManager));
    });
    return () => sub.unsubscribe();
  }, [uiManager]);
  return account;
}

export function useFogNameState(
  uiManager: GameUIManager | undefined
): FogNameServiceState | undefined {
  const service = getFogNameService(uiManager);
  const [state, setState] = useState<FogNameServiceState | undefined>(() =>
    service?.getState()
  );
  useEffect(() => {
    if (!service) {
      setState(undefined);
      return;
    }
    setState(service.getState());
    const sub = service.state$.subscribe(setState);
    return () => sub.unsubscribe();
  }, [service]);
  return state;
}

export function useVerifiedFogName(
  uiManager: GameUIManager | undefined,
  address: string | undefined
): string | undefined {
  const service = getFogNameService(uiManager);
  const [name, setName] = useState<string | undefined>(() =>
    service?.getVerifiedName(address)
  );
  useEffect(() => {
    if (!service || !address) {
      setName(undefined);
      return;
    }
    const stop = service.observeAddress(address);
    setName(service.getVerifiedName(address));
    const sub = service.state$.subscribe(() => {
      setName(service.getVerifiedName(address));
    });
    return () => {
      sub.unsubscribe();
      stop();
    };
  }, [service, address]);
  return name;
}
