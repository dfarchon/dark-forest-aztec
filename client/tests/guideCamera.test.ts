import assert from "node:assert/strict";
import test from "node:test";

import {
  guideCameraFrame,
  playGuideCamera,
  type CameraMotion,
} from "../src/Frontend/Panes/BoothGuide/guideCamera";
import UIEmitter, { UIEmitterEvent } from "../src/Frontend/Utils/UIEmitter";

test("all five camera motions match the previous curves in both zoom directions", () => {
  for (const width of [50, 2000]) {
    const start = { center: { x: 510, y: -43 }, width: 500 };
    const target = { center: { x: -40, y: 95 }, width };
    for (const motion of [
      "tour",
      "reveal",
      "approach",
      "return",
      "mined",
    ] as const)
      for (const t of [0, 0.05, 0.25, 0.5, 0.75, 0.99, 1]) {
        // Baseline formulas from the five original animation loops.
        const s = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const w = Math.exp(
          Math.log(start.width) + (Math.log(width) - Math.log(start.width)) * s
        );
        let k = s;
        if (motion === "reveal") k = Math.min(1, s * (w / width));
        if (motion === "return") k = 1 - (1 - s) * (w / start.width);
        if (motion === "approach")
          k = 1 - Math.min(1, Math.max(0, (1 - s) * (w / start.width)));
        const actual = guideCameraFrame(start, target, t, motion);
        assert.ok(Math.abs(actual.width - w) < 1e-9);
        for (const axis of ["x", "y"] as const)
          assert.ok(
            Math.abs(
              actual.center[axis] -
                (start.center[axis] +
                  (target.center[axis] - start.center[axis]) * k)
            ) < 1e-9,
            `${motion} ${t} ${axis}`
          );
      }
  }
});

test("camera timing, input interruption, cancellation and listener cleanup remain unchanged", (t) => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const raf = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame"
  );
  const caf = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame"
  );
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (cb: FrameRequestCallback) => {
      frames.set(++id, cb);
      return id;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (key: number) => frames.delete(key),
  });
  t.mock.method(performance, "now", () => 0);
  const emitter = UIEmitter.getInstance();
  const tick = (now: number) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(now));
  };
  const target = { center: { x: 0, y: 0 }, width: 900 };
  try {
    for (const [motion, duration] of Object.entries({
      tour: 1400,
      reveal: 2200,
      approach: 2200,
      return: 1200,
      mined: 2100,
    })) {
      let ready = 0;
      const view = {
        centerWorldCoords: { x: 40, y: 60 },
        widthInWorldUnits: 100,
        minWorldWidth: 10,
        maxWorldWidth: 1000,
        setData(data: {
          centerWorldCoords: { x: number; y: number };
          widthInWorldUnits: number;
        }) {
          Object.assign(this, data);
        },
      };
      const before = emitter.listenerCount(UIEmitterEvent.CanvasScroll);
      const cancel = playGuideCamera(
        view,
        target,
        motion as CameraMotion,
        () => ready++
      );
      tick(duration - 1);
      assert.equal(ready, 0);
      tick(duration);
      assert.equal(ready, 1);
      assert.deepEqual(view.centerWorldCoords, target.center);
      assert.equal(view.widthInWorldUnits, target.width);
      assert.equal(frames.size, 0);
      assert.equal(emitter.listenerCount(UIEmitterEvent.CanvasScroll), before);
      cancel();
      for (const event of [
        UIEmitterEvent.CanvasMouseDown,
        UIEmitterEvent.CanvasScroll,
        UIEmitterEvent.ZoomIn,
        UIEmitterEvent.ZoomOut,
      ]) {
        const stop = playGuideCamera(
          view,
          target,
          motion as CameraMotion,
          () => ready++
        );
        emitter.emit(event);
        const interruptible = motion === "return" || motion === "mined";
        assert.equal(frames.size, interruptible ? 0 : 1);
        if (!interruptible) assert.equal(ready, 1);
        stop();
        assert.equal(emitter.listenerCount(event), before);
        ready = 1;
      }
      const stop = playGuideCamera(view, target, motion as CameraMotion, () =>
        assert.fail("explicit cancellation must not complete a lesson")
      );
      stop();
      tick(duration);
      assert.equal(frames.size, 0);
    }
  } finally {
    if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (caf) Object.defineProperty(globalThis, "cancelAnimationFrame", caf);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  }
});
