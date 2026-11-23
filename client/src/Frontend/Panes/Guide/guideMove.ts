import type { LocatablePlanet } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import {
  moveEnergy,
  requestMove,
} from "../../../Backend/GameLogic/MoveRequest";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";

/** Use the same energy accounting as a manual move. */
export async function sendGuideFleet(
  ui: GameUIManager,
  from: LocatablePlanet,
  to: LocatablePlanet
): Promise<void> {
  const game = ui.getGameManager();
  let { forces } = moveEnergy(from, ui.getForcesSending(from.locationId));
  if (forces >= from.energy) forces = from.energy - 1;
  if (forces < 1) throw new Error("Not enough energy on this planet.");
  const dist = game.getDist(from.locationId, to.locationId);
  const arriving = game.getEnergyArrivingForMove(
    from.locationId,
    to.locationId,
    dist,
    forces,
    false
  );
  if (!(arriving > 0)) throw new Error("That planet is out of range.");
  await requestMove(
    game,
    from.locationId,
    to.locationId,
    forces,
    0,
    undefined,
    false,
    false
  );
}

/** Advance on a valid local send gesture, without waiting for the chain. */
export function watchGuideMove(
  sourceId: string | undefined,
  onRequested: (destination: string) => void,
  onFailed: () => void
): () => void {
  const emitter = UIEmitter.getInstance();
  const sent = (from: string, to?: string) => {
    if (sourceId && from === sourceId && to && to !== from) onRequested(to);
  };
  const failed = (from: string) => {
    if (sourceId && from === sourceId) onFailed();
  };
  emitter.on(UIEmitterEvent.SendCompleted, sent);
  emitter.on(UIEmitterEvent.MoveFailed, failed);
  return () => {
    emitter.removeListener(UIEmitterEvent.SendCompleted, sent);
    emitter.removeListener(UIEmitterEvent.MoveFailed, failed);
  };
}
