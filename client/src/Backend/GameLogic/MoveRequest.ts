import { isPendingUnconfirmedMoveTx } from "@dfpunk/serde";
import type { LocatablePlanet } from "@dfpunk/types";

import UIEmitter, { UIEmitterEvent } from "../../Frontend/Utils/UIEmitter";
import type GameManager from "./GameManager";

/** The same pending-energy accounting for manual and assisted sends. */
export function moveEnergy(from: LocatablePlanet, percent: number) {
  let effectiveEnergy = from.energy;
  for (const tx of from.transactions?.getTransactions(
    isPendingUnconfirmedMoveTx
  ) ?? [])
    effectiveEnergy -= tx.intent.forces;
  const effPercent = Math.min(percent, 98);
  return {
    effectiveEnergy,
    effPercent,
    forces: Math.floor((effectiveEnergy * effPercent) / 100),
  };
}

/** A valid local request completes the gesture before proof/submission finishes. */
export async function requestMove(
  game: Pick<GameManager, "move" | "getGameObjects">,
  ...args: Parameters<GameManager["move"]>
): Promise<void> {
  const [from, to, , , artifact] = args;
  const emitter = UIEmitter.getInstance();
  let tx: Awaited<ReturnType<GameManager["move"]>> | undefined;
  try {
    const queued = game.move(...args);
    emitter.emit(UIEmitterEvent.SendCompleted, from, to, artifact);
    tx = await queued;
    await tx.submittedPromise;
  } catch (error) {
    if (tx) game.getGameObjects().clearUnconfirmedTxIntent(tx);
    emitter.emit(UIEmitterEvent.MoveFailed, from);
    throw error;
  }
}
