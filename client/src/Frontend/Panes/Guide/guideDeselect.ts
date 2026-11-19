import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import type Viewport from "../../Game/Viewport";
import { findMapPoint } from "./guideMapPoint";
import { sourcePlanet } from "./guidePlanets";
import type { GuidePoint } from "./guidePointerMotion";
import type { GuidePage, StepCopy } from "./guideTypes";

export function findDeselectPoint(
  ui: GameUIManager,
  viewport: Viewport,
  previous?: GuidePoint
): GuidePoint | undefined {
  return findMapPoint(
    viewport,
    (world) =>
      !ui.getPlanetAtPointer(world) &&
      !ui.getPlanetWithCoords({
        x: Math.round(world.x),
        y: Math.round(world.y),
      }),
    previous
  );
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
