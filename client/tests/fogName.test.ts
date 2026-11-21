import assert from "node:assert/strict";
import test from "node:test";

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { Fr } from "@aztec-labs/aztec.js/fields";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
import type { FogContext } from "fog-sdk";

import {
  addressesEqual,
  FOG_DEPLOYMENT,
  FOG_NAMESERVER_URL,
  FogError,
  getAztecNodeClientOptions,
  normalizeRootFogName,
} from "../src/Session/FogName/index.ts";
import {
  type BurnerWalletSession,
  FogNameService,
  type FogWriteSdk,
  type InspectableAztecNode,
} from "../src/Session/FogName/FogNameService.ts";

const MAINNET_V8_CLASS_ID =
  "0x1afeb9d9e89771a17fe91d5d8eb08f18598708c3d0077db1f96585b275792cf3";
const CORE_CLASS_SLOT = 0x17n;
const V8_RELEASE_ATTESTATION_SLOT =
  0x184f8b55dfeb3faa6f40b0c4e47c2bb48ca24c7199fc0bda8762d2951e5652den;
const ANS_CORE_FAMILY = 0x414e535f434f5245n;

const BURNER_ADDR = AztecAddress.fromStringUnsafe(
  "0x1111111111111111111111111111111111111111111111111111111111111111"
);
const SPONSOR_FPC_ADDR = AztecAddress.fromStringUnsafe(
  "0x2222222222222222222222222222222222222222222222222222222222222222"
);

function createMockMainnetNode(overrides?: {
  l1ChainId?: number;
  rollupVersion?: number;
  l1Rollup?: string;
}): InspectableAztecNode {
  const l1ChainId = overrides?.l1ChainId ?? 1;
  const rollupVersion = overrides?.rollupVersion ?? 2070860440;
  const l1Rollup =
    overrides?.l1Rollup ?? "0xe37a2663cc9c119ba41572c40fab0bbb23a5402f";
  const registryAddr = AztecAddress.fromStringUnsafe(FOG_DEPLOYMENT.registry);
  const classIdFr = new Fr(BigInt(MAINNET_V8_CLASS_ID));
  const blockData = {
    blockHash: new Fr(0xabc123n),
    header: {
      globalVariables: {
        blockNumber: 42,
        timestamp: 1_800_000_000n,
      },
    },
  };

  const registryStorage = new Map<bigint, bigint>([
    [CORE_CLASS_SLOT, BigInt(MAINNET_V8_CLASS_ID)],
    [V8_RELEASE_ATTESTATION_SLOT, 1n],
    [V8_RELEASE_ATTESTATION_SLOT + 1n, ANS_CORE_FAMILY],
    [V8_RELEASE_ATTESTATION_SLOT + 2n, 1n],
    [V8_RELEASE_ATTESTATION_SLOT + 3n, 0n],
  ]);

  return {
    getNodeInfo: async () => ({
      l1ChainId,
      rollupVersion,
      l1ContractAddresses: {
        rollupAddress: { toString: () => l1Rollup },
      },
    }),
    getContract: async (address: AztecAddress) => {
      if (address.equals(registryAddr)) {
        return {
          currentContractClassId: classIdFr,
          originalContractClassId: classIdFr,
        };
      }
      return undefined;
    },
    getBlockData: async () => blockData,
    getPublicStorageAt: async (
      _block: unknown,
      address: AztecAddress,
      slot: Fr
    ) => {
      if (address.equals(registryAddr)) {
        const value = registryStorage.get(slot.toBigInt()) ?? 0n;
        return new Fr(value);
      }
      return Fr.ZERO;
    },
  } as unknown as InspectableAztecNode;
}

