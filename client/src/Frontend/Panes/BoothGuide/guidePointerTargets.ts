import type { GuidePoint, GuidePointerPose } from "./guidePointerMotion";

function visibleControl(
  name: string,
  root: ParentNode = document
): HTMLElement | undefined {
  return Array.from(
    root.querySelectorAll(`[data-booth-target="${name}"]`)
  ).find((element): element is HTMLElement => {
    if (
      !(element instanceof HTMLElement) ||
      element.hasAttribute("disabled") ||
      Boolean((element as HTMLElement & { disabled?: boolean }).disabled)
    )
      return false;
    const style = window.getComputedStyle(element);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.pointerEvents === "none" ||
      style.opacity === "0"
    )
      return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 1 &&
      rect.height > 1 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  });
}

export function guidePointerOrigin(
  panel: HTMLElement | null,
  step: string
): GuidePoint | null {
  if (!panel) return null;
  const bounds = panel.getBoundingClientRect();
  if (bounds.width < 2 || bounds.height < 2) return null;
  const row =
    panel.querySelector(`[data-guide-step="${step}"]`) ??
    panel.querySelector("[data-guide-current-step]") ??
    panel;
  const rect = row.getBoundingClientRect();
  const left = Math.max(0, bounds.left),
    right = Math.min(window.innerWidth, bounds.right);
  const top = Math.max(0, bounds.top),
    bottom = Math.min(window.innerHeight, bounds.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    x: Math.max(left + 8, Math.min(right - 12, rect.right - 12)),
    y: Math.max(top + 12, Math.min(bottom - 12, rect.top + rect.height / 2)),
  };
}

export function guideControlPoint(
  name: string,
  root: ParentNode | null = document
): GuidePoint | null {
  if (!root) return null;
  const marker = visibleControl(name, root);
  if (!marker) return null;
  const control =
    marker.querySelector("df-shortcut-button, df-button, button") ?? marker;
  const rect = control.getBoundingClientRect();
  const point = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  return rect.width > 1 &&
    rect.height > 1 &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= window.innerWidth &&
    point.y <= window.innerHeight
    ? point
    : null;
}

/** A missing planet panel must never fall back to its read-only hover preview. */
export function guidePlanetControlPoint(
  name: string,
  planetId: string
): GuidePoint | null {
  return guideControlPoint(
    name,
    document.querySelector(`[data-guide-send-planet="${planetId}"]`)
  );
}

/** Uses the actual range input geometry, including Lit's open shadow root. */
export function guideSliderPose(
  name: string,
  value: number,
  destination: number
): GuidePointerPose {
  const marker = visibleControl(name);
  if (!marker || !Number.isFinite(value) || !Number.isFinite(destination))
    return { kind: "hide" };
  // Spectrum's native range input sits inside its small thumb. The controls
  // element describes the full travel, without the host's label/number field.
  const trackRect = marker.shadowRoot
    ?.querySelector("#controls")
    ?.getBoundingClientRect();
  const input =
    marker.shadowRoot?.querySelector('input[type="range"]') ??
    marker.querySelector('input[type="range"]');
  const inputRect = input?.getBoundingClientRect();
  const rect =
    trackRect && trackRect.width >= 24 && trackRect.height >= 2
      ? trackRect
      : inputRect && inputRect.width >= 24 && inputRect.height >= 2
        ? inputRect
        : marker.getBoundingClientRect();
  if (
    rect.width < 24 ||
    rect.height < 2 ||
    rect.right < 0 ||
    rect.left > window.innerWidth ||
    rect.bottom < 0 ||
    rect.top > window.innerHeight
  )
    return { kind: "hide" };
  const inset = rect === trackRect ? 0 : 10;
  const handleRect = marker.shadowRoot
    ?.querySelector(".handle")
    ?.getBoundingClientRect();
  const y =
    handleRect && handleRect.width > 1 && handleRect.height > 1
      ? handleRect.top + handleRect.height / 2
      : rect.top + rect.height / 2;
  const at = (v: number) => ({
    x:
      rect.left +
      inset +
      ((rect.width - inset * 2) * Math.max(0, Math.min(100, v))) / 100,
    y,
  });
  return { kind: "drag", from: at(value), to: at(destination) };
}
