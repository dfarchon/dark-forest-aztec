import { isUnconfirmedMoveTx } from "@dfpunk/serde";
import type { LocatablePlanet } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";

/** Use the same energy accounting and timestamp as a manual move. */
export async function sendGuideFleet(
  ui: GameUIManager,
  from: LocatablePlanet,
  to: LocatablePlanet
): Promise<void> {
  const game = ui.getGameManager();
  let effective = from.energy;
  for (const tx of from.transactions?.getTransactions(isUnconfirmedMoveTx) ??
    []) {
    effective -= tx.intent.forces;
  }
  const percent = Math.min(ui.getForcesSending(from.locationId), 98);
  let forces = Math.floor((effective * percent) / 100);
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
  const emitter = UIEmitter.getInstance();
  try {
    const queued = game.move(
      from.locationId,
      to.locationId,
      forces,
      0,
      undefined,
      false,
      false,
      from.lastUpdated
    );
    emitter.emit(UIEmitterEvent.SendCompleted, from.locationId, to.locationId);
    // The lesson has completed; continue tracking the transaction in the background.
    const tx = await queued;
    emitter.emit(UIEmitterEvent.MoveQueued, from.locationId);
    await tx.submittedPromise;
    emitter.emit(UIEmitterEvent.MoveSubmitted, from.locationId, to.locationId);
  } catch (error) {
    emitter.emit(UIEmitterEvent.MoveFailed, from.locationId);
    throw error;
  }
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
