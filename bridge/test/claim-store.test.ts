import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FeeJuicePortalAbi } from "@aztec/l1-artifacts/FeeJuicePortalAbi";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";

import { ClaimStore, type PreparedDeposit } from "../src/claim-store.js";
import {
  claimFromReceipt,
  DepositNotSentError,
  executeDeposit,
} from "../src/deposit.js";

const field = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Hex;
const draft: PreparedDeposit = {
  recipient: field(1),
  claimAmount: "100",
  claimSecret: field(2),
  claimSecretHash: field(3),
  l1ChainId: 1,
  portalAddress: address(4),
  l1Address: address(5),
  preparedAt: "2026-09-19T00:00:00Z",
};

function receipt(deposit = draft) {
  return {
    status: "success",
    transactionHash: field(6),
    from: deposit.l1Address,
    to: deposit.portalAddress as string | null,
    logs: [
      {
        address: deposit.portalAddress,
        topics: encodeEventTopics({
          abi: FeeJuicePortalAbi,
          eventName: "DepositToAztecPublic",
          args: { to: deposit.recipient as Hex },
        }) as Hex[],
        data: encodeAbiParameters(
          [
            { type: "uint256" },
            { type: "bytes32" },
            { type: "bytes32" },
            { type: "uint256" },
          ],
          [
            BigInt(deposit.claimAmount),
            deposit.claimSecretHash as Hex,
            field(7),
            8n,
          ],
        ),
      },
    ],
  };
}

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "fee-juice-claims-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new ClaimStore(dir) };
}

test("flushes the secret before submission and saves a matching receipt", async (t) => {
  const { store, dir } = fixture(t);
  await executeDeposit(store, draft, async () => {
    assert.deepEqual(store.loadDeposit(draft.recipient), draft);
    const file = path.join(dir, `${draft.recipient}.deposit.json`);
    assert.equal(
      JSON.parse(readFileSync(file, "utf8")).claimSecret,
      draft.claimSecret,
    );
    if (process.platform !== "win32")
      assert.equal(statSync(file).mode & 0o777, 0o600);
    return receipt();
  });
  assert.equal(store.loadDeposit(draft.recipient), undefined);
  assert.equal(store.loadClaim(draft.recipient).messageLeafIndex, "8");
  assert.equal(store.loadClaim(draft.recipient).l1TransactionHash, field(6));
});

test("blocks a second unclaimed deposit before sending any transaction", async (t) => {
  const { store } = fixture(t);
  await executeDeposit(store, draft, async () => receipt());
  let sent = false;
  await assert.rejects(
    executeDeposit(store, { ...draft, claimSecret: field(9) }, async () => {
      sent = true;
      return receipt();
    }),
    /unclaimed deposit/,
  );
  assert.equal(sent, false);
  assert.equal(store.loadClaim(draft.recipient).claimSecret, draft.claimSecret);
});

test("an interrupted transaction retains its secret and can recover from the receipt", async (t) => {
  const { store } = fixture(t);
  await assert.rejects(
    executeDeposit(store, draft, async () => {
      throw new Error("RPC timeout after broadcast");
    }),
    /RPC timeout/,
  );
  assert.deepEqual(store.loadDeposit(draft.recipient), draft);
  assert.throws(
    () => store.prepareDeposit({ ...draft, claimSecret: field(9) }),
    /unresolved deposit/,
  );
  store.completeDeposit(claimFromReceipt(draft, receipt()));
  assert.equal(store.loadClaim(draft.recipient).claimSecret, draft.claimSecret);
});

test("a second CLI instance cannot reserve the same recipient while submission is pending", async (t) => {
  const { store, dir } = fixture(t);
  const another = new ClaimStore(dir);
  await executeDeposit(store, draft, async () => {
    assert.throws(() => another.prepareDeposit(draft), /unresolved deposit/);
    return receipt();
  });
});

test("keeps claimed history and refuses to let an old claim overwrite the next deposit", async (t) => {
  const { store, dir } = fixture(t);
  await executeDeposit(store, draft, async () => receipt());
  const first = store.loadClaim(draft.recipient);
  store.markClaimed(first);
  const next = { ...draft, claimSecret: field(9), claimSecretHash: field(10) };
  const nextReceipt = receipt(next);
  nextReceipt.logs[0].data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
    ],
    [100n, field(10), field(11), 12n],
  );
  await executeDeposit(store, next, async () => nextReceipt);
  assert.equal(store.loadClaim(draft.recipient).claimSecret, field(9));
  assert.throws(() => store.markClaimed(first), /Claim changed/);
  const archive = readdirSync(dir).find((name) =>
    name.endsWith(".claimed.json"),
  );
  assert(archive);
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, archive), "utf8")).claimSecret,
    draft.claimSecret,
  );
});

