import assert from "node:assert/strict";
import test from "node:test";
import type {
  AssistHooks,
  WatchHooks,
} from "../src/Frontend/Panes/BoothGuide/guideTypes";
import { controlsPage } from "../src/Frontend/Panes/BoothGuide/ControlsPage";
import { guideDeselect } from "../src/Frontend/Panes/BoothGuide/guideDeselect";
import UIEmitter, { UIEmitterEvent } from "../src/Frontend/Utils/UIEmitter";

test("explorer and terminal exercises finish only on their matching state change and clean up listeners", async () => {
  const emitter = UIEmitter.getInstance();
  for (const stepId of [
    "pauseExplorer",
    "resumeExplorer",
    "hideTerminal",
  ] as const) {
    let done = 0;
    const event =
      stepId === "hideTerminal"
        ? UIEmitterEvent.TerminalVisibilityChanged
        : UIEmitterEvent.ExplorerChanged;
    const before = emitter.listenerCount(event);
    const stop = controlsPage.watch({
      stepId,
      finish: () => done++,
    } as unknown as WatchHooks);
    try {
      const expected = stepId === "resumeExplorer";
      emitter.emit(event, !expected);
      assert.equal(done, 0);
      emitter.emit(event, expected);
      assert.equal(done, 1);
    } finally {
      stop();
    }
    assert.equal(emitter.listenerCount(event), before);
  }
});

test("control assists retain the existing explorer and terminal commands", async () => {
  const calls: string[] = [];
  const onTerminal = (value: boolean) => calls.push(`terminal:${value}`);
  const emitter = UIEmitter.getInstance();
  emitter.on(UIEmitterEvent.SetTerminalVisible, onTerminal);
  try {
    const ui = {
      startExplore: () => calls.push("start"),
      stopExplore: () => calls.push("stop"),
    };
    for (const stepId of [
      "pauseExplorer",
      "resumeExplorer",
      "hideTerminal",
    ] as const)
      await controlsPage.assist({ ui, stepId } as unknown as AssistHooks);
    assert.deepEqual(calls, ["stop", "start", "terminal:false"]);
  } finally {
    emitter.removeListener(UIEmitterEvent.SetTerminalVisible, onTerminal);
  }
});

test("deselection ignores the initial empty subscription and unsubscribes on leaving the lesson", () => {
  let listener: (id?: string) => void = () => {};
  let finished = 0,
    unsubscribed = false;
  const ui = {
    selectedPlanetId$: {
      subscribe: (fn: typeof listener) => {
        listener = fn;
        fn(undefined);
        return {
          unsubscribe: () => {
            unsubscribed = true;
          },
        };
      },
    },
  };
  const stop = guideDeselect.watch({
    ui,
    finish: () => finished++,
  } as unknown as WatchHooks);
  assert.equal(finished, 0);
  listener("planet");
  assert.equal(finished, 0);
  listener(undefined);
  assert.equal(finished, 1);
  stop();
  assert.equal(unsubscribed, true);
});
