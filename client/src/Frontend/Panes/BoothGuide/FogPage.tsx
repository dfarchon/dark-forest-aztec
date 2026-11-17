import { CursorState, ModalManagerEvent, WorldCoords } from "@dfpunk/types";
import React from "react";

import GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import type {
  AssistHooks,
  GuidePage,
  StepCopy,
  StepId,
  WatchHooks,
} from "./BoothGuidePane";
import { sourcePlanet } from "./BoothGuidePane";
import { findOnScreenDarkPatch } from "./BoothGuidePane";
import { chapterSteps } from "./guideChapters";
import {
  confirmGuideFogMove,
  fogChunkCenter,
  guideFogTarget,
  isGuideFogDestination,
} from "./guideFog";

const copy: Record<
  | "deselect"
  | "pressExplore"
  | "clickDark"
  | "pauseExplorer"
  | "resumeExplorer"
  | "hideTerminal",
  StepCopy
> = {
  deselect: {
    label: "Click empty space to deselect",
    hint: "Click empty space on the map. This clears the selected planet and reveals explorer controls.",
    button: "Deselect my planet",
    running: "Clearing the selection.",
    done: "Nothing is selected. Explorer controls are available.",
  },
  pauseExplorer: {
    label: "Pause your explorer",
    hint: "Click Pause in the bottom-left explorer controls.",
    button: "Pause the explorer",
    running: "Pausing exploration.",
    done: "Exploration is paused. Your discovered map is kept.",
  },
  resumeExplorer: {
    label: "Resume exploring",
    hint: "Click Explore in the same controls to continue uncovering the map.",
    button: "Resume exploration",
    running: "Resuming exploration.",
    done: "Your explorer is running again.",
  },
  hideTerminal: {
    label: "Hide the terminal",
    hint: "Click the terminal icon at the far-right edge to hide or reopen the log. Edge mode also supports hovering over the edge. Settings → Terminal selects the mode.",
    button: "Hide the terminal",
    running: "Hiding the terminal.",
    done: "Terminal hidden. You can reopen it any time.",
  },
  pressExplore: {
    label: "Press Move on the bottom-left explorer",
    hint: "With nothing selected, press Move on the explorer at the bottom left.",
    button: "Press Move",
    assistLead: "We can arm the explorer:",
    running: "Arming the explorer.",
    done: "Move is armed. The next click chooses where to explore.",
  },
  clickDark: {
    label: "Click a dark patch of the map",
    hint: "Click a dark patch on the screen. The white explorer target moves there, and mining continues from that spot. Coordinates stay hidden until you find them yourself.",
    button: "Mine somewhere else",
    assistLead: "We can mine somewhere else on screen:",
    running: "Moving the explorer to another dark patch on screen.",
    done: "Great, you did it. The explorer is mining that dark patch.",
  },
};

function FogIntro() {
  return (
    <p>
      Gray areas are unexplored. Choose a dark patch as the explorer's next
      target; its coordinates and planets stay hidden until you discover them.
    </p>
  );
}

function openFog(ui: GameUIManager, step: StepId): void {
  if (step === "deselect") {
    const planet = sourcePlanet(ui);
    if (planet) ui.setSelectedPlanet(planet);
    return;
  }
  if (step === "pauseExplorer") {
    ui.startExplore();
    return;
  }
  if (step === "hideTerminal") {
    UIEmitter.getInstance().emit(UIEmitterEvent.SetTerminalVisible, true);
    return;
  }
  if (step !== "clickDark") return;
  guideFogTarget(ui).reset();
  ui.getModalManager().setCursorState(CursorState.TargetingExplorer);
}

function watchFog(hooks: WatchHooks): () => void {
  const { ui, stepId, finish } = hooks;
  const modal = ui.getModalManager();

  if (stepId === "deselect") {
    let ready = false;
    const sub = ui.selectedPlanetId$.subscribe((id) => {
      if (ready && !id) finish();
    });
    ready = true;
    return () => sub.unsubscribe();
  }
  const emitter = UIEmitter.getInstance();
  if (stepId === "pauseExplorer" || stepId === "resumeExplorer") {
    const changed = (mining: boolean) => {
      if (mining === (stepId === "resumeExplorer")) finish();
    };
    emitter.on(UIEmitterEvent.ExplorerChanged, changed);
    return () => {
      emitter.removeListener(UIEmitterEvent.ExplorerChanged, changed);
    };
  }
  if (stepId === "hideTerminal") {
    const changed = (visible: boolean) => {
      if (!visible) finish();
    };
    emitter.on(UIEmitterEvent.TerminalVisibilityChanged, changed);
    return () => {
      emitter.removeListener(UIEmitterEvent.TerminalVisibilityChanged, changed);
    };
  }
  if (stepId === "pressExplore") {
    const onCursor = (state: CursorState) => {
      if (state === CursorState.TargetingExplorer) finish();
    };
    modal.on(ModalManagerEvent.StateChanged, onCursor);
    return () => modal.removeListener(ModalManagerEvent.StateChanged, onCursor);
  }

  if (stepId !== "clickDark") return () => {};

  const pattern = ui.getMiningPattern();
  const previous = pattern ? fogChunkCenter(pattern.fromChunk) : undefined;
  let active = true;
  let attempt = 0;
  const onTarget = (coords: WorldCoords) => {
    const currentAttempt = ++attempt;
    const unexplored = Boolean(
      coords && isGuideFogDestination(ui, coords, previous)
    );
    queueMicrotask(() => {
      if (!active || hooks.isSettled() || currentAttempt !== attempt) return;
      try {
        if (unexplored && confirmGuideFogMove(ui, coords)) {
          finish();
          return;
        }
        hooks.reject(
          unexplored
            ? "The explorer did not start at that target. Try again."
            : "Choose an unexplored patch different from your explorer's previous target."
        );
      } catch (error) {
        hooks.reject(
          error instanceof Error
            ? error.message
            : "Could not start the explorer. Try again."
        );
      }
      modal.setCursorState(CursorState.TargetingExplorer);
    });
  };
  modal.on(ModalManagerEvent.MiningCoordsUpdate, onTarget);
  return () => {
    active = false;
    modal.removeListener(ModalManagerEvent.MiningCoordsUpdate, onTarget);
  };
}

async function assistFog(hooks: AssistHooks): Promise<void> {
  const { ui, stepId } = hooks;
  if (stepId === "deselect") {
    ui.setSelectedPlanet(undefined);
    return;
  }
  if (stepId === "pauseExplorer") {
    ui.stopExplore();
    return;
  }
  if (stepId === "resumeExplorer") {
    ui.startExplore();
    return;
  }
  if (stepId === "hideTerminal") {
    UIEmitter.getInstance().emit(UIEmitterEvent.SetTerminalVisible, false);
    return;
  }
  if (stepId === "pressExplore") {
    ui.getModalManager().setCursorState(CursorState.TargetingExplorer);
    return;
  }
  if (stepId !== "clickDark") return;
  const coords = findOnScreenDarkPatch(ui);
  if (!coords)
    throw new Error(
      "No unexplored patch is visible. Zoom out or pan toward the edge of the explored map, then try again."
    );
  const modal = ui.getModalManager();
  modal.setCursorState(CursorState.TargetingExplorer);
  modal.acceptInputForTarget({
    x: Math.floor(coords.x),
    y: Math.floor(coords.y),
  });
}

export const fogPage: GuidePage = {
  id: "fog",
  steps: chapterSteps("fog"),
  copy,
  Intro: FogIntro,
  open: openFog,
  watch: watchFog,
  assist: assistFog,
};
