import type { WorldCoords } from "@dfpunk/types";

/** Interpolate by world width so small early scrolls do not cause large pans. */
export function guideZoomOutCenter(
  start: { width: number; center: WorldCoords },
  width: number,
  maxWidth: number
): WorldCoords {
  if (width >= maxWidth) return { x: 0, y: 0 };
  const progress =
    maxWidth > start.width
      ? Math.max(
          0,
          Math.min(1, (width - start.width) / (maxWidth - start.width))
        )
      : 0;
  const eased = progress * progress * (3 - 2 * progress);
  return { x: start.center.x * (1 - eased), y: start.center.y * (1 - eased) };
}

export function guideZoomInCenter(
  start: { width: number; center: WorldCoords },
  width: number,
  endWidth: number,
  target: WorldCoords
): WorldCoords {
  if (width <= endWidth) return { ...target };
  const progress =
    start.width > endWidth
      ? Math.max(
          0,
          Math.min(1, (start.width - width) / (start.width - endWidth))
        )
      : 0;
  const eased = progress * progress * (3 - 2 * progress);
  return {
    x: start.center.x + (target.x - start.center.x) * eased,
    y: start.center.y + (target.y - start.center.y) * eased,
  };
}

/** The tutorial owns its zoom anchor, while retaining the user's scroll speed. */
export function applyGuideManualZoom(
  viewport: {
    widthInWorldUnits: number;
    minWorldWidth: number;
    maxWorldWidth: number;
    mouseSensitivity: number;
    momentum: boolean;
    velocity: WorldCoords | undefined;
    setData(data: {
      widthInWorldUnits: number;
      centerWorldCoords: WorldCoords;
    }): void;
  },
  widthBeforeScroll: number,
  delta: number,
  center: WorldCoords | ((width: number) => WorldCoords)
): void {
  const requested = widthBeforeScroll * viewport.mouseSensitivity ** delta;
  const width = Number.isNaN(requested)
    ? viewport.widthInWorldUnits
    : Math.max(
        viewport.minWorldWidth,
        Math.min(viewport.maxWorldWidth, requested)
      );
  viewport.momentum = false;
  viewport.velocity = undefined;
  viewport.setData({
    widthInWorldUnits: width,
    centerWorldCoords: {
      ...(typeof center === "function" ? center(width) : center),
    },
  });
}
