import assert from "node:assert/strict";
import test from "node:test";

import type { LocatablePlanet } from "@dfpunk/types";
import { moveEnergy, requestMove } from "../src/Backend/GameLogic/MoveRequest";
import UIEmitter, { UIEmitterEvent } from "../src/Frontend/Utils/UIEmitter";

test("move energy preserves pending reservations, flooring and the 98% cap", () => {
  const from = {
    energy: 101,
    transactions: {
      getTransactions: () => [
        { intent: { forces: 20 } },
        { intent: { forces: 10 } },
      ],
    },
  } as unknown as LocatablePlanet;
  assert.deepEqual(moveEnergy(from, 100), {
    effectiveEnergy: 71,
    effPercent: 98,
    forces: 69,
  });
  assert.equal(moveEnergy(from, 50).forces, 35);
  assert.equal(moveEnergy(from, 0).forces, 0);
  assert.equal(from.energy, 101);
});

test("energy, silver, ship and abandon requests retain their exact move arguments and event order", async () => {
  const emitter = UIEmitter.getInstance();
  for (const [forces, silver, artifact, abandoning] of [
    [35, 0, undefined, false],
    [35, 8, undefined, false],
    [0, 0, "ship", false],
    [98, 8, undefined, true],
  ] as const) {
    const events: string[] = [];
    let resolve!: () => void;
    const submittedPromise = new Promise<void>((yes) => {
      resolve = yes;
    });
    const args = [
      "from",
      "to",
      forces,
      silver,
      artifact,
      abandoning,
      false,
      123,
    ] as unknown as Parameters<Parameters<typeof requestMove>[0]["move"]>;
    const listeners = [
      UIEmitterEvent.SendCompleted,
      UIEmitterEvent.MoveQueued,
      UIEmitterEvent.MoveSubmitted,
    ].map((event) => {
      const listener = () => events.push(event);
      emitter.on(event, listener);
      return () => emitter.removeListener(event, listener);
    });
    try {
      const game = {
        move: async (...actual: typeof args) => {
          assert.deepEqual(actual, args);
          return { submittedPromise };
        },
      } as unknown as Parameters<typeof requestMove>[0];
      const pending = requestMove(game, ...args);
      assert.deepEqual(events, [UIEmitterEvent.SendCompleted]);
      await Promise.resolve();
      assert.deepEqual(events, [
        UIEmitterEvent.SendCompleted,
        UIEmitterEvent.MoveQueued,
      ]);
      resolve();
      await pending;
      assert.deepEqual(events, [
        UIEmitterEvent.SendCompleted,
        UIEmitterEvent.MoveQueued,
        UIEmitterEvent.MoveSubmitted,
      ]);
    } finally {
      listeners.forEach((stop) => stop());
    }
  }
});

test("queue and submission failures emit failure once without retracting the local gesture", async () => {
  const emitter = UIEmitter.getInstance();
  for (const stage of ["queue", "submission"]) {
    let requested = 0,
      failed = 0,
      submitted = 0;
    const onRequest = () => requested++,
      onFailure = () => failed++,
      onSubmitted = () => submitted++;
    emitter.on(UIEmitterEvent.SendCompleted, onRequest);
    emitter.on(UIEmitterEvent.MoveFailed, onFailure);
    emitter.on(UIEmitterEvent.MoveSubmitted, onSubmitted);
    const game = {
      move: async () => {
        if (stage === "queue") throw new Error(stage);
        return { submittedPromise: Promise.reject(new Error(stage)) };
      },
    } as unknown as Parameters<typeof requestMove>[0];
    try {
      await assert.rejects(
        requestMove(game, "from" as never, "to" as never, 1, 0),
        new RegExp(stage)
      );
      assert.deepEqual([requested, failed, submitted], [1, 1, 0]);
    } finally {
      emitter.removeListener(UIEmitterEvent.SendCompleted, onRequest);
      emitter.removeListener(UIEmitterEvent.MoveFailed, onFailure);
      emitter.removeListener(UIEmitterEvent.MoveSubmitted, onSubmitted);
    }
  }
});
