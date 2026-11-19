import { isActivated, isLocatable, isSpaceShip } from "@dfpunk/gamelogic";
import { isUnconfirmedMoveTx } from "@dfpunk/serde";
import type { Artifact, LocatablePlanet } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import { requestMove } from "../../../Backend/GameLogic/MoveRequest";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";

type ShipMove = { ship: Artifact; from: LocatablePlanet; to: LocatablePlanet };
const lessons = new WeakMap<GameUIManager, ShipMove>();

export function firstGuideShip(
  ui: GameUIManager,
  planet: LocatablePlanet
): Artifact | undefined {
  const account = ui.getAccount();
  return ui
    .getArtifactsWithIds(planet.heldArtifactIds)
    .find(
      (ship) =>
        ship &&
        isSpaceShip(ship.artifactType) &&
        ship.controller === account &&
        !isActivated(ship) &&
        ship.onPlanetId === planet.locationId &&
        ship.onVoyageId === undefined &&
        !ship.transactions?.getTransactions(isUnconfirmedMoveTx).length
    );
}

export function beginGuideShip(ui: GameUIManager): ShipMove | undefined {
  lessons.delete(ui);
  const move = guideShip(ui);
  if (move) lessons.set(ui, move);
  return move;
}

/** Pin the same planet and first panel ship throughout the exercise. */
export function guideShipLesson(ui: GameUIManager): ShipMove | undefined {
  const saved = lessons.get(ui);
  if (!saved) {
    const move = guideShip(ui);
    if (move) lessons.set(ui, move);
    return move;
  }
  const ship = ui.getMyArtifacts().find((item) => item.id === saved.ship.id);
  if (
    !ship ||
    ship.onPlanetId !== saved.from.locationId ||
    ship.onVoyageId !== undefined ||
    ship.transactions?.getTransactions(isUnconfirmedMoveTx).length
  )
    return undefined;
  return { ...saved, ship };
}

export function guideShip(
  ui: GameUIManager
): { ship: Artifact; from: LocatablePlanet; to: LocatablePlanet } | undefined {
  for (const ship of ui.getMyArtifacts()) {
    if (
      !isSpaceShip(ship.artifactType) ||
      !ship.onPlanetId ||
      ship.onVoyageId !== undefined ||
      ship.transactions?.getTransactions(isUnconfirmedMoveTx).length
    )
      continue;
    const from = ui.getPlanetWithId(ship.onPlanetId);
    if (!from || !isLocatable(from)) continue;
    const first = firstGuideShip(ui, from);
    if (!first || first.id !== ship.id) continue;
    const to = Array.from(ui.getGameManager().getAllPlanets())
      .sort((a, b) => {
        if (!isLocatable(a) || !isLocatable(b)) return 0;
        return (
          Math.hypot(
            a.location.coords.x - from.location.coords.x,
            a.location.coords.y - from.location.coords.y
          ) -
          Math.hypot(
            b.location.coords.x - from.location.coords.x,
            b.location.coords.y - from.location.coords.y
          )
        );
      })
      .find(
        (planet) =>
          isLocatable(planet) &&
          planet.locationId !== from.locationId &&
          !planet.destroyed
      );
    if (to && isLocatable(to)) return { ship, from, to };
  }
}

/** Complete the exercise on a valid local send, as in the Ares guide. */
export function watchGuideShipMove(
  sourceId: string | undefined,
  shipId: string | undefined,
  onRequested: () => void
): () => void {
  const emitter = UIEmitter.getInstance();
  const onSent = (from: string, to?: string, artifact?: string) => {
    if (
      sourceId &&
      shipId &&
      from === sourceId &&
      to &&
      to !== from &&
      artifact === shipId
    )
      onRequested();
  };
  emitter.on(UIEmitterEvent.SendCompleted, onSent);
  return () => emitter.removeListener(UIEmitterEvent.SendCompleted, onSent);
}

export async function sendGuideShip(ui: GameUIManager): Promise<void> {
  const move = guideShipLesson(ui);
  if (!move)
    throw new Error(
      "No available ship and destination. Wait for your ship to arrive or continue without this step."
    );
  const { ship, from, to } = move;
  await requestMove(
    ui.getGameManager(),
    from.locationId,
    to.locationId,
    0,
    0,
    ship.id,
    false,
    false,
    from.lastUpdated
  );
}
