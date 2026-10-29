import assert from "node:assert/strict";
import test from "node:test";

import {
  appendClaim,
  markClaimRecord,
  normalizeClaimFile,
  selectClaim,
  type ClaimFile,
  type ClaimRecord,
} from "../src/claim-store.js";

const recipient = "0xrecipient";

function claim(messageHash: string, claimedAt?: string): ClaimRecord {
  return {
    claimAmount: "1",
    claimSecret: `secret-${messageHash}`,
    messageLeafIndex: "0",
    messageHash,
    depositedAt: "2026-01-01T00:00:00.000Z",
    ...(claimedAt ? { claimedAt } : {}),
  };
}

function fileOf(...claims: ClaimRecord[]): ClaimFile {
  return { recipient, claims };
}

test("appends a deposit without dropping the previous claim", () => {
  const original = fileOf(claim("0x01"));
  const next = appendClaim(original, claim("0x02"));

  assert.equal(original.claims.length, 1);
  assert.deepEqual(
    next.claims.map((entry) => entry.messageHash),
    ["0x01", "0x02"],
  );
  assert.equal(next.claims[0]?.claimSecret, "secret-0x01");
});

test("rejects a duplicate message hash", () => {
  const original = fileOf(claim("0x01"));
  assert.throws(
    () => appendClaim(original, claim("0x01")),
    /already stored/,
  );
  assert.equal(original.claims.length, 1);
});

test("migrates a legacy single-claim file into a one-element list", () => {
  const legacy = {
    recipient,
    claimAmount: "10",
    claimSecret: "legacy-secret",
    messageLeafIndex: "4",
    messageHash: "0xlegacy",
    depositedAt: "2026-01-02T00:00:00.000Z",
    claimedAt: "2026-01-03T00:00:00.000Z",
    l1TransactionHash: "0xl1",
  };

  const file = normalizeClaimFile(legacy);

  assert.equal(file.recipient, recipient);
  assert.equal(file.claims.length, 1);
  assert.equal(file.claims[0]?.claimSecret, "legacy-secret");
  assert.equal(file.claims[0]?.claimedAt, "2026-01-03T00:00:00.000Z");
  assert.equal(file.claims[0]?.l1TransactionHash, "0xl1");
});

test("reads a multi-claim file unchanged", () => {
  const stored = fileOf(claim("0x01"), claim("0x02", "2026-01-04T00:00:00.000Z"));
  stored.claims[1] = {
    ...stored.claims[1]!,
    l2TransactionHash: "0xl2",
  };

  assert.deepEqual(normalizeClaimFile(stored), stored);
});

test("selects the only pending claim when no message hash is given", () => {
  const selected = selectClaim(
    fileOf(claim("0x01", "2026-01-01T00:00:00.000Z"), claim("0x02")),
  );
  assert.equal(selected.messageHash, "0x02");
});

test("requires a status number when several claims are pending", () => {
  const stored = fileOf(claim("0x01"), claim("0x02"));
  assert.throws(() => selectClaim(stored), /pnpm claim/);
  assert.equal(selectClaim(stored, { index: 2 }).messageHash, "0x02");
  assert.equal(selectClaim(stored, "0x02").claimSecret, "secret-0x02");
});

test("numbers only pending claims, skipping completed ones", () => {
  const stored = fileOf(
    claim("0x01", "2026-01-01T00:00:00.000Z"),
    claim("0x02"),
    claim("0x03"),
  );
  assert.equal(selectClaim(stored, { index: 1 }).messageHash, "0x02");
  assert.equal(selectClaim(stored, { index: 2 }).messageHash, "0x03");
  assert.throws(() => selectClaim(stored, { index: 3 }), /numbered 3/);
});

test("refuses to select a claim that is already completed", () => {
  const stored = fileOf(claim("0x01", "2026-01-01T00:00:00.000Z"));
  assert.throws(() => selectClaim(stored, "0x01"), /already marked as completed/);
  assert.throws(() => selectClaim(stored), /No pending claim/);
});

test("marks only the selected claim and keeps the others", () => {
  const stored = fileOf(claim("0x01"), claim("0x02"));
  const updated = markClaimRecord(stored, "0x02", "2026-02-01T00:00:00.000Z", "0xl2");

  assert.equal(updated.claims[0]?.claimedAt, undefined);
  assert.equal(updated.claims[1]?.claimedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(updated.claims[1]?.l2TransactionHash, "0xl2");
  assert.equal(updated.claims[1]?.claimSecret, "secret-0x02");
  assert.equal(stored.claims[1]?.claimedAt, undefined);
});