test("pins Aztec Mainnet NameRegistryV8 constants and Fog Nameserver URL", () => {
  assert.equal(FOG_NAMESERVER_URL, "https://fog.dfarchon.xyz");
  assert.equal(FOG_DEPLOYMENT.chainId, 1n);
  assert.equal(FOG_DEPLOYMENT.chainIdString, "1");
  assert.equal(FOG_DEPLOYMENT.rollupVersion, 2070860440n);
  assert.equal(FOG_DEPLOYMENT.rollupVersionString, "2070860440");
  assert.equal(
    FOG_DEPLOYMENT.l1Rollup,
    "0xe37a2663cc9c119ba41572c40fab0bbb23a5402f"
  );
  assert.equal(
    FOG_DEPLOYMENT.registry,
    "0x1fa493d7fe8b41fff6b6dc9999b3c8a64d3cb47c50283aa75da089a16c20b7e1"
  );
});

test("caps JSON-RPC batch size to 3 across DRPC Mainnet and Testnet hosts", () => {
  assert.deepEqual(
    getAztecNodeClientOptions("https://aztec-mainnet.drpc.org"),
    {
      maxBatchSize: 3,
    }
  );
  assert.deepEqual(
    getAztecNodeClientOptions("https://aztec-testnet.drpc.org"),
    {
      maxBatchSize: 3,
    }
  );
  assert.deepEqual(
    getAztecNodeClientOptions(
      "https://lb.drpc.org/ogrpc?network=aztec-mainnet"
    ),
    { maxBatchSize: 3 }
  );
  assert.equal(getAztecNodeClientOptions("http://localhost:8080"), undefined);
});

test("normalizes root .fog names and rejects subnames", () => {
  const normalized = normalizeRootFogName("  Alice.FOG ");
  assert.equal(normalized.label, "alice");
  assert.equal(normalized.parent, undefined);

  assert.throws(
    () => normalizeRootFogName("fleet.alice.fog"),
    (err: unknown) => err instanceof FogError && err.code === "invalid_name"
  );

  assert.equal(
    addressesEqual(
      BURNER_ADDR.toString().toUpperCase(),
      ` ${BURNER_ADDR.toString()} `
    ),
    true
  );
});

test("verifies Mainnet V8 deployment on refreshNow and fails closed on network mismatch", async () => {
  const wallet = {} as Wallet;
  const session: BurnerWalletSession = {
    wallet,
    account: BURNER_ADDR,
    isBurner: true,
    useSponsoredFpc: false,
  };

  let currentNode = createMockMainnetNode();
  const service = new FogNameService({
    getNode: () => currentNode,
    getActiveAddress: () => BURNER_ADDR.toString(),
    getBurnerSession: () => session,
  });

  try {
    await service.refreshNow();
    assert.equal(service.getState().availability, "ready");
    assert.equal(service.getState().writesEnabled, true);
    assert.equal(service.getState().activePrimary.status, "none");

    currentNode = createMockMainnetNode({
      l1ChainId: 11155111,
      rollupVersion: 679261766,
      l1Rollup: "0x1f435a7f2da358caf887a470faeee7d5d5f4efba",
    });
    service.notifyContextChanged({ resetNetwork: true });
    await service.refreshNow();
    assert.equal(service.getState().availability, "network_mismatch");
    assert.equal(service.getState().writesEnabled, false);
  } finally {
    service.destroy();
  }
});

