import { getSchnorrInitializerlessAccountContractAddress } from "@aztec/accounts/schnorr";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fq, Fr } from "@aztec/aztec.js/fields";

import { loadConfig, writeAztecAccount } from "./config.js";

function signingKeyFromHex(value: string): Fq {
  return Fq.fromBuffer(
    Buffer.from(value.startsWith("0x") ? value.slice(2) : value, "hex"),
  );
}

function signingKeyToHex(value: Fq): string {
  return value.toBuffer().toString("hex");
}

// Address derivation is fully offline (same logic as generate-accounts.ts);
// no PXE or Aztec node connection is required until `claim`.
export async function getOrCreateL2Account(): Promise<{
  address: AztecAddress;
}> {
  const config = loadConfig();

  const existing = config.aztecAccount;
  const salt = existing ? Fr.fromString(existing.salt) : Fr.random();
  const secretKey = existing ? Fr.fromString(existing.secretKey) : Fr.random();
  const signingKey = existing
    ? signingKeyFromHex(existing.signingKey)
    : Fq.random();
  const address = await getSchnorrInitializerlessAccountContractAddress(
    signingKey,
    salt,
    secretKey,
  );

  if (existing?.address) {
    const configuredAddress = AztecAddress.fromStringUnsafe(existing.address);
    if (!configuredAddress.equals(address)) {
      throw new Error(
        `AZTEC_ACCOUNT_ADDRESS does not match the configured account keys. Derived ${address.toString()}.`,
      );
    }
  } else {
    writeAztecAccount({
      salt: salt.toString(),
      secretKey: secretKey.toString(),
      signingKey: signingKeyToHex(signingKey),
      address: address.toString(),
    });
    console.warn(
      "Created a new Aztec L2 account in bridge/.env. Back up its AZTEC_ACCOUNT_* keys securely.",
    );
  }

  return { address };
}
