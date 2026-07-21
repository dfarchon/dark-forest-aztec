import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { formatUnits } from "viem";

import { envPath } from "./config.js";

type Options = {
  address?: string;
  json: boolean;
};

function usage(message?: string): never {
  if (message) console.error(`${message}\n`);
  console.error(`Usage:
  pnpm balance [--address <aztec-address>] [--json]

The address defaults to AZTEC_ACCOUNT_ADDRESS in bridge/.env.`);
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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name} in ${envPath}${name === "AZTEC_ACCOUNT_ADDRESS" ? " or pass --address" : ""}.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const nodeUrl = requiredEnv("AZTEC_NODE_URL");
  const address = AztecAddress.fromStringUnsafe(
    options.address ?? requiredEnv("AZTEC_ACCOUNT_ADDRESS"),
  );
  const node = createAztecNodeClient(nodeUrl);
  const balanceWei = await getFeeJuiceBalance(address, node);
  const result = {
    address: address.toString(),
    balance: `${formatUnits(balanceWei, 18)} FJ`,
    balanceWei: balanceWei.toString(),
    node: nodeUrl,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Aztec account: ${result.address}`);
  console.log(`Fee Juice:     ${result.balance}`);
  console.log(`Wei:           ${result.balanceWei}`);
}

main().catch((error) => {
  console.error(
    `Balance query failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
