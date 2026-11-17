import React from "react";

import type { GuidePage } from "./BoothGuidePane";
import { fogPage } from "./FogPage";
import { chapterSteps } from "./guideChapters";

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
  ...fogPage,
  id: "controls",
  steps: chapterSteps("controls"),
  copy: {
    pauseExplorer: fogPage.copy.pauseExplorer,
    resumeExplorer: fogPage.copy.resumeExplorer,
    hideTerminal: fogPage.copy.hideTerminal,
  },
  Intro: ControlsIntro,
};
