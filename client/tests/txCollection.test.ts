import assert from "node:assert/strict";
import test from "node:test";

import type { Transaction } from "@dfpunk/types";

import { TxCollection } from "../src/Backend/GameLogic/TransactionCollection.ts";

function tx(id: number): Transaction {
  return { id } as Transaction;
}

function ids(collection: TxCollection): number[] {
  return collection
    .getTransactions((candidate): candidate is Transaction => true)
    .map((candidate) => candidate.id);
}

test("removeTransaction drops only the matching transaction", () => {
  const collection = new TxCollection();
  const first = tx(1);
  const second = tx(2);
  collection.addTransaction(first);
  collection.addTransaction(second);

  collection.removeTransaction(first);

  assert.deepEqual(ids(collection), [2]);
});

test("removeTransaction leaves other transactions when the target is absent", () => {
  const collection = new TxCollection();
  const kept = tx(1);
  const removed = tx(2);
  collection.addTransaction(kept);
  collection.addTransaction(removed);

  collection.removeTransaction(tx(3));
  collection.removeTransaction(removed);
  collection.removeTransaction(removed);

  assert.deepEqual(ids(collection), [1]);
});
