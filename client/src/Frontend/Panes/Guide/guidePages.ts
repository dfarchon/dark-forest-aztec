import { controlsPage } from "./ControlsPage";
import { fogPage } from "./FogPage";
import type { GuidePage, StepCopy, StepId, TaskId } from "./guideTypes";
import { movePage } from "./MovePage";
import { planetPage } from "./PlanetPage";
import { reviewPage } from "./ReviewPage";
import { shipPage } from "./ShipPage";
export const TASK_PAGES: Record<TaskId, GuidePage> = {
  planet: planetPage,
  move: movePage,
  ships: shipPage,
  fog: fogPage,
  controls: controlsPage,
  review: reviewPage,
};

export const STEPS = {
  ...planetPage.copy,
  ...movePage.copy,
  ...shipPage.copy,
  ...fogPage.copy,
  ...controlsPage.copy,
  ...reviewPage.copy,
} as Record<StepId, StepCopy>;
