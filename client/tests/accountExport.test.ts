import assert from "node:assert/strict";
import test from "node:test";

import { canExportAccount } from "../src/Session/WalletManager/accountExport";
import { KeyStore } from "../src/Session/WalletManager/KeyStore";
import type { AccountRecord } from "../src/Session/WalletManager/types";

const personal: AccountRecord = {
  address: "0x123",
  secretKey: "secret",
  salt: "salt",
  signingKey: "signing",
  createdAt: 1,
};

function withStorage(run: (data: Map<string, string>) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  try {
    run(data);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("experience accounts are marked in storage and excluded from export after reload", () =>
  withStorage((data) => {
    const store = new KeyStore("dfpunk:booth:booth-1");
    store.saveAccount(personal);
    assert.equal(
      JSON.parse(data.get("dfpunk:booth:booth-1:accounts")!)[0].purpose,
      "exhibition"
    );
    assert.equal(
      canExportAccount(
        new KeyStore("dfpunk:booth:booth-1").getAccount(personal.address)
      ),
      false
    );
    assert.equal(personal.purpose, undefined);
  }));

test("legacy experience records without a marker are also excluded", () =>
  withStorage((data) => {
    data.set("dfpunk:booth:booth-1:accounts", JSON.stringify([personal]));
    const store = new KeyStore("dfpunk:booth:booth-1");
    assert.equal(canExportAccount(store.getAccount(personal.address)), false);
    assert.deepEqual(store.listAccounts().filter(canExportAccount), []);
  }));

test("personal accounts remain exportable and isolated from experience accounts", () =>
  withStorage(() => {
    const normal = new KeyStore();
    const booth = new KeyStore("dfpunk:booth:booth-1");
    normal.saveAccount(personal);
    booth.saveAccount({ ...personal, address: "0x456" });
    assert.deepEqual(normal.listAccounts().filter(canExportAccount), [
      personal,
    ]);
    assert.equal(canExportAccount(normal.getAccount(personal.address)), true);
    assert.equal(normal.getAccount("0x456"), null);
    assert.equal(canExportAccount(null), false);
  }));
