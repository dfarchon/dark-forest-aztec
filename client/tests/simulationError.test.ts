import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSimulationError,
  isStaleProofError,
} from "../src/Session/TxExecutor/simulationError.ts";

test("hash mismatch nested under foreign_call_handler is retryable", () => {
  const err = new Error("Error awaiting `foreign_call_handler`", {
    cause: new Error("Assertion failed: hash mismatch"),
  });
  err.name = "Jf";

  assert.equal(isStaleProofError(err), true);
  const text = formatSimulationError(err);
  assert.match(text, /foreign_call_handler/);
  assert.match(text, /hash mismatch/);
  const lines = text.split("\n");
  assert.equal(new Set(lines).size, lines.length);
});

test("Timestamp too old in a string cause is retryable", () => {
  const err = new Error("Error awaiting `foreign_call_handler`", {
    cause: "Timestamp too old",
  });
  assert.equal(isStaleProofError(err), true);
});

test("a foreign_call_handler with no stale assertion is not retryable", () => {
  const err = new Error("Error awaiting `foreign_call_handler`", {
    cause: new Error("Only owner"),
  });
  assert.equal(isStaleProofError(err), false);
  assert.match(formatSimulationError(err), /Only owner/);
});

test("prints nested function names and fields Aztec does not put on message", () => {
  const err = Object.assign(
    new Error("Error awaiting `foreign_call_handler`"),
    {
      failingFunction: {
        contractName: "SchnorrInitializerlessAccount",
        functionName: "entrypoint",
      },
      cause: Object.assign(new Error("hash mismatch"), {
        failingFunction: { contractName: "Move", functionName: "move" },
        note: "energy below minimum",
      }),
    }
  );

  const text = formatSimulationError(err);
  assert.match(
    text,
    /failingFunction: at SchnorrInitializerlessAccount\.entrypoint/
  );
  assert.match(text, /cause\.failingFunction: at Move\.move/);
  assert.match(text, /cause\.note: energy below minimum/);
  assert.equal(isStaleProofError(err), true);
});

test("call stack names and noir locations are included once", () => {
  const err = Object.assign(
    new Error("Error awaiting `foreign_call_handler`"),
    {
      functionErrorStack: [{ contractName: "Move", functionName: "move" }],
      noirErrorStack: [
        {
          filePath: "contracts/system/move/src/main.nr",
          line: 280,
          column: 13,
          locationText: "expected_source == source_loc",
          fileSource: "SHOULD_NOT_APPEAR",
        },
      ],
    }
  );

  const text = formatSimulationError(err);
  assert.match(text, /at Move\.move/);
  assert.match(
    text,
    /at expected_source == source_loc \(contracts\/system\/move\/src\/main\.nr:280:13\)/
  );
  assert.equal(text.includes("SHOULD_NOT_APPEAR"), false);
  assert.equal(text.split("at Move.move").length - 1, 1);
});
