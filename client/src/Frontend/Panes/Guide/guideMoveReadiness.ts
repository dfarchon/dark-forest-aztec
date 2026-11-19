import { isLocatable } from "@dfpunk/gamelogic";
import type { LocationId } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";

/** Restore local selection only. Never changes the amount or submits a move. */
export function restoreGuideMoveSelection(
  ui: GameUIManager,
  sourceId: LocationId | undefined,
  controlReady: () => boolean
): boolean {
  const from = sourceId ? ui.getPlanetWithId(sourceId) : undefined;
  if (
    !from ||
    !isLocatable(from) ||
    !ui.isOwnedByMe(from) ||
    from.destroyed ||
    from.energy <= 1
  )
    return false;
  if (ui.getSelectedPlanet()?.locationId !== sourceId || !controlReady()) {
    ui.setSelectedPlanet(from);
    return false;
  }
  return true;
}
