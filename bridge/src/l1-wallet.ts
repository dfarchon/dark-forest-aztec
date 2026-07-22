import { createExtendedL1Client } from "@aztec/ethereum/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";

import { loadConfig, writeL1Address, writeL1Wallet } from "./config.js";

function ethereumMainnet(rpcUrl: string) {
  return {
    id: 1,
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
}

export type L1Wallet = {
  privateKey: `0x${string}`;
  address: Address;
  publicClient: PublicClient;
  extendedClient: ReturnType<typeof createExtendedL1Client>;
};

export function getOrCreateL1Wallet(): L1Wallet {
  const config = loadConfig();
  const privateKey = config.l1PrivateKey ?? generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  if (!config.l1PrivateKey) {
    writeL1Wallet({ privateKey, address: account.address });
    console.warn(
      `Created a new L1 hot wallet in ${new URL("../.env", import.meta.url).pathname}. Fund only this address.`,
    );
  } else if (!config.l1Address) {
    writeL1Address(account.address);
  }
  if (
    config.l1Address &&
    config.l1Address.toLowerCase() !== account.address.toLowerCase()
  ) {
    throw new Error(
      `L1_ADDRESS does not match L1_PRIVATE_KEY. Derived ${account.address}.`,
    );
  }
  return {
    privateKey,
    address: account.address,
    publicClient: createPublicClient({ transport: http(config.ethereumHost) }),
    // The Aztec SDK owns a forked viem type. Pass the private-key string rather than
    // a viem account object to avoid crossing the two incompatible type boundaries.
    extendedClient: createExtendedL1Client(
      [config.ethereumHost],
      privateKey,
      ethereumMainnet(config.ethereumHost),
    ),
  };
}
