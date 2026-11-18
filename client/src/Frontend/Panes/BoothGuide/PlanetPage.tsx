import React from "react";

import GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import { chapterSteps } from "./guideChapters";
import {
  applyGuideManualZoom,
  guideZoomInCenter,
  guideZoomOutCenter,
} from "./guideManualZoom";
import { sourcePlanet } from "./guidePlanets";
import type {
  AssistHooks,
  GuidePage,
  StepCopy,
  StepId,
  WatchHooks,
} from "./guideTypes";
import {
  approachPlanetFrame,
  focusHome,
  planetNearCenter,
  scrolledOutFully,
  universeFrame,
  universeOnScreen,
} from "./guideWorld";

const ZOOM_MAXED =
  "This is as far as the screen zooms out. Use 'Show the whole universe' to center the map.";
const SELECT_MISS =
  "That planet does not count. Click one you own that still has energy.";

const copy: Record<"zoom" | "zoomIn" | "selectPlanet", StepCopy> = {
  zoom: {
    label: "Scroll until the whole universe is on screen",
    hint: "Scroll down to see the whole universe. The view gradually moves toward the universe center as you zoom out.",
    button: "Show the whole universe",
    assistLead: "Want the full view now:",
    running: "Opening the view to the whole universe.",
    done: "This is the whole universe.",
  },
  zoomIn: {
    label: "Zoom in until your planets fill the screen",
    hint: "Scroll up until the screen mostly shows your planet. The view gradually moves toward it as you zoom in.",
    button: "Zoom to my planet",
    assistLead: "We can bring it to the center:",
    running: "Bringing your planet to the center.",
    done: "Your planets fill the screen.",
  },
  selectPlanet: {
    label: "Select one of your planets that has energy",
    hint: "Left-click the planet with the pink ring.",
    button: "Select my planet",
    assistLead: "We can select it for you:",
    running: "Selecting a planet of yours that has energy.",
    done: "That planet is yours, and it has energy.",
  },
};

function PlanetIntro() {
  return (
    <p>
      See how big the universe is, then find your home planet in the nebula.
      Select it to see its energy, resources and available actions.
    </p>
  );
}

function openPlanet(ui: GameUIManager, step: StepId): void {
  if (step === "zoom") focusHome(ui);
  if (step === "zoomIn") {
    const viewport = Viewport.getInstance();
    viewport.momentum = false;
    viewport.velocity = undefined;
  }
}

