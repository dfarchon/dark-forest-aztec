import { isLocatable } from "@dfpunk/gamelogic";
import React from "react";

import GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import { useUIManager } from "../../Utils/AppHooks";
import { chapterSteps } from "./guideChapters";
import {
  canReachNearbyPlanet,
  moveSourcePlanet,
  sufficientSendPercent,
} from "./guideEnergy";
import { sendGuideFleet, watchGuideMove } from "./guideMove";
import { restoreGuideMoveSelection } from "./guideMoveReadiness";
import { armSend } from "./guidePlanets";
import { guideControlPoint } from "./guidePointerTargets";
import type {
  AssistHooks,
  GuidePage,
  StepCopy,
  StepId,
  WatchHooks,
} from "./guideTypes";
import { SEND_PERCENT, SLIDER_ASIDE } from "./guideTypes";

const copy: Record<
  "selectMovePlanet" | "setEnergy" | "pressSend" | "clickNearby",
  StepCopy
> = {
  selectMovePlanet: {
    label: "Select one of your planets",
    hint: "Click the planet with the pink ring.",
    button: "Select my planet",
    assistLead: "We can select one for you:",
    running: "Selecting one of your planets.",
    done: "This planet will send the energy.",
  },
  setEnergy: {
    label: "Choose how much energy to send",
    hint: "Increase the slider until there is enough energy to reach a nearby planet.",
    button: "Choose an amount for me",
    assistLead: "We can choose an amount:",
    running: "Choosing an amount to send.",
    done: "That amount is ready to send.",
  },
  pressSend: {
    label: "Press Send",
    hint: "Press Send on your planet.",
    button: "Press Send",
    assistLead: "We can press Send:",
    running: "Pressing Send.",
    done: "Send is armed. The next click chooses a planet.",
  },
  clickNearby: {
    label: "Click a nearby planet",
    hint: "Click a nearby planet with a pink ring.",
    button: "Send to a nearby planet",
    assistLead: "We can send it for you:",
    running: "Sending energy to a nearby planet.",
    done: "Move requested. Dotted lines are pending; solid lines are confirmed.",
  },
};

function MoveIntro() {
  const ui = useUIManager();
  return (
    <>
      <p>
        Select a planet and send energy to a nearby planet. Dotted lines show
        pending moves; solid lines show confirmed moves.
      </p>
      {ui.getSpaceJunkEnabled() && (
        <p>
          Sending energy to an unvisited planet adds space junk. Check your
          current amount and limit at the top; you cannot exceed the limit.
        </p>
      )}
    </>
  );
}

function openMove(ui: GameUIManager, step: StepId): void {
  if (step === "selectMovePlanet") return;
  if (step === "setEnergy" || step === "pressSend") {
    const from = moveSourcePlanet(ui);
    if (!from) return;
    ui.setSelectedPlanet(from);
    if (step === "setEnergy")
      ui.setForcesSending(from.locationId, SLIDER_ASIDE);
    return;
  }
  if (step !== "clickNearby") return;
  const from = moveSourcePlanet(ui);
  if (!from) return;
  ui.setSelectedPlanet(from);
  armSend(ui, from);
}

function watchMove(hooks: WatchHooks): () => void {
  const stopWatch = watchMoveAction(hooks);
  const { ui, stepId, isSettled, isRunning, showCoach } = hooks;
  if (
    stepId !== "setEnergy" &&
    stepId !== "pressSend" &&
    stepId !== "clickNearby"
  )
    return stopWatch;
  const sourceId = moveSourcePlanet(ui)?.locationId;
  let recovering = false;
  const timer = window.setInterval(() => {
    if (document.hidden || isSettled() || isRunning()) return;
    const ready = restoreGuideMoveSelection(
      ui,
      sourceId,
      () =>
        guideControlPoint(stepId === "setEnergy" ? "energy-slider" : "send") !==
        null
    );
    if (!ready) {
      recovering = true;
      showCoach(
        "Restoring your planet panel. Wait for the controls to appear."
      );
    } else if (recovering) {
      recovering = false;
      showCoach(null);
    }
    if (ready && stepId === "clickNearby" && !ui.isSendingForces()) {
      const from = moveSourcePlanet(ui);
      if (from) armSend(ui, from);
    }
  }, 250);
  return () => {
    window.clearInterval(timer);
    stopWatch();
  };
}

