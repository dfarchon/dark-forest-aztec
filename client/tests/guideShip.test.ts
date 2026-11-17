import assert from "node:assert/strict";
import test from "node:test";
import { ArtifactType } from "@dfpunk/types";
import type GameUIManager from "../src/Backend/GameLogic/GameUIManager";
import {
  guideShip,
  beginGuideShip,
  guideShipLesson,
  firstGuideShip,
  sendGuideShip,
  watchGuideShipMove,
} from "../src/Frontend/Panes/BoothGuide/guideShip";
import UIEmitter, { UIEmitterEvent } from "../src/Frontend/Utils/UIEmitter";

function fixture() {
  const from = {
    locationId: "source",
    lastUpdated: 123,
    heldArtifactIds: ["gear"],
    location: { coords: { x: 0, y: 0 } },
  };
  const to = { locationId: "target", location: { coords: { x: 10, y: 0 } } };
  const ship = {
    id: "gear",
    controller: "me",
    artifactType: ArtifactType.ShipGear,
    onPlanetId: "source",
    transactions: { getTransactions: () => [] },
  };
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const submittedPromise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const calls: unknown[][] = [];
  const ui = {
    getMyArtifacts: () => [ship],
    getAccount: () => "me",
    getArtifactsWithIds: () => [ship],
    getPlanetWithId: () => from,
    getGameManager: () => ({
      getAllPlanets: () => [from, to],
      move: async (...args: unknown[]) => {
        calls.push(args);
        return { submittedPromise };
      },
    }),
  } as unknown as GameUIManager;
  return { ui, ship, from, to, calls, resolve, reject };
}

test("ship assist completes the local gesture immediately while submission is still pending", async () => {
  const f = fixture();
  assert.equal(guideShip(f.ui)?.ship.id, "gear");
  const events: unknown[][] = [];
  const submitted = (...args: unknown[]) => events.push(args);
  const emitter = UIEmitter.getInstance();
  let requests = 0;
  const stop = watchGuideShipMove("source", "gear", () => requests++);
  emitter.on(UIEmitterEvent.MoveSubmitted, submitted);
  try {
    const pending = sendGuideShip(f.ui);
    assert.equal(requests, 1);
    await Promise.resolve();
    assert.deepEqual(f.calls[0], [
      "source",
      "target",
      0,
      0,
      "gear",
      false,
      false,
      123,
    ]);
    assert.deepEqual(events, []);
    f.resolve();
    await pending;
    assert.equal(requests, 1);
    assert.deepEqual(events, [["source", "target", "gear"]]);
  } finally {
    stop();
    emitter.removeListener(UIEmitterEvent.MoveSubmitted, submitted);
  }
});

test("a later submission failure is reported without undoing the completed gesture", async () => {
  const f = fixture();
  let completed = false;
  const submitted = () => {
    completed = true;
  };
  const emitter = UIEmitter.getInstance();
  let requests = 0;
  let failures = 0;
  const stop = watchGuideShipMove("source", "gear", () => requests++);
  const failed = () => failures++;
  emitter.on(UIEmitterEvent.MoveSubmitted, submitted);
  emitter.on(UIEmitterEvent.MoveFailed, failed);
  try {
    const pending = sendGuideShip(f.ui);
    const rejected = assert.rejects(pending, /rejected/);
    f.reject(new Error("rejected"));
    await rejected;
    assert.equal(requests, 1);
    assert.equal(failures, 1);
    assert.equal(completed, false);
  } finally {
    stop();
    emitter.removeListener(UIEmitterEvent.MoveFailed, failed);
    emitter.removeListener(UIEmitterEvent.MoveSubmitted, submitted);
  }
});

test("the ship exercise accepts a matching send gesture, not invalid clicks or chain events", () => {
  const emitter = UIEmitter.getInstance();
  let requests = 0;
  const stop = watchGuideShipMove("source", "gear", () => requests++);
  try {
    for (const args of [
      ["source"], // No valid destination was selected.
      ["source", "source", "gear"],
      ["other-source", "target", "gear"],
      ["source", "target"], // Sending energy instead of the lesson's ship.
      ["source", "target", "other-ship"],
    ])
      emitter.emit(UIEmitterEvent.SendCompleted, ...args);
    emitter.emit(UIEmitterEvent.MoveQueued, "source");
    emitter.emit(UIEmitterEvent.MoveSubmitted, "source", "target", "gear");
    assert.equal(requests, 0);
    emitter.emit(UIEmitterEvent.SendCompleted, "source", "target", "gear");
    assert.equal(requests, 1);
    stop();
    emitter.emit(UIEmitterEvent.SendCompleted, "source", "target", "gear");
    assert.equal(requests, 1);
  } finally {
    stop();
  }
});

test("ships in flight or with a pending move cannot be sent again", () => {
  const flying = fixture();
  Object.assign(flying.ship, { onVoyageId: 1 });
  assert.equal(guideShip(flying.ui), undefined);
  const busy = fixture();
  Object.assign(busy.ship.transactions, { getTransactions: () => [{}] });
  assert.equal(guideShip(busy.ui), undefined);
});

test("the lesson picks the first available owned ship in the planet panel's order", () => {
  const f = fixture();
  const enemy = { ...f.ship, id: "enemy", controller: "someone-else" };
  const first = { ...f.ship, id: "first" };
  const second = { ...f.ship, id: "second" };
  const artifacts = [enemy, first, second];
  f.ui.getArtifactsWithIds = () => artifacts as never;
  f.ui.getMyArtifacts = () => [second, first] as never;
  assert.equal(firstGuideShip(f.ui, f.from as never)?.id, "first");
  assert.equal(guideShip(f.ui)?.ship.id, "first");
  Object.assign(first, { onVoyageId: 1 });
  assert.equal(firstGuideShip(f.ui, f.from as never)?.id, "second");
});

test("changing the artifact list order does not change the lesson's chosen ship", () => {
  const f = fixture();
  assert.equal(beginGuideShip(f.ui)?.ship.id, "gear");
  const other = { ...f.ship, id: "other" };
  f.ui.getMyArtifacts = () => [other, f.ship] as never;
  f.ui.getArtifactsWithIds = () => [other, f.ship] as never;
  assert.equal(guideShipLesson(f.ui)?.ship.id, "gear");
  Object.assign(f.ship, { onVoyageId: 1 });
  assert.equal(guideShipLesson(f.ui), undefined);
  assert.equal(beginGuideShip(f.ui)?.ship.id, "other");
});
