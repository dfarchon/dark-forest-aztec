import {
  type Dispatch,
  type SetStateAction,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
export type GuideObstacle = Point & Size;
const PAD = 12;

function overlap(a: GuideObstacle, b: GuideObstacle): number {
  return (
    Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width + PAD) - Math.max(a.x, b.x - PAD)
    ) *
    Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height + PAD) - Math.max(a.y, b.y - PAD)
    )
  );
}

/** Keep a clear position; otherwise find the closest free space, shrinking height if needed. */
export function placeGuidePanel(
  view: Size,
  size: Size,
  current: Point,
  obstacles: GuideObstacle[]
): Point & { height: number } {
  const height = Math.min(size.height, Math.max(1, view.height - PAD * 2));
  const minHeight = Math.min(height, 160);
  const clampX = (x: number) =>
    Math.max(PAD, Math.min(Math.max(PAD, view.width - size.width - PAD), x));
  const clampY = (y: number) =>
    Math.max(PAD, Math.min(Math.max(PAD, view.height - minHeight - PAD), y));
  const xs = new Set([clampX(current.x), PAD, clampX(view.width)]);
  const ys = new Set([
    clampY(current.y),
    PAD,
    clampY(view.height - height - PAD),
    clampY(view.height),
  ]);
  for (const box of obstacles) {
    xs.add(clampX(box.x + box.width + PAD));
    xs.add(clampX(box.x - size.width - PAD));
    for (const y of [
      box.y + box.height + PAD,
      box.y - height - PAD,
      box.y - minHeight - PAD,
    ])
      ys.add(clampY(y));
  }
  const candidates: Array<
    Point & { height: number; covered: number; distance: number }
  > = [];
  for (const x of xs)
    for (const y of ys) {
      let available = Math.min(height, view.height - y - PAD);
      for (const box of obstacles) {
        if (
          x + size.width <= box.x - PAD ||
          x >= box.x + box.width + PAD ||
          y >= box.y + box.height + PAD
        )
          continue;
        available = Math.min(available, box.y - PAD - y);
      }
      const candidateHeight = available >= minHeight ? available : minHeight;
      const rect = { x, y, width: size.width, height: candidateHeight };
      candidates.push({
        x,
        y,
        height: candidateHeight,
        covered: obstacles.reduce(
          (total, box) => total + overlap(rect, box),
          0
        ),
        distance: Math.hypot(x - current.x, y - current.y),
      });
    }
  candidates.sort(
    (a, b) =>
      a.covered - b.covered || b.height - a.height || a.distance - b.distance
  );
  const best = candidates[0];
  return { x: best.x, y: best.y, height: best.height };
}

/** Watch real panel geometry, not pointer-animation style changes or canvas frames. */
export function useGuidePanelPlacement(
  panelRef: { readonly current: HTMLElement | null },
  position: Point,
  setPosition: Dispatch<SetStateAction<Point>>,
  drag: { readonly current: unknown }
) {
  const current = useRef(position);
  current.current = position;
  const [maxHeight, setMaxHeight] = useState<number>();
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    let frame = 0;
    const observed = new Set<Element>();
    const update = () => {
      frame = 0;
      if (drag.current) return;
      const bounds = parent.getBoundingClientRect();
      const own = panel.getBoundingClientRect();
      const body = panel.querySelector<HTMLElement>("[data-guide-body]");
      const height = Math.ceil(
        own.height + (body ? body.scrollHeight - body.clientHeight : 0)
      );
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>("[data-guide-obstacle]")
      );
      const boxes: GuideObstacle[] = [];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          rect.width < 1 ||
          rect.height < 1 ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          continue;
        const left = Math.max(bounds.left, rect.left),
          top = Math.max(bounds.top, rect.top);
        const right = Math.min(bounds.right, rect.right),
          bottom = Math.min(bounds.bottom, rect.bottom);
        if (right > left && bottom > top)
          boxes.push({
            x: left - bounds.left,
            y: top - bounds.top,
            width: right - left,
            height: bottom - top,
          });
      }
      const nextObserved = new Set<Element>([
        panel,
        parent,
        ...(body ? [body] : []),
        ...elements,
      ]);
      for (const element of observed)
        if (!nextObserved.has(element)) {
          resize.unobserve(element);
          observed.delete(element);
        }
      for (const element of nextObserved)
        if (!observed.has(element)) {
          resize.observe(element);
          observed.add(element);
        }
      const next = placeGuidePanel(
        { width: bounds.width, height: bounds.height },
        { width: own.width, height },
        current.current,
        boxes
      );
      setPosition((before) =>
        Math.abs(before.x - next.x) < 1 && Math.abs(before.y - next.y) < 1
          ? before
          : { x: next.x, y: next.y }
      );
      setMaxHeight((before) =>
        before !== undefined && Math.abs(before - next.height) < 1
          ? before
          : next.height
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-guide-obstacle"],
    });
    mutations.observe(panel, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener("position-changed", schedule);
    document.addEventListener("transitionend", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("pointerup", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      document.removeEventListener("position-changed", schedule);
      document.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointerup", schedule);
    };
  }, [panelRef, setPosition, drag]);
  return maxHeight;
}
