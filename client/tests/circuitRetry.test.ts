import assert from "node:assert/strict";
import test from "node:test";

import { settleCircuitAttempt } from "../src/Session/Acvm/circuitRetry.ts";

test("does not replay a circuit after an oracle has run", async () => {
  let fallbacks = 0;
  let replay: boolean | undefined;
  await assert.rejects(
    () =>
      settleCircuitAttempt({
        error: new Error("worker died"),
        oracleInvoked: true,
        isCircuitExecutionError: false,
        onWorkerFailure: (_error, willReplay) => {
          replay = willReplay;
        },
        fallback: async () => {
          fallbacks += 1;
          return "replayed";
        },
        rethrowCircuit: (error) => {
          throw error;
        },
      }),
    /worker died/
  );
  assert.equal(fallbacks, 0);
  assert.equal(replay, false);
});

test("replays when the worker fails before any oracle", async () => {
  let replay: boolean | undefined;
  const result = await settleCircuitAttempt({
    error: new Error("worker boot failed"),
    oracleInvoked: false,
    isCircuitExecutionError: false,
    onWorkerFailure: (_error, willReplay) => {
      replay = willReplay;
    },
    fallback: async () => "main-thread",
    rethrowCircuit: (error) => {
      throw error;
    },
  });
  assert.equal(result, "main-thread");
  assert.equal(replay, true);
});

test("circuit assertion failures are not replayed", async () => {
  let fallbacks = 0;
  let noted = 0;
  await assert.rejects(
    () =>
      settleCircuitAttempt({
        error: new Error("assert failed"),
        oracleInvoked: true,
        isCircuitExecutionError: true,
        onWorkerFailure: () => {
          noted += 1;
        },
        fallback: async () => {
          fallbacks += 1;
          return "replayed";
        },
        rethrowCircuit: (error) => {
          throw error;
        },
      }),
    /assert failed/
  );
  assert.equal(fallbacks, 0);
  assert.equal(noted, 0);
});
