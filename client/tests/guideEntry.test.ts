import assert from "node:assert/strict";
import test from "node:test";

import {
  clearGuideSearch,
  isGuideEntry,
  quickGuidePlayPath,
} from "../src/config/guideEntry";
import { resolveQuickJoinAccount } from "../src/config/quickJoin";
import { canExportAccount } from "../src/Session/WalletManager/accountExport";
import type { AccountRecord } from "../src/Session/WalletManager/types";

test("the tutorial button enters the real game with only a guide marker", () => {
  assert.equal(quickGuidePlayPath("0xcore"), "/play/0xcore?guide=1");
  assert.equal(isGuideEntry("?guide=1"), true);
  assert.equal(isGuideEntry(""), false);
  assert.equal(isGuideEntry("?guide=0"), false);
});

test("old booth links lose their shared-account and fixed-spawn overrides", () => {
  for (const booth of ["booth-1", ""]) {
    const path = quickGuidePlayPath(
      "0xcore",
      `?booth=${booth}&searchCenter=10,20&safe=1`
    );
    const query = new URLSearchParams(path.split("?")[1]);
    assert.equal(query.get("guide"), "1");
    assert.equal(query.has("booth"), false);
    assert.equal(query.has("searchCenter"), false);
    assert.equal(query.get("safe"), "1");
  }
});

test("ending the guide removes its marker while preserving unrelated game parameters", () => {
  assert.equal(clearGuideSearch("?guide=1"), "");
  assert.equal(clearGuideSearch("?safe=1&guide=1&foo=bar"), "?safe=1&foo=bar");
  assert.equal(clearGuideSearch(""), "");
  assert.equal(isGuideEntry(clearGuideSearch("?guide=1")), false);
});

test("the guide uses QuickGame's normal default/newest account, which remains exportable", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let preferred: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => preferred },
  });
  const older: AccountRecord = {
    address: "0xold",
    secretKey: "1",
    salt: "2",
    signingKey: "3",
    createdAt: 1,
  };
  const newer: AccountRecord = { ...older, address: "0xnew", createdAt: 2 };
  try {
    assert.equal(resolveQuickJoinAccount([]), undefined);
    assert.equal(resolveQuickJoinAccount([older, newer]), newer);
    preferred = older.address;
    const selected = resolveQuickJoinAccount([older, newer]);
    assert.equal(selected, older);
    assert.equal(canExportAccount(selected), true);
    assert.equal(selected?.purpose, undefined);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
