import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import type Viewport from "../../Game/Viewport";
import { gameCanvas } from "./guideElements";
import type { GuidePoint } from "./guidePointerMotion";
import { sourcePlanet } from "./guidePlanets";
import type { GuidePage, StepCopy } from "./guideTypes";

// Prefer the center, then sample progressively closer to the canvas edges.
const samplePositions = [0.5, 0.25, 0.75, 0.125, 0.875, 0.04, 0.96];

export function findDeselectPoint(
  ui: GameUIManager,
  viewport: Viewport,
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

  const isEmpty = ({ x, y }: GuidePoint) => {
    if (document.elementFromPoint(x, y) !== canvas) return false;
    // Match ControllableCanvas mouse coordinates and the game's planet hit test.
    const world = viewport.canvasToWorldCoords({
      x: x - rect.left,
      y: y - rect.top,
    });
    return (
      !ui.getPlanetAtPointer(world) &&
      !ui.getPlanetWithCoords({
        x: Math.round(world.x),
        y: Math.round(world.y),
      })
    );
  };

  if (previous && isEmpty(previous)) return previous;
  for (const row of samplePositions) {
    for (const column of samplePositions) {
      const point = { x: left + width * column, y: top + height * row };
      if (isEmpty(point)) return point;
    }
  }
}

/** Shared deselection exercise, independent of any chapter. */
export const guideDeselect: Pick<GuidePage, "open" | "watch" | "assist"> & {
  copy: StepCopy;
} = {
  copy: {
    label: "Click empty space to deselect",
    hint: "Click empty space on the map. This clears the selected planet and reveals explorer controls.",
    button: "Deselect my planet",
    running: "Clearing the selection.",
    done: "Nothing is selected. Explorer controls are available.",
  },
  open: (ui) => {
    const planet = sourcePlanet(ui);
    if (planet) ui.setSelectedPlanet(planet);
  },
  watch: ({ ui, finish }) => {
    let ready = false;
    const sub = ui.selectedPlanetId$.subscribe((id) => {
      if (ready && !id) finish();
    });
    ready = true;
    return () => sub.unsubscribe();
  },
  assist: async ({ ui }) => {
    ui.setSelectedPlanet(undefined);
  },
};
