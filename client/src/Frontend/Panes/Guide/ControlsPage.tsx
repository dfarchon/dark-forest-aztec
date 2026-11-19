import React from "react";

import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import { chapterSteps } from "./guideChapters";
import type { GuidePage } from "./guideTypes";
function ControlsIntro() {
  return (
    <p>
      Pause or resume the explorer from the bottom-left controls. Hide the
      terminal's read-only log on the right when you want more map space. Use
      the far-right edge: hover in Edge mode, or click the arrow in Bar mode.
      Settings → Terminal lets you choose the mode.
    </p>
  );
}

export const controlsPage: GuidePage = {
  id: "controls",
  steps: chapterSteps("controls"),
  copy: {
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
      hint: "Hover over the far-right edge in Edge mode, or click the arrow in Bar mode, to hide the terminal. Settings → Terminal selects the mode.",
      button: "Hide the terminal",
      running: "Hiding the terminal.",
      done: "Terminal hidden. You can reopen it any time.",
    },
  },
  Intro: ControlsIntro,
  open: (ui, step) => {
    if (step === "pauseExplorer") ui.startExplore();
    if (step === "hideTerminal")
      UIEmitter.getInstance().emit(UIEmitterEvent.SetTerminalVisible, true);
  },
  watch: ({ stepId, finish }) => {
    const emitter = UIEmitter.getInstance();
    if (stepId === "hideTerminal") {
      const changed = (visible: boolean) => {
        if (!visible) finish();
      };
      emitter.on(UIEmitterEvent.TerminalVisibilityChanged, changed);
      return () => {
        emitter.removeListener(
          UIEmitterEvent.TerminalVisibilityChanged,
          changed
        );
      };
    }
    const changed = (mining: boolean) => {
      if (mining === (stepId === "resumeExplorer")) finish();
    };
    emitter.on(UIEmitterEvent.ExplorerChanged, changed);
    return () => {
      emitter.removeListener(UIEmitterEvent.ExplorerChanged, changed);
    };
  },
  assist: async ({ ui, stepId }) => {
    if (stepId === "pauseExplorer") ui.stopExplore();
    if (stepId === "resumeExplorer") ui.startExplore();
    if (stepId === "hideTerminal")
      UIEmitter.getInstance().emit(UIEmitterEvent.SetTerminalVisible, false);
  },
};
