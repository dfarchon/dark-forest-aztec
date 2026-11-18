import type { GuidePoint, GuidePointerPose } from "./guidePointerMotion";

function finite(point: GuidePoint | null): point is GuidePoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function guidePoseEndpoint(pose: GuidePointerPose): GuidePoint | null {
  if (pose.kind === "hide") return null;
  const point = pose.kind === "drag" ? pose.to : pose.at;
  return finite(point) ? { ...point } : null;
}

/** Owned by the lesson, so its history survives a cursor unmount between steps. */
export class GuidePointerSequence {
  private key: string | undefined;
  private start: GuidePoint | null = null;
  private end: GuidePoint | null = null;

  reset(): void {
    this.key = undefined;
    this.start = null;
    this.end = null;
  }

  remember(point: GuidePoint): void {
    if (finite(point)) this.end = { ...point };
  }

  origin(
    key: string,
    fallback: GuidePoint | null,
    width: number,
    height: number
  ): GuidePoint | null {
    const visible = (p: GuidePoint | null): p is GuidePoint =>
      finite(p) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
    if (key !== this.key) {
      this.key = key;
      this.start = visible(this.end) ? { ...this.end } : null;
    }
    // Snapshot once per step. Repeated demonstration cycles never inherit
    // their own endpoint. If a resize invalidates it, use the lesson row.
    if (!visible(this.start))
      this.start = visible(fallback) ? { ...fallback } : null;
    return this.start ? { ...this.start } : null;
  }
}
