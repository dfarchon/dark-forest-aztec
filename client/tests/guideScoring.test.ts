import assert from "node:assert/strict";
import test from "node:test";

import type { WatchHooks } from "../src/Frontend/Panes/BoothGuide/BoothGuidePane";
import { reviewPage } from "../src/Frontend/Panes/BoothGuide/ReviewPage";
import UIEmitter, { UIEmitterEvent } from "../src/Frontend/Utils/UIEmitter";

test("opening scoring help hides the scoring pointer without advancing the reading step", () => {
  let hidden = 0;
  let finished = 0;
  const emitter = UIEmitter.getInstance();
  const before = emitter.listenerCount(UIEmitterEvent.OpenScoringHelp);
  const stop = reviewPage.watch({
    stepId: "readScoring",
    hidePointer: () => hidden++,
    finish: () => finished++,
  } as unknown as WatchHooks);
  try {
    emitter.emit(UIEmitterEvent.OpenScoringHelp);
    assert.equal(hidden, 1);
    assert.equal(finished, 0);
    stop();
    emitter.emit(UIEmitterEvent.OpenScoringHelp);
    assert.equal(hidden, 1);
    assert.equal(emitter.listenerCount(UIEmitterEvent.OpenScoringHelp), before);
  } finally {
    stop();
  }
});

test("opening scoring help does not alter other review steps", () => {
  const stop = reviewPage.watch({
    stepId: "accountSafety",
    hidePointer: () => assert.fail("Do not affect another step"),
  } as unknown as WatchHooks);
  try {
    UIEmitter.getInstance().emit(UIEmitterEvent.OpenScoringHelp);
  } finally {
    stop();
  }
});
