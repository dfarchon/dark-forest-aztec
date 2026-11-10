import assert from "node:assert/strict";
import test from "node:test";

import { readDecodedUpdate } from "../src/AztecNodeSource.ts";
import { callWithBoundedRetry } from "../src/utils/callWithBoundedRetry.ts";

test("readDecodedUpdate keeps id, state, and an optional block number", () => {
  const state = { score: 1n };
  assert.deepEqual(readDecodedUpdate("PlayerUpdate", { id: 7n, state }), {
    id: 7n,
    state,
  });
  assert.deepEqual(
    readDecodedUpdate("PlayerUpdate", {
      id: 7n,
      block_number: 3n,
      state,
    }),
    { id: 7n, block_number: 3n, state },
  );
  assert.deepEqual(
    readDecodedUpdate("PlayerUpdate", {
      id: 7n,
      block_number: 3,
      state,
    }),
    { id: 7n, block_number: 3n, state },
  );
});

test("readDecodedUpdate rejects a result with no state", () => {
  assert.throws(
    () => readDecodedUpdate("PlayerUpdate", undefined),
    /PlayerUpdate missing state/,
  );
  assert.throws(
    () => readDecodedUpdate("PlayerUpdate", { id: 1n }),
    /PlayerUpdate missing state/,
  );
  assert.throws(
    () => readDecodedUpdate("PlayerUpdate", { id: 1n, state: null }),
    /PlayerUpdate missing state/,
  );
  assert.throws(
    () => readDecodedUpdate("PlayerUpdate", { id: 1n, state: [] }),
    /PlayerUpdate missing state/,
  );
});

test("readDecodedUpdate rejects a result with no id", () => {
  const state = { score: 1n };
  assert.throws(
    () => readDecodedUpdate("PlayerUpdate", { state }),
    /PlayerUpdate missing id/,
  );
  assert.throws(
    () => readDecodedUpdate("PlayerUpdate", { id: null, state }),
    /PlayerUpdate missing id/,
  );
});

function hang(): Promise<never> {
  return new Promise(() => {});
}

function silenceWarn(): () => void {
  const original = console.warn;
  console.warn = () => {};
  return () => {
    console.warn = original;
  };
}

test("callWithBoundedRetry retries a timeout and uses the next request", async () => {
  const restore = silenceWarn();
  const waits: number[] = [];
  let calls = 0;
  try {
    const result = await callWithBoundedRetry(
      () => {
        calls += 1;
        if (calls === 1) return hang();
        return Promise.resolve("ok");
      },
      {
        label: "getBlockData(1)",
        timeoutMs: 20,
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 2);
    assert.deepEqual(waits, [1_000]);
  } finally {
    restore();
  }
});

test("callWithBoundedRetry does not retry a non-network error", async () => {
  const restore = silenceWarn();
  const waits: number[] = [];
  let calls = 0;
  try {
    await assert.rejects(
      () =>
        callWithBoundedRetry(
          () => {
            calls += 1;
            return Promise.reject(new Error("PlayerUpdate missing state"));
          },
          {
            label: "getPublicLogsByTags(PlayerUpdate)",
            timeoutMs: 20,
            sleep: async (ms) => {
              waits.push(ms);
            },
          },
        ),
      /PlayerUpdate missing state/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  } finally {
    restore();
  }
});

test("callWithBoundedRetry throws the last timeout after 3 attempts", async () => {
  const restore = silenceWarn();
  const waits: number[] = [];
  let calls = 0;
  try {
    await assert.rejects(
      () =>
        callWithBoundedRetry(
          () => {
            calls += 1;
            return hang();
          },
          {
            label: "getPublicLogsByTags(PlanetUpdate)",
            timeoutMs: 20,
            sleep: async (ms) => {
              waits.push(ms);
            },
          },
        ),
      /getPublicLogsByTags\(PlanetUpdate\) timed out after 20ms/,
    );
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1_000, 2_000]);
  } finally {
    restore();
  }
});

test("callWithBoundedRetry retries a network error without a timeout", async () => {
  const restore = silenceWarn();
  let calls = 0;
  const network = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNRESET" },
  });
  try {
    const result = await callWithBoundedRetry(
      () => {
        calls += 1;
        if (calls === 1) return Promise.reject(network);
        return Promise.resolve(4);
      },
      {
        label: "getBlockNumber",
        sleep: async () => {},
      },
    );
    assert.equal(result, 4);
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});
