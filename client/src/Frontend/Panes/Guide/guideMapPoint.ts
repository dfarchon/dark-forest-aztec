import type { LocatablePlanet, WorldCoords } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import { gameCanvas } from "./guideElements";
import type { GuidePoint } from "./guidePointerMotion";

/** Match the client-pixel coordinates used by ControllableCanvas mouse events. */
export function guideWorldPoint(world: WorldCoords): GuidePoint | undefined {
  const canvas = gameCanvas();
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const local = Viewport.getInstance().worldToCanvasCoords(world);
  const x = rect.left + local.x,
    y = rect.top + local.y;
  if (document.elementFromPoint(x, y) === canvas) return { x, y };
}

const spots = [
  [0, 0],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function guidePlanetPoint(
  ui: GameUIManager,
  planet: LocatablePlanet
): GuidePoint | undefined {
  const center = planet.location.coords;
  const offset = ui.getRadiusOfPlanetLevel(planet.planetLevel) * 0.65;
  for (const [dx, dy] of spots) {
    const world = { x: center.x + dx * offset, y: center.y + dy * offset };
    const point = guideWorldPoint(world);
    if (!point) continue;
    const hit =
      ui.getPlanetAtPointer(world) ??
      ui.getPlanetWithCoords({
        x: Math.round(world.x),
        y: Math.round(world.y),
      });
    if (hit?.locationId === planet.locationId) return point;
  }
}

// Prefer the center, then sample progressively closer to the canvas edges.
const samplePositions = [0.5, 0.25, 0.75, 0.125, 0.875, 0.04, 0.96];

export function findMapPoint(
  viewport: Viewport,
  accepts: (world: WorldCoords) => boolean,
  previous?: GuidePoint
): GuidePoint | undefined {
  const canvas = gameCanvas();
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const width = Math.min(window.innerWidth, rect.right) - left;
  const height = Math.min(window.innerHeight, rect.bottom) - top;
  if (width <= 0 || height <= 0) return;

  const isValid = ({ x, y }: GuidePoint) => {
    if (document.elementFromPoint(x, y) !== canvas) return false;
    // Match ControllableCanvas mouse coordinates and the game's planet hit test.
    const world = viewport.canvasToWorldCoords({
      x: x - rect.left,
      y: y - rect.top,
    });
    return accepts(world);
  };

  if (previous && isValid(previous)) return previous;
  for (const row of samplePositions) {
    for (const column of samplePositions) {
      const point = { x: left + width * column, y: top + height * row };
      if (isValid(point)) return point;
    }
  }
}

/** Pan only on request, keeping the selected planet, zoom and open windows intact. */
export function revealGuidePlanet(
  ui: GameUIManager,
  planet: LocatablePlanet
): boolean {
  if (guidePlanetPoint(ui, planet)) return true;
  const viewport = Viewport.getInstance();
  const canvas = gameCanvas();
  const point = findMapPoint(viewport, () => true);
  if (!point || !canvas) return false;
  const rect = canvas.getBoundingClientRect();
  const underPoint = viewport.canvasToWorldCoords({
    x: point.x - rect.left,
    y: point.y - rect.top,
  });
  const center = viewport.getViewportPosition();
  viewport.centerCoords({
    x: center.x + planet.location.coords.x - underPoint.x,
    y: center.y + planet.location.coords.y - underPoint.y,
  });
  return true;
}
