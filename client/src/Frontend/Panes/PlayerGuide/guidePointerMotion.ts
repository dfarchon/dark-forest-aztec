export type GuidePoint = { x: number; y: number };
export type GuidePointerPose =
  | { kind: "hide" }
  | { kind: "click"; at: GuidePoint }
  | { kind: "hover"; at: GuidePoint }
  | { kind: "scroll"; at: GuidePoint; direction: "up" | "down" }
  | {
      kind: "drag";
      from: GuidePoint;
      to: GuidePoint;
      thenScroll?: "up" | "down";
    };

export const APPROACH_MS = 900;
export const DRAG_MS = 1600;
const SCROLL_AFTER_MS = 1400;
const FADE_MS = 300;
const REST_MS = 450;

export type GuidePointerFrame = {
  at: GuidePoint | null;
  gesture: "travel" | "click" | "hover" | "scroll" | "drag";
  pressed: boolean;
  direction: "up" | "down";
  opacity: number;
  complete: boolean;
  cycle: number;
  dragProgress?: number;
};

function ease(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/** A bounded cubic path: it stays inside the origin/target rectangle. */
export function guideCurve(
  from: GuidePoint,
  to: GuidePoint,
  progress: number
): GuidePoint {
  const t = ease(progress),
    u = 1 - t;
  const dx = to.x - from.x;
  return {
    x:
      u ** 3 * from.x +
      3 * u ** 2 * t * (from.x + dx * 0.45) +
      3 * u * t ** 2 * (to.x - dx * 0.25) +
      t ** 3 * to.x,
    y:
      u ** 3 * from.y +
      3 * u ** 2 * t * from.y +
      3 * u * t ** 2 * to.y +
      t ** 3 * to.y,
  };
}

/** Purely visual sampling. This function never dispatches clicks or input events. */
export function sampleGuidePointer(
  pose: GuidePointerPose,
  origin: GuidePoint | null,
  elapsed: number,
  reducedMotion = false
): GuidePointerFrame {
  const hidden: GuidePointerFrame = {
    at: null,
    gesture: "travel",
    pressed: false,
    direction: "down",
    opacity: 0,
    complete: false,
    cycle: 0,
  };
  if (pose.kind === "hide" || !origin || !Number.isFinite(elapsed))
    return hidden;
  const target = pose.kind === "drag" ? pose.from : pose.at;
  const points = [origin, target, ...(pose.kind === "drag" ? [pose.to] : [])];
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return hidden;
  const actionMs =
    pose.kind === "drag"
      ? DRAG_MS + (pose.thenScroll ? SCROLL_AFTER_MS : 0)
      : 1100;
  const cycleMs = APPROACH_MS + actionMs + FADE_MS + REST_MS;
  const clock = Math.max(0, elapsed);
  const local = clock % cycleMs;
  const action = local - APPROACH_MS;
  const frame: GuidePointerFrame = {
    at: reducedMotion
      ? target
      : guideCurve(origin, target, local / APPROACH_MS),
    gesture: "travel",
    pressed: false,
    direction: "down",
    opacity: 1,
    complete: action >= actionMs,
    cycle: Math.floor(clock / cycleMs),
  };
  if (action < 0) return frame;
  frame.at = target;
  frame.gesture = pose.kind;
  if (pose.kind === "scroll") frame.direction = pose.direction;
  if (pose.kind === "click") frame.pressed = action >= 340 && action < 600;
  if (pose.kind === "drag") {
    const progress = ease((action / DRAG_MS - 0.16) / 0.58);
    frame.dragProgress = progress;
    frame.at = reducedMotion
      ? pose.from
      : {
          x: pose.from.x + (pose.to.x - pose.from.x) * progress,
          y: pose.from.y + (pose.to.y - pose.from.y) * progress,
        };
    frame.pressed = action / DRAG_MS > 0.1 && action / DRAG_MS < 0.82;
    if (pose.thenScroll && action >= DRAG_MS) {
      frame.gesture = "scroll";
      frame.direction = pose.thenScroll;
    }
  }
  if (action >= actionMs)
    frame.opacity = Math.max(0, 1 - (action - actionMs) / FADE_MS);
  if (reducedMotion) frame.pressed = false;
  return frame;
}
