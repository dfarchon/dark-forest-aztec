import React from "react";

import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import { chapterSteps } from "./guideChapters";
import type { GuidePage } from "./guideTypes";

function ReviewIntro() {
  return (
    <p>
      Score points to win this round. Your browser also stores account and map
      data; keep personal credentials safe.
    </p>
  );
}

export const reviewPage: GuidePage = {
  id: "review",
  steps: chapterSteps("review"),
  copy: {
    readScoring: {
      label: "Learn how to score and win",
      hint: "Click Score at the top left to open Help's scoring section. Find artifacts with your Gear ship or withdraw silver through Spacetime Rips to earn points. Rarer artifacts score more; the highest final score wins.",
      button: "I understand scoring",
      assistLead: "Read the scoring rules, then continue:",
      running: "Continuing.",
      done: "You know how to score and win.",
    },
    accountSafety: {
      label: "Keep personal accounts safe",
      hint: "This guide uses the same account as normal play. For a local wallet, export your keys and home coordinates from Settings before clearing browser storage. Never share that backup.",
      button: "I understand account safety",
      assistLead: "Read the account guidance, then continue:",
      running: "Finishing the guide.",
      done: "You are ready to play.",
    },
  },
  Intro: ReviewIntro,
  open: () => {},
  watch: ({ stepId, hidePointer }) => {
    if (stepId !== "readScoring") return () => {};
    const emitter = UIEmitter.getInstance();
    emitter.on(UIEmitterEvent.OpenScoringHelp, hidePointer);
    return () => {
      emitter.removeListener(UIEmitterEvent.OpenScoringHelp, hidePointer);
    };
  },
  assist: async ({ finish }) => {
    finish();
  },
};
