import assert from "node:assert/strict";
import test from "node:test";

import { waitForReceiptWithRetry } from "./waitForReceiptWithRetry";

test("retries transient waitForTx timeout errors and returns the receipt", async () => {
  const receipt = { status: "success" };
  const calls: string[] = [];

  const result = await waitForReceiptWithRetry({
    methodName: "initializePlayer",
    waitForReceipt: async () => {
      calls.push("wait");
      if (calls.length === 1) {
        throw new Error("Timeout awaiting isMined");
      }
      return receipt;
    },
    sleep: async () => {
      calls.push("sleep");
    },
    timeoutSeconds: 120,
    maxAttempts: 2,
  });

  assert.equal(result, receipt);
  assert.deepEqual(calls, ["wait", "sleep", "wait"]);
});

test("does not retry non-transient confirmation failures", async () => {
  const error = new Error("transaction reverted");
  let attempts = 0;

  await assert.rejects(
    waitForReceiptWithRetry({
      methodName: "move",
      waitForReceipt: async () => {
        attempts += 1;
        throw error;
      },
      sleep: async () => {},
      timeoutSeconds: 120,
      maxAttempts: 3,
    }),
    error
  );

  assert.equal(attempts, 1);
});
