import { CursorState } from "@dfpunk/types";

/**
 * Decides which surface owns a pointer event. Callers still perform the action.
 * This module does not listen for events itself.
 */

export type PointerRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PointerSample = {
  clientX: number;
  clientY: number;
  deltaY?: number;
  composedPath(): EventTarget[];
};

export type PointerTargetKind = "terminal" | "pane" | "minimap" | "map";

export type MapPointerAction = "place-miner" | "map";

const MINIMAP_TARGET = "minimap";

export type PointerPoint = {
  clientX: number;
  clientY: number;
};

type Overlay = {
  getRect: () => PointerRect | undefined;
  /** When set, a point inside the rectangle still misses if this returns false. */
  hit?: (point: PointerPoint) => boolean;
};

const overlays = new Map<number, Overlay>();
let nextOverlayId = 1;

/**
 * A region that is not in the hit-test path, such as the live terminal.
 * `hit` narrows that rectangle: empty space inside it can stay on the map.
 */
export function registerPointerOverlay(
  getRect: () => PointerRect | undefined,
  hit?: (point: PointerPoint) => boolean
): () => void {
  const id = nextOverlayId++;
  overlays.set(id, { getRect, hit });
  return () => {
    overlays.delete(id);
  };
}

export function mapPointerAction(cursorState: CursorState): MapPointerAction {
  return cursorState === CursorState.TargetingExplorer ? "place-miner" : "map";
}

export function pointerTarget(event: PointerSample): {
  kind: PointerTargetKind;
} {
  const deltaY = event.deltaY ?? 0;
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.dataset.pointerTarget === MINIMAP_TARGET)
      return { kind: "minimap" };
    if (canScrollVertically(node, deltaY)) return { kind: "pane" };
  }
  // The live terminal does not appear in the hit path. Only its text and
  // scrollbar claim the wheel; empty space in the column stays on the map.
  if (hitsOverlay(event)) return { kind: "terminal" };
  return { kind: "map" };
}

function hitsOverlay(event: PointerSample): boolean {
  for (const overlay of overlays.values()) {
    const rect = overlay.getRect();
    if (!rect) continue;
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) continue;
    if (overlay.hit && !overlay.hit(event)) continue;
    return true;
  }
  return false;
}

function canScrollVertically(node: HTMLElement, deltaY: number): boolean {
  if (deltaY === 0) return false;
  if (typeof document !== "undefined") {
    if (node === document.body || node === document.documentElement)
      return false;
  }

  const overflowY = window.getComputedStyle(node).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  if (node.scrollHeight <= node.clientHeight + 1) return false;

  const atTop = node.scrollTop <= 0;
  const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
  return (deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom);
}
