import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACTS_CONFIG,
  validateContractsConfig,
} from "./contractsConfig.ts";

test("validateContractsConfig accepts workspace devnet contracts", () => {
  const config = validateContractsConfig();

  assert.equal(config.startBlock, CONTRACTS_CONFIG.startBlock);
  assert.equal(config.addresses.world, CONTRACTS_CONFIG.addresses.world);
  assert.equal(config.addresses.core, CONTRACTS_CONFIG.addresses.core);
});

test("validateContractsConfig rejects malformed addresses", () => {
  assert.throws(
    () =>
      validateContractsConfig({
        ...CONTRACTS_CONFIG,
        addresses: {
          ...CONTRACTS_CONFIG.addresses,
          world: "not-an-address",
        },
      }),
    /world/i,
  );
});

test("validateContractsConfig rejects duplicate addresses", () => {
  assert.throws(
    () =>
      validateContractsConfig({
        ...CONTRACTS_CONFIG,
        addresses: {
          ...CONTRACTS_CONFIG.addresses,
          player: CONTRACTS_CONFIG.addresses.world,
        },
      }),
    /duplicate/i,
  );
});
