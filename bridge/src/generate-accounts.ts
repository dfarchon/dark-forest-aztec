import { Fq, Fr } from "@aztec/aztec.js/fields";
import { getSchnorrInitializerlessAccountContractAddress } from "@aztec/accounts/schnorr";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { writeNetworkAccounts } from "./config.js";

type NetworkName = "mainnet" | "testnet";

const networks: Record<NetworkName, { l1ChainId: number }> = {
  mainnet: {
    l1ChainId: 1,
  },
  testnet: {
    l1ChainId: 11155111,
  },
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseNetwork(): NetworkName {
  const value = option("--network");
  if (value === "mainnet" || value === "testnet") return value;
  throw new Error("--network must be either mainnet or testnet.");
}

async function main(): Promise<void> {
  const network = parseNetwork();
  const config = networks[network];
  const ethereumPrivateKey = generatePrivateKey();
  const ethereumAccount = privateKeyToAccount(ethereumPrivateKey);
  const salt = Fr.random();
  const secretKey = Fr.random();
  const signingKey = Fq.random();
  const aztecAddress = await getSchnorrInitializerlessAccountContractAddress(
    signingKey,
    salt,
    secretKey,
  );

  writeNetworkAccounts(network, {
    l1PrivateKey: ethereumPrivateKey,
    l1Address: ethereumAccount.address,
    salt: salt.toString(),
    secretKey: secretKey.toString(),
    signingKey: signingKey.toBuffer().toString("hex"),
    aztecAddress: aztecAddress.toString(),
  });

  console.log(`Network: ${network} (L1 chain ID ${config.l1ChainId})`);
  console.log(`Ethereum address: ${ethereumAccount.address}`);
  console.log(`Aztec address:    ${aztecAddress.toString()}`);
  console.log(
    "Account keys were written to bridge/.env. Never commit or share them.",
  );
}

main().catch((error) => {
  console.error(
    `Account generation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
