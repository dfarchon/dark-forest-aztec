/** Stable DOM markers shared by the tutorial's view adapters. */
export function gameCanvas(): HTMLCanvasElement | null {
  const canvas = document.querySelector("canvas[data-game-canvas]");
  return canvas instanceof HTMLCanvasElement ? canvas : null;
}
export function guidePanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-guide-panel]");
}
export function planetPanel(planetId: string): Element | null {
  return document.querySelector(`[data-guide-send-planet="${planetId}"]`);
}
export function targetElement(name: string): Element | null {
  return document.querySelector(`[data-guide-target="${name}"]`);
}
