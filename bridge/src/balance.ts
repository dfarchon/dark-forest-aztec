import { TestERC20Abi } from "@aztec-foundation/l1-artifacts/TestERC20Abi";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec-labs/aztec.js/utils";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, formatEther, formatUnits, http, type Address } from "viem";

import { envPath, loadConfig, type BridgeConfig } from "./config.js";

type Options = {
  address?: string;
  json: boolean;
};

function usage(message?: string): never {
  if (message) console.error(`${message}\n`);
  console.error(`Usage:
  pnpm balance [--address <aztec-address>] [--json]

L1 ETH and $AZTEC default to the bridge wallet in bridge/.env.
The Aztec address defaults to AZTEC_ACCOUNT_ADDRESS; --address overrides it.`);
  process.exit(1);
}

function parseOptions(): Options {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let address: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--address") {
      address = args[++index];
      if (!address) usage("--address requires an Aztec address.");
      continue;
    }
    usage(`Unknown option: ${arg}`);
  }

  return { address, json };
}

function resolveL1Address(config: BridgeConfig): Address {
  if (config.l1PrivateKey) {
    const derived = privateKeyToAccount(config.l1PrivateKey).address;
    if (
      config.l1Address &&
      config.l1Address.toLowerCase() !== derived.toLowerCase()
    ) {
      throw new Error(
        `L1_ADDRESS does not match L1_PRIVATE_KEY. Derived ${derived}.`,
      );
    }
    return derived;
  }
  if (config.l1Address) return config.l1Address;
  throw new Error(
    `Missing L1_PRIVATE_KEY or L1_ADDRESS in ${envPath}.`,
  );
}

function resolveL2Address(config: BridgeConfig, override?: string): AztecAddress {
  const value = override ?? config.aztecAccount?.address;
  if (!value) {
    throw new Error(
      `Missing AZTEC_ACCOUNT_ADDRESS in ${envPath} or pass --address.`,
    );
  }
  return AztecAddress.fromStringUnsafe(value);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const config = loadConfig();
  const l1Address = resolveL1Address(config);
  const l2Address = resolveL2Address(config, options.address);
  const node = createAztecNodeClient(config.aztecNodeUrl);
  const publicClient = createPublicClient({
    transport: http(config.ethereumHost),
  });

  const [chainId, info] = await Promise.all([
    publicClient.getChainId(),
    node.getNodeInfo(),
  ]);
  if (chainId !== 1) {
    throw new Error(
      `Expected Ethereum mainnet (chain ID 1), received chain ID ${chainId}.`,
    );
  }
  if (info.l1ChainId !== 1) {
    throw new Error(
      `Aztec node is connected to L1 chain ID ${info.l1ChainId}, not Ethereum mainnet.`,
    );
  }
  if (info.l1ContractAddresses.feeJuiceAddress.isZero()) {
    throw new Error(
      "The connected Aztec node does not advertise an L1 Fee Juice token.",
    );
  }

  const tokenAddress =
    info.l1ContractAddresses.feeJuiceAddress.toString() as Address;
  const decimals = Number(
    await publicClient.readContract({
      address: tokenAddress,
      abi: TestERC20Abi,
      functionName: "decimals",
    }),
  );
  const [ethWei, tokenWei, feeJuiceWei] = await Promise.all([
    publicClient.getBalance({ address: l1Address }),
    publicClient.readContract({
      address: tokenAddress,
      abi: TestERC20Abi,
      functionName: "balanceOf",
      args: [l1Address],
    }),
    getFeeJuiceBalance(l2Address, node),
  ]);

  const result = {
    l1: {
      address: l1Address,
      eth: formatEther(ethWei),
      ethWei: ethWei.toString(),
      aztec: formatUnits(tokenWei, decimals),
      aztecWei: tokenWei.toString(),
      token: tokenAddress,
    },
    l2: {
      address: l2Address.toString(),
      feeJuice: `${formatUnits(feeJuiceWei, 18)} FJ`,
      feeJuiceWei: feeJuiceWei.toString(),
    },
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`L1 wallet:     ${result.l1.address}`);
  console.log(`ETH:           ${result.l1.eth}`);
  console.log(`$AZTEC:        ${result.l1.aztec}`);
  console.log(`Aztec account: ${result.l2.address}`);
  console.log(`Fee Juice:     ${result.l2.feeJuice}`);
  console.log(`Wei:           ${result.l2.feeJuiceWei}`);
}

main().catch((error) => {
  console.error(
    `Balance query failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