test("self-paid Mainnet burner passes sponsoredFpc: undefined to connectFog", async () => {
  const wallet = {} as Wallet;
  const session: BurnerWalletSession = {
    wallet,
    account: BURNER_ADDR,
    isBurner: true,
    useSponsoredFpc: false,
    sponsoredFpcAddress: SPONSOR_FPC_ADDR,
  };

  const connectCalls: Parameters<FogWriteSdk["connectFog"]>[1][] = [];
  let setPrimaryCalls = 0;
  let clearPrimaryCalls = 0;

  const mockSdk: FogWriteSdk = {
    connectFog: async (_reader, opts) => {
      connectCalls.push(opts);
      return {} as FogContext;
    },
    setPrimary: async (_ctx, opts) => {
      setPrimaryCalls += 1;
      assert.equal(opts.acceptUnverifiedResolver, false);
      return { tx: { txHash: "0xdeadbeef01" } } as Awaited<
        ReturnType<FogWriteSdk["setPrimary"]>
      >;
    },
    clearPrimary: async () => {
      clearPrimaryCalls += 1;
      return { tx: { txHash: "0xdeadbeef02" } } as Awaited<
        ReturnType<FogWriteSdk["clearPrimary"]>
      >;
    },
  };

  const node = createMockMainnetNode();
  const service = new FogNameService({
    getNode: () => node,
    getActiveAddress: () => BURNER_ADDR.toString(),
    getBurnerSession: () => session,
    loadSdk: async () => mockSdk,
  });

  try {
    const confirmRes = await service.confirmPrimary(
      "commander.fog",
      BURNER_ADDR.toString()
    );
    assert.equal(confirmRes.txHash, "0xdeadbeef01");
    assert.equal(confirmRes.formattedName, "commander.fog");
    assert.equal(setPrimaryCalls, 1);

    const clearRes = await service.clearAccountPrimary(BURNER_ADDR.toString());
    assert.equal(clearRes.txHash, "0xdeadbeef02");
    assert.equal(clearPrimaryCalls, 1);

    assert.equal(connectCalls.length, 2);
    for (const call of connectCalls) {
      assert.equal(call.sponsoredFpc, undefined);
      assert.equal(call.estimateGas, true);
      assert.deepEqual(call.deployment, {
        registry: FOG_DEPLOYMENT.registry,
        chainId: "1",
        rollupVersion: "2070860440",
      });
    }
  } finally {
    service.destroy();
  }
});

test("sponsored burner passes configured sponsoredFpcAddress and rejects missing FPC address", async () => {
  const wallet = {} as Wallet;
  let session: BurnerWalletSession = {
    wallet,
    account: BURNER_ADDR,
    isBurner: true,
    useSponsoredFpc: true,
    sponsoredFpcAddress: SPONSOR_FPC_ADDR,
  };

  const connectCalls: Parameters<FogWriteSdk["connectFog"]>[1][] = [];
  const mockSdk: FogWriteSdk = {
    connectFog: async (_reader, opts) => {
      connectCalls.push(opts);
      return {} as FogContext;
    },
    setPrimary: async () =>
      ({ tx: { txHash: "0xsponsored01" } }) as Awaited<
        ReturnType<FogWriteSdk["setPrimary"]>
      >,
    clearPrimary: async () =>
      ({ tx: { txHash: "0xsponsored02" } }) as Awaited<
        ReturnType<FogWriteSdk["clearPrimary"]>
      >,
  };

  const node = createMockMainnetNode();
  const service = new FogNameService({
    getNode: () => node,
    getActiveAddress: () => BURNER_ADDR.toString(),
    getBurnerSession: () => session,
    loadSdk: async () => mockSdk,
  });

  try {
    const res = await service.confirmPrimary(
      "pilot.fog",
      BURNER_ADDR.toString()
    );
    assert.equal(res.txHash, "0xsponsored01");
    assert.equal(connectCalls.length, 1);
    assert.equal(
      connectCalls[0].sponsoredFpc?.toString(),
      SPONSOR_FPC_ADDR.toString()
    );
    assert.equal(connectCalls[0].estimateGas, false);

    session = {
      wallet,
      account: BURNER_ADDR,
      isBurner: true,
      useSponsoredFpc: true,
      sponsoredFpcAddress: undefined,
    };
    await assert.rejects(
      () => service.confirmPrimary("pilot.fog", BURNER_ADDR.toString()),
      (err: unknown) =>
        err instanceof FogError &&
        err.code === "wrong_deployment" &&
        err.message.includes(
          "Sponsored FPC enabled without a configured FPC address"
        )
    );
    assert.equal(connectCalls.length, 1);
  } finally {
    service.destroy();
  }
});