function watchMoveAction(hooks: WatchHooks): () => void {
  const { ui, stepId, finish, reject, notify, isSettled } = hooks;

  if (stepId === "selectMovePlanet") {
    let ready = false;
    const sub = ui.selectedPlanetId$.subscribe((id) => {
      if (!ready || !id) return;
      const planet = ui.getPlanetWithId(id);
      if (
        planet &&
        isLocatable(planet) &&
        ui.isOwnedByMe(planet) &&
        planet.energy > 1
      ) {
        finish();
        return;
      }
      if (!isSettled())
        notify("Select one of your planets that still has energy.");
    });
    ready = true;
    return () => sub.unsubscribe();
  }

  if (stepId === "setEnergy") {
    const sourceId = moveSourcePlanet(ui)?.locationId;
    let lastPercent = SLIDER_ASIDE;
    const sub = ui
      .getGameManager()
      .getGameObjects()
      .planetUpdated$.subscribe((id) => {
        if (hooks.isDemonstrating()) return;
        const selected = ui.getSelectedPlanet();
        if (!selected || id !== selected.locationId || id !== sourceId) return;
        const percent = ui.getForcesSending(id);
        if (percent === lastPercent) return;
        lastPercent = percent;
        const from = moveSourcePlanet(ui);
        if (from && canReachNearbyPlanet(ui, from, percent)) {
          finish();
          return;
        }
        if (!isSettled()) {
          notify(
            "That is not enough energy to reach a nearby planet. Increase the slider."
          );
        }
      });
    return () => sub.unsubscribe();
  }

  if (stepId === "pressSend") {
    let ready = false;
    const sub = ui.isSending$.subscribe((sending) => {
      if (!ready || !sending) return;
      finish();
    });
    ready = true;
    return () => sub.unsubscribe();
  }

  if (stepId !== "clickNearby") return () => {};

  const from = moveSourcePlanet(ui);
  const sourceId = from?.locationId;
  return watchGuideMove(
    sourceId,
    () => {
      if (isSettled()) return;
      finish();
    },
    () => {
      if (!isSettled())
        reject("The move could not start. Check the terminal, then try again.");
    }
  );
}

async function assistMove(hooks: AssistHooks): Promise<void> {
  const { ui, stepId, finish, isCurrent } = hooks;
  if (stepId === "selectMovePlanet") {
    const from = ui.getPlanetWithCoords(hooks.mapTarget);
    if (
      !from ||
      !isLocatable(from) ||
      !ui.isOwnedByMe(from) ||
      from.energy <= 1
    )
      throw new Error("Your planet is not on the map yet.");
    ui.setSelectedPlanet(from);
    finish();
    return;
  }
  if (stepId === "setEnergy") {
    const from = moveSourcePlanet(ui);
    if (!from) throw new Error("Your planet is not on the map yet.");
    const percent = sufficientSendPercent(ui, from);
    if (percent === undefined)
      throw new Error("No nearby planet can be reached from here.");
    ui.setSelectedPlanet(from);
    ui.setForcesSending(from.locationId, percent);
    finish();
    return;
  }
  if (stepId === "pressSend") {
    const from = moveSourcePlanet(ui);
    if (!from) throw new Error("Your planet is not on the map yet.");
    if (ui.getSelectedPlanet()?.locationId !== from.locationId) {
      ui.setSelectedPlanet(from);
    }
    if (ui.getForcesSending(from.locationId) === SLIDER_ASIDE) {
      ui.setForcesSending(from.locationId, SEND_PERCENT);
    }
    armSend(ui, from);
    return;
  }
  if (stepId !== "clickNearby") return;

  const from = moveSourcePlanet(ui);
  if (!from) throw new Error("Your planet is not on the map yet.");
  const percent = ui.getForcesSending(from.locationId);
  const sending = percent === SLIDER_ASIDE ? SEND_PERCENT : percent;
  if (sending !== percent) ui.setForcesSending(from.locationId, sending);
  const target = ui.getPlanetWithCoords(hooks.mapTarget);
  if (
    !target ||
    !isLocatable(target) ||
    target.destroyed ||
    target.locationId === from.locationId
  )
    throw new Error("No planet in range from here.");
  if (
    ui.getSelectedPlanet()?.locationId !== from.locationId ||
    !ui.isSendingForces()
  ) {
    ui.setSelectedPlanet(from);
    armSend(ui, from);
  }
  await sendGuideFleet(ui, from, target);
  if (!isCurrent()) return;
}

export const movePage: GuidePage = {
  id: "move",
  steps: chapterSteps("move"),
  copy,
  Intro: MoveIntro,
  open: openMove,
  watch: watchMove,
  assist: assistMove,
};