test("preserves legacy pending JSON files", (t) => {
  const { store, dir } = fixture(t);
  const legacy = claimFromReceipt(draft, receipt());
  delete legacy.l1TransactionHash;
  writeFileSync(
    path.join(dir, `${draft.recipient}.json`),
    JSON.stringify(legacy),
  );
  assert.throws(() => store.prepareDeposit(draft), /unclaimed deposit/);
  assert.deepEqual(store.loadClaim(draft.recipient), legacy);
  store.markClaimed(legacy);
  assert(store.loadClaim(draft.recipient).claimedAt);
});

test("corrupt or locked storage fails closed", (t) => {
  const { store, dir } = fixture(t);
  writeFileSync(path.join(dir, `${draft.recipient}.json`), "{broken");
  assert.throws(() => store.prepareDeposit(draft), SyntaxError);
  assert.equal(store.loadDeposit(draft.recipient), undefined);
  writeFileSync(path.join(dir, `${draft.recipient}.lock`), "");
  assert.throws(() => store.prepareDeposit(draft), /locked/);
});

test("recovery is idempotent if completion was persisted before a crash", (t) => {
  const { store, dir } = fixture(t);
  store.prepareDeposit(draft);
  const claim = {
    ...claimFromReceipt(draft, receipt()),
    claimedAt: "already-claimed",
  };
  writeFileSync(
    path.join(dir, `${draft.recipient}.json`),
    JSON.stringify(claim),
  );
  store.completeDeposit(claimFromReceipt(draft, receipt()));
  assert.equal(store.loadClaim(draft.recipient).claimedAt, "already-claimed");
  assert.equal(store.loadDeposit(draft.recipient), undefined);
});

test("rejects forged, unrelated, failed and ambiguous deposit receipts", () => {
  const good = receipt();
  for (const bad of [
    { ...good, status: "reverted" },
    { ...good, from: address(99) },
    { ...good, logs: [] },
    { ...good, logs: [good.logs[0], good.logs[0]] },
    { ...good, logs: [{ ...good.logs[0], address: address(99) }] },
    receipt({ ...draft, claimSecretHash: field(99) }),
    receipt({ ...draft, recipient: field(99) }),
    receipt({ ...draft, claimAmount: "99" }),
  ])
    assert.throws(() => claimFromReceipt(draft, bad));
});

test("does not persist a claim with an unrelated secret", (t) => {
  const { store } = fixture(t);
  store.prepareDeposit(draft);
  assert.throws(
    () =>
      store.completeDeposit({
        ...claimFromReceipt(draft, receipt()),
        claimSecret: field(99),
      }),
    /does not match/,
  );
  assert.deepEqual(store.loadDeposit(draft.recipient), draft);
});

test("does not submit a transaction when the secret cannot be persisted", async (t) => {
  const { dir } = fixture(t);
  const blocked = path.join(dir, "not-a-directory");
  writeFileSync(blocked, "existing file");
  let sent = false;
  await assert.rejects(
    executeDeposit(new ClaimStore(blocked), draft, async () => {
      sent = true;
      return receipt();
    }),
  );
  assert.equal(sent, false);
});

test("archives the secret and allows a retry when the deposit was never sent", async (t) => {
  const { store, dir } = fixture(t);
  await assert.rejects(
    executeDeposit(store, draft, async () => {
      throw new DepositNotSentError(new Error("approve reverted"));
    }),
    /Deposit was not sent: approve reverted/,
  );
  assert.equal(store.loadDeposit(draft.recipient), undefined);
  const archive = readdirSync(dir).find((name) =>
    name.endsWith(".discarded.json"),
  );
  assert(archive);
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, archive), "utf8")).claimSecret,
    draft.claimSecret,
  );
  await executeDeposit(store, draft, async () => receipt());
  assert.equal(store.loadClaim(draft.recipient).claimSecret, draft.claimSecret);
});

test("archives the secret when the deposit transaction itself reverted", async (t) => {
  const { store } = fixture(t);
  await assert.rejects(
    executeDeposit(store, draft, async () => ({
      ...receipt(),
      status: "reverted",
      logs: [],
    })),
    /reverted/,
  );
  assert.equal(store.loadDeposit(draft.recipient), undefined);
});

test("keeps the secret for reverted receipts that are not the prepared deposit", async (t) => {
  for (const unrelated of [
    { to: address(99) },
    { to: null },
    { from: address(99) },
  ]) {
    const { store } = fixture(t);
    await assert.rejects(
      executeDeposit(store, draft, async () => ({
        ...receipt(),
        ...unrelated,
        status: "reverted",
        logs: [],
      })),
    );
    assert.deepEqual(store.loadDeposit(draft.recipient), draft);
  }
});

test("refuses to discard a prepared deposit with a different secret", (t) => {
  const { store } = fixture(t);
  store.prepareDeposit(draft);
  assert.throws(
    () => store.discardDeposit({ ...draft, claimSecret: field(99) }),
    /changed/,
  );
  assert.deepEqual(store.loadDeposit(draft.recipient), draft);
});