function watchPlanet(hooks: WatchHooks): () => void {
  const {
    ui,
    stepId,
    finish,
    notify,
    showCoach,
    releaseTour,
    stopTour,
    isSettled,
    isRunning,
  } = hooks;
  const uiEmitter = UIEmitter.getInstance();

  if (stepId === "zoom") {
    const viewport = Viewport.getInstance();
    let widthBeforeScroll = viewport.widthInWorldUnits;
    let centerBeforeScroll = viewport.getViewportPosition();
    let start: { width: number; center: typeof centerBeforeScroll } | undefined;
    const resetPath = () => {
      start = undefined;
    };
    const beforeScroll = () => {
      widthBeforeScroll = viewport.widthInWorldUnits;
      centerBeforeScroll = viewport.getViewportPosition();
    };
    const settleIfSeen = () => {
      const center = viewport.getViewportPosition();
      if (center.x !== 0 || center.y !== 0) return false;
      if (!universeOnScreen(ui)) return false;
      stopTour();
      finish();
      return true;
    };
    const coachNow = () => {
      showCoach(
        !universeOnScreen(ui) && scrolledOutFully() ? ZOOM_MAXED : null
      );
    };
    const onScroll = (delta: number) => {
      if (isSettled()) return;
      if (!start || isRunning())
        start = { width: widthBeforeScroll, center: { ...centerBeforeScroll } };
      const initial = start;
      applyGuideManualZoom(viewport, widthBeforeScroll, delta, (width) =>
        guideZoomOutCenter(initial, width, viewport.maxWorldWidth)
      );
      if (settleIfSeen()) return;
      coachNow();
      releaseTour();
    };
    const onUp = () => {
      if (isSettled() || isRunning()) return;
      if (settleIfSeen()) return;
      coachNow();
    };
    coachNow();
    uiEmitter.prependListener(UIEmitterEvent.CanvasScroll, beforeScroll);
    uiEmitter.on(UIEmitterEvent.CanvasMouseDown, resetPath);
    uiEmitter.on(UIEmitterEvent.CanvasScroll, onScroll);
    uiEmitter.on(UIEmitterEvent.WorldMouseUp, onUp);
    return () => {
      uiEmitter.removeListener(UIEmitterEvent.CanvasScroll, beforeScroll);
      uiEmitter.removeListener(UIEmitterEvent.CanvasMouseDown, resetPath);
      uiEmitter.removeListener(UIEmitterEvent.CanvasScroll, onScroll);
      uiEmitter.removeListener(UIEmitterEvent.WorldMouseUp, onUp);
    };
  }

  if (stepId === "zoomIn") {
    const viewport = Viewport.getInstance();
    let widthBeforeScroll = viewport.widthInWorldUnits;
    let centerBeforeScroll = viewport.getViewportPosition();
    let start: { width: number; center: typeof centerBeforeScroll } | undefined;
    const resetPath = () => {
      start = undefined;
    };
    const beforeScroll = () => {
      widthBeforeScroll = viewport.widthInWorldUnits;
      centerBeforeScroll = viewport.getViewportPosition();
    };
    const target = approachPlanetFrame(ui);
    const settleIfCentered = () => {
      const center = viewport.getViewportPosition();
      if (center.x !== target.center.x || center.y !== target.center.y)
        return false;
      if (!planetNearCenter(ui)) return false;
      finish();
      return true;
    };
    const onScroll = (delta: number) => {
      if (isSettled() || isRunning()) return;
      start ??= { width: widthBeforeScroll, center: { ...centerBeforeScroll } };
      const initial = start;
      applyGuideManualZoom(viewport, widthBeforeScroll, delta, (width) =>
        guideZoomInCenter(initial, width, target.width, target.center)
      );
      settleIfCentered();
    };
    const onUp = () => {
      if (isSettled() || isRunning()) return;
      settleIfCentered();
    };
    uiEmitter.prependListener(UIEmitterEvent.CanvasScroll, beforeScroll);
    uiEmitter.on(UIEmitterEvent.CanvasMouseDown, resetPath);
    uiEmitter.on(UIEmitterEvent.CanvasScroll, onScroll);
    uiEmitter.on(UIEmitterEvent.WorldMouseUp, onUp);
    return () => {
      uiEmitter.removeListener(UIEmitterEvent.CanvasScroll, beforeScroll);
      uiEmitter.removeListener(UIEmitterEvent.CanvasMouseDown, resetPath);
      uiEmitter.removeListener(UIEmitterEvent.CanvasScroll, onScroll);
      uiEmitter.removeListener(UIEmitterEvent.WorldMouseUp, onUp);
    };
  }

  if (stepId === "selectPlanet") {
    let ready = false;
    const sub = ui.selectedPlanetId$.subscribe((id) => {
      if (!ready || !id) return;
      const planet = ui.getPlanetWithId(id);
      if (planet && ui.isOwnedByMe(planet) && planet.energy > 0) {
        finish();
        return;
      }
      if (isSettled()) return;
      notify(SELECT_MISS);
    });
    ready = true;
    return () => sub.unsubscribe();
  }

  return () => {};
}

async function assistPlanet(hooks: AssistHooks): Promise<void> {
  const { ui, stepId, finish, isDone, playReveal, playApproach } = hooks;
  if (stepId === "zoom") {
    playReveal(universeFrame(ui, Viewport.getInstance()), finish);
    return;
  }
  if (stepId === "zoomIn") {
    playApproach(approachPlanetFrame(ui), finish);
    return;
  }
  if (stepId !== "selectPlanet") return;
  const planet = sourcePlanet(ui);
  if (!planet) throw new Error("Your planet is not on the map yet.");
  ui.setSelectedPlanet(planet);
  ui.centerPlanet(planet);
  if (isDone()) return;
  if (!ui.isOwnedByMe(planet) || planet.energy <= 0) {
    throw new Error("Click a planet you own that still has energy.");
  }
}

export const planetPage: GuidePage = {
  id: "planet",
  steps: chapterSteps("planet"),
  copy,
  Intro: PlanetIntro,
  open: openPlanet,
  watch: watchPlanet,
  assist: assistPlanet,
};
