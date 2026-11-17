import React from "react";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import type { GuidePage, WatchHooks } from "./BoothGuidePane";
import { armSend } from "./BoothGuidePane";
import { fogPage } from "./FogPage";
import { chapterSteps } from "./guideChapters";
import { guidePlanetControlPoint } from "./guidePointerTargets";
import {
  beginGuideShip,
  guideShipLesson,
  sendGuideShip,
  watchGuideShipMove,
} from "./guideShip";

function ShipIntro() {
  return (
    <p>
      Select the planet holding your ship, choose the first available ship in
      its panel, then press Move and choose another planet. You do not need to
      own either planet.
    </p>
  );
}

function prepareShipPanel(ui: GameUIManager, withShip: boolean): boolean {
  const move = guideShipLesson(ui);
  if (!move) return false;
  if (ui.getSelectedPlanet()?.locationId !== move.from.locationId) {
    ui.setSelectedPlanet(move.from);
    return false;
  }
  if (!guidePlanetControlPoint(`ship-${move.ship.id}`, move.from.locationId)) {
    ui.setSelectedPlanet(move.from);
    return false;
  }
  if (
    withShip &&
    ui.getArtifactSending(move.from.locationId)?.id !== move.ship.id
  ) {
    ui.setArtifactSending(move.from.locationId, move.ship);
    return false;
  }
  return true;
}

function watchShip(hooks: WatchHooks): () => void {
  if (hooks.stepId === "deselect") return fogPage.watch(hooks);
  const { ui, stepId, finish, reject, notify, isSettled, isRunning } = hooks;
  let move = guideShipLesson(ui);
  const emitter = UIEmitter.getInstance();
  const onSelected = () => {
    if (stepId !== "selectShipPlanet" || isSettled()) return;
    move = guideShipLesson(ui) ?? move;
    if (move && ui.getSelectedPlanet()?.locationId === move.from.locationId)
      finish();
    else notify("Select the highlighted planet holding your ship.");
  };
  const onSending = (sending: boolean) => {
    if (
      stepId === "pressShipSend" &&
      sending &&
      !isSettled() &&
      move &&
      ui.getSelectedPlanet()?.locationId === move.from.locationId &&
      ui.getArtifactSending(move.from.locationId)?.id === move.ship.id
    )
      finish();
  };
  const stopMoveWatch =
    stepId === "moveShip"
      ? watchGuideShipMove(move?.from.locationId, move?.ship.id, () => {
          if (!isSettled()) finish();
        })
      : () => {};
  const onFailed = (from: string) => {
    if (
      stepId === "moveShip" &&
      move &&
      from === move.from.locationId &&
      !isSettled()
    )
      reject("Ship move failed. Try again.");
  };
  emitter.on(UIEmitterEvent.GamePlanetSelected, onSelected);
  emitter.on(UIEmitterEvent.MoveFailed, onFailed);
  const sending = ui.isSending$.subscribe(onSending);
  const timer = window.setInterval(() => {
    if (
      document.hidden ||
      isSettled() ||
      isRunning() ||
      stepId === "selectShipPlanet"
    )
      return;
    move = guideShipLesson(ui) ?? move;
    if (!prepareShipPanel(ui, stepId !== "selectShip")) return;
    if (
      stepId === "selectShip" &&
      move &&
      ui.getArtifactSending(move.from.locationId)?.id === move.ship.id
    )
      finish();
    if (stepId === "moveShip" && !ui.isSendingForces() && move)
      armSend(ui, move.from);
  }, 250);
  return () => {
    window.clearInterval(timer);
    sending.unsubscribe();
    emitter.removeListener(UIEmitterEvent.GamePlanetSelected, onSelected);
    stopMoveWatch();
    emitter.removeListener(UIEmitterEvent.MoveFailed, onFailed);
  };
}

export const shipPage: GuidePage = {
  id: "ships",
  steps: chapterSteps("ships"),
  copy: {
    selectShipPlanet: {
      label: "Select the planet holding your ship",
      hint: "Click the planet with the pink ring. One of your ships is parked there.",
      button: "Select the ship's planet",
      running: "Selecting the planet holding your ship.",
      done: "The planet panel is open.",
    },
    selectShip: {
      label: "Select the first available ship in the planet panel",
      hint: "Click the first available ship of yours in the planet panel. The Send button will change to Move followed by the ship's name.",
      button: "Select the first ship",
      running: "Selecting your first available ship.",
      done: "Your ship is selected. Energy is not required to move it.",
    },
    pressShipSend: {
      label: "Press Move to send the selected ship",
      hint: "Click Move in the planet panel, where Send was. The next map click will choose the destination.",
      button: "Press Move",
      running: "Arming the ship move.",
      done: "Move is armed. Choose another planet next.",
    },
    moveShip: {
      label: "Click another planet to send the ship",
      hint: "Click the other planet with the pink ring. Ships can travel any distance, and neither planet needs to be yours.",
      button: "Send my ship",
      running: "Sending your ship.",
      done: "Ship move requested. The transaction continues in the background.",
    },
    deselect: fogPage.copy.deselect,
  },
  Intro: ShipIntro,
  open: (ui, step) => {
    if (step === "deselect") {
      fogPage.open(ui, step);
      return;
    }
    const move =
      step === "selectShipPlanet" ? beginGuideShip(ui) : guideShipLesson(ui);
    if (!move) return;
    if (step === "selectShipPlanet") {
      ui.setArtifactSending(move.from.locationId, undefined);
      return;
    }
    if (ui.getSelectedPlanet()?.locationId !== move.from.locationId)
      ui.setSelectedPlanet(move.from);
    if (step === "selectShip")
      ui.setArtifactSending(move.from.locationId, undefined);
    if (step === "pressShipSend" || step === "moveShip")
      ui.setArtifactSending(move.from.locationId, move.ship);
    if (step === "moveShip") armSend(ui, move.from);
  },
  watch: watchShip,
  assist: async (hooks) => {
    const { ui, stepId, finish } = hooks;
    if (stepId === "deselect") {
      await fogPage.assist(hooks);
      return;
    }
    const move = guideShipLesson(ui);
    if (!move)
      throw new Error(
        "No idle ship is available. Wait for it to arrive or skip this exercise."
      );
    if (stepId === "selectShipPlanet") {
      ui.setSelectedPlanet(move.from);
      finish();
      return;
    }
    if (ui.getSelectedPlanet()?.locationId !== move.from.locationId)
      ui.setSelectedPlanet(move.from);
    if (stepId === "selectShip") {
      ui.setArtifactSending(move.from.locationId, move.ship);
      finish();
      return;
    }
    if (stepId === "pressShipSend") {
      ui.setArtifactSending(move.from.locationId, move.ship);
      armSend(ui, move.from);
      return;
    }
    if (stepId === "moveShip") await sendGuideShip(ui);
  },
};
