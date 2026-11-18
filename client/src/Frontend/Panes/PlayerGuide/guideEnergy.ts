import { isLocatable } from "@dfpunk/gamelogic";
import type { LocatablePlanet } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import { guidePlanetPoint } from "./guideMapPoint";
import { pickTarget, sourcePlanet } from "./guidePlanets";
import {
  SEND_PERCENT,
  SLIDER_ASIDE,
  type StepId,
  type ViewFrame,
} from "./guideTypes";
import {
  aspectRatio,
  clampWidth,
  homeRestFrame,
  planetCloseFrame,
} from "./guideWorld";
export function selectedMovePlanet(
  ui: GameUIManager
): LocatablePlanet | undefined {
  const selected = ui.getSelectedPlanet();
  if (
    selected &&
    isLocatable(selected) &&
    ui.isOwnedByMe(selected) &&
    selected.energy > 1
  ) {
    return selected;
  }
  return undefined;
}

export function moveSourcePlanet(
  ui: GameUIManager
): LocatablePlanet | undefined {
  return selectedMovePlanet(ui) ?? sourcePlanet(ui);
}

export function canReachNearbyPlanet(
  ui: GameUIManager,
  from: LocatablePlanet,
  percent: number
): boolean {
  return Boolean(pickTarget(ui, from, false, percent));
}

export function sufficientSendPercent(
  ui: GameUIManager,
  from: LocatablePlanet
): number | undefined {
  if (canReachNearbyPlanet(ui, from, SEND_PERCENT)) return SEND_PERCENT;
  for (let percent = SEND_PERCENT + 5; percent <= 95; percent += 5) {
    if (canReachNearbyPlanet(ui, from, percent)) return percent;
  }
  return canReachNearbyPlanet(ui, from, 98) ? 98 : undefined;
}

export function guideEnergyTarget(ui: GameUIManager): number | undefined {
  const from = moveSourcePlanet(ui);
  return from ? sufficientSendPercent(ui, from) : undefined;
}

function ownedEnergyPlanets(ui: GameUIManager): LocatablePlanet[] {
  return ui
    .getGameManager()
    .getMyPlanets()
    .filter(
      (planet): planet is LocatablePlanet =>
        isLocatable(planet) && ui.isOwnedByMe(planet) && planet.energy > 1
    );
}

const VIEW_RIM = 0.75;

function viewPlacement(planet: LocatablePlanet): {
  rim: number;
  center: number;
} {
  const viewport = Viewport.getInstance();
  const center = viewport.getViewportPosition();
  const halfW = viewport.getViewportWorldWidth() / 2;
  const halfH = viewport.getViewportWorldHeight() / 2;
  if (halfW <= 0 || halfH <= 0) return { rim: 0, center: 0 };
  const nx = Math.abs(planet.location.coords.x - center.x) / halfW;
  const ny = Math.abs(planet.location.coords.y - center.y) / halfH;
  return { rim: Math.max(nx, ny), center: Math.hypot(nx, ny) };
}

export function guideMovePlanet(
  ui: GameUIManager
): LocatablePlanet | undefined {
  const placed = ownedEnergyPlanets(ui).map((planet) => ({
    planet,
    ...viewPlacement(planet),
  }));
  placed.sort(
    (a, b) =>
      Number(a.rim > VIEW_RIM) - Number(b.rim > VIEW_RIM) ||
      a.center - b.center ||
      b.planet.energy - a.planet.energy ||
      a.planet.locationId.localeCompare(b.planet.locationId)
  );
  return (
    placed.find(({ rim, planet }) => rim <= 1 && guidePlanetPoint(ui, planet))
      ?.planet ?? placed[0]?.planet
  );
}

function planetsInSendRange(
  ui: GameUIManager,
  from: LocatablePlanet,
  percent: number
): LocatablePlanet[] {
  try {
    return ui
      .getGameManager()
      .getPlanetsInRange(from.locationId, percent, false)
      .filter(
        (planet): planet is LocatablePlanet =>
          isLocatable(planet) &&
          !planet.destroyed &&
          planet.locationId !== from.locationId
      );
  } catch {
    return [];
  }
}

export function guideNearbyPlanet(
  ui: GameUIManager,
  from: LocatablePlanet,
  percent: number
): LocatablePlanet | undefined {
  const onScreen = planetsInSendRange(ui, from, percent)
    .map((planet) => ({ planet, ...viewPlacement(planet) }))
    .filter((item) => item.rim <= 1);
  if (onScreen.length === 0) return pickTarget(ui, from, false, percent);
  onScreen.sort(
    (a, b) =>
      a.center - b.center ||
      a.planet.locationId.localeCompare(b.planet.locationId)
  );
  return (
    onScreen.find(({ planet }) => guidePlanetPoint(ui, planet))?.planet ??
    onScreen[0].planet
  );
}

export function moveLessonPlanet(
  ui: GameUIManager,
  stepId: StepId
): LocatablePlanet | undefined {
  if (stepId === "selectMovePlanet") {
    return guideMovePlanet(ui);
  }
  if (stepId !== "clickNearby") return;
  const from = selectedMovePlanet(ui);
  if (!from) return;
  const percent = ui.getForcesSending(from.locationId);
  return guideNearbyPlanet(
    ui,
    from,
    percent === SLIDER_ASIDE ? SEND_PERCENT : percent
  );
}

export function moveGuideFrame(
  ui: GameUIManager,
  viewport: Viewport
): ViewFrame {
  const from = guideMovePlanet(ui);
  if (!from) return homeRestFrame(ui, viewport);
  const target = pickTarget(ui, from, false, SEND_PERCENT);
  if (!target) return planetCloseFrame(ui, from);
  const dx = Math.abs(from.location.coords.x - target.location.coords.x);
  const dy = Math.abs(from.location.coords.y - target.location.coords.y);
  const span = Math.max(dx * 2, dy * 2 * aspectRatio(viewport));
  return {
    center: { ...from.location.coords },
    width: clampWidth(
      Math.max(span * 1.45, viewport.minWorldWidth * 40),
      viewport
    ),
  };
}
