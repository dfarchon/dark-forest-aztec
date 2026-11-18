import { isLocatable } from "@dfpunk/gamelogic";
import { CursorState, type LocatablePlanet, type Planet } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import { SEND_PERCENT } from "./guideTypes";
export function locatableHome(ui: GameUIManager): LocatablePlanet | undefined {
  const home = ui.getHomePlanet();
  return home && isLocatable(home) && ui.isOwnedByMe(home) && !home.destroyed
    ? home
    : undefined;
}

export function sourcePlanet(ui: GameUIManager): LocatablePlanet | undefined {
  const home = ui.getHomePlanet();
  if (
    home &&
    isLocatable(home) &&
    ui.isOwnedByMe(home) &&
    !home.destroyed &&
    home.energy > 1
  )
    return home;
  const owned = ui
    .getGameManager()
    .getMyPlanets()
    .filter(
      (planet): planet is LocatablePlanet =>
        isLocatable(planet) &&
        ui.isOwnedByMe(planet) &&
        !planet.destroyed &&
        planet.energy > 1
    )
    .sort((a, b) => b.energy - a.energy);
  if (owned[0]) return owned[0];
  return home && isLocatable(home) ? home : undefined;
}

export function pickTarget(
  ui: GameUIManager,
  from: LocatablePlanet,
  enemyOnly: boolean,
  percent: number = SEND_PERCENT
): LocatablePlanet | undefined {
  let planets: Planet[] = [];
  try {
    planets = ui
      .getGameManager()
      .getPlanetsInRange(from.locationId, percent, false);
  } catch {
    return undefined;
  }
  const fromCoords = from.location.coords;
  const candidates = planets.filter((planet): planet is LocatablePlanet => {
    if (
      !isLocatable(planet) ||
      planet.destroyed ||
      planet.locationId === from.locationId
    )
      return false;
    if (enemyOnly && ui.isOwnedByMe(planet)) return false;
    return true;
  });
  candidates.sort(
    (a, b) =>
      ui.getDistCoords(fromCoords, a.location.coords) -
      ui.getDistCoords(fromCoords, b.location.coords)
  );
  return candidates[0];
}

export function clearLocalControls(
  ui: GameUIManager,
  preserveSelection = false
): void {
  UIEmitter.getInstance().emit(UIEmitterEvent.SendCancelled);
  if (!preserveSelection) ui.setSelectedPlanet(undefined);
  ui.getModalManager().setCursorState(CursorState.Normal);
}

export function armSend(ui: GameUIManager, planet: LocatablePlanet): void {
  ui.setSending(true);
  UIEmitter.getInstance().emit(UIEmitterEvent.SendInitiated, planet);
}
