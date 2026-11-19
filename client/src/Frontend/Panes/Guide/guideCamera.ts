import type { WorldCoords } from "@dfpunk/types";

import type Viewport from "../../Game/Viewport";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";

type Frame = { center: WorldCoords; width: number };
export type CameraMotion = "tour" | "reveal" | "approach" | "return" | "mined";
const DURATION: Record<CameraMotion, number> = {
  tour: 1400,
  reveal: 2200,
  approach: 2200,
  return: 1200,
  mined: 2100,
};
const INPUTS = [
  UIEmitterEvent.CanvasMouseDown,
  UIEmitterEvent.CanvasScroll,
  UIEmitterEvent.ZoomIn,
  UIEmitterEvent.ZoomOut,
];

/** Preserve each exercise's original interpolation, including the damped return. */
export function guideCameraFrame(
  start: Frame,
  target: Frame,
  progress: number,
  motion: CameraMotion
): Frame {
  const t = Math.max(0, Math.min(1, progress));
  const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const startWidth = Math.max(start.width, 1),
    endWidth = Math.max(target.width, 1);
  const width = Math.exp(
    Math.log(startWidth) + (Math.log(endWidth) - Math.log(startWidth)) * ease
  );
  let blend = ease;
  if (motion === "reveal") blend = Math.min(1, (ease * width) / endWidth);
  const remaining =
    motion === "approach" || motion === "return"
      ? ((1 - ease) * width) / startWidth
      : undefined;
  if (remaining !== undefined) {
    const k =
      motion === "approach" ? Math.min(1, Math.max(0, remaining)) : remaining;
    return {
      width,
      center: {
        x: target.center.x + (start.center.x - target.center.x) * k,
        y: target.center.y + (start.center.y - target.center.y) * k,
      },
    };
  }
  return {
    width,
    center: {
      x: start.center.x + (target.center.x - start.center.x) * blend,
      y: start.center.y + (target.center.y - start.center.y) * blend,
    },
  };
}

/** Share scheduling and cleanup; only passive return/reveal yields to manual input. */
export function playGuideCamera(
  viewport: Pick<
    Viewport,
    | "centerWorldCoords"
    | "widthInWorldUnits"
    | "minWorldWidth"
    | "maxWorldWidth"
    | "setData"
  >,
  target: Frame,
  motion: CameraMotion,
  onReady?: () => void
): () => void {
  const start = {
    center: { ...viewport.centerWorldCoords },
    width: viewport.widthInWorldUnits,
  };
  const started = performance.now();
  const emitter = UIEmitter.getInstance();
  const interruptible = motion === "return" || motion === "mined";
  let frame = 0,
    stopped = false;
  const cancel = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    if (interruptible)
      for (const event of INPUTS) emitter.removeListener(event, finish);
  };
  const finish = () => {
    if (stopped) return;
    cancel();
    onReady?.();
  };
  const tick = (now: number) => {
    if (stopped) return;
    const progress = (now - started) / DURATION[motion];
    const next =
      progress >= 1
        ? target
        : guideCameraFrame(start, target, progress, motion);
    viewport.setData({
      widthInWorldUnits: Math.min(
        viewport.maxWorldWidth,
        Math.max(viewport.minWorldWidth, next.width)
      ),
      centerWorldCoords: next.center,
    });
    if (progress >= 1) finish();
    else frame = requestAnimationFrame(tick);
  };
  if (interruptible) for (const event of INPUTS) emitter.on(event, finish);
  frame = requestAnimationFrame(tick);
  return cancel;
}
