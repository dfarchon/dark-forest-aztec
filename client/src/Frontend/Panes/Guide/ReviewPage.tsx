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
      hint: "This is your real game account, stored in this browser. Download a backup of your secret key, salt, signing key, and home coordinates before you clear site data or switch browsers. Keep that file private. Anyone who has it can use this account.",
      button: "Continue",
      assistLead: "Download a private backup, then continue:",
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
