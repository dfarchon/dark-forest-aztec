import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDE_CHAPTERS,
  PAGE_ORDER,
  chapterSteps,
  following,
  isPageFinale,
} from "../src/Frontend/Panes/BoothGuide/guideChapters";

test("chapters preserve every existing exercise once and keep the original page workload", () => {
  const steps = GUIDE_CHAPTERS.flatMap((chapter) => [...chapter.steps]);
  assert.equal(new Set(steps).size, steps.length);
  assert.ok(
    GUIDE_CHAPTERS.every(
      (chapter) =>
        chapter.steps.length >= 2 &&
        chapter.steps.length <= (chapter.id === "ships" ? 5 : 4)
    )
  );
  assert.deepEqual(
    new Set(steps),
    new Set([
      "zoom",
      "zoomIn",
      "selectPlanet",
      "selectMovePlanet",
      "setEnergy",
      "pressSend",
      "clickNearby",
      "selectShipPlanet",
      "selectShip",
      "pressShipSend",
      "moveShip",
      "deselect",
      "pressExplore",
      "clickDark",
      "pauseExplorer",
      "resumeExplorer",
      "hideTerminal",
      "readScoring",
      "accountSafety",
    ])
  );
});

test("every chapter advances to the next and completion happens after the final lesson", () => {
  for (const chapter of GUIDE_CHAPTERS) {
    const steps = chapterSteps(chapter.id);
    for (let i = 0; i < steps.length - 1; i++) {
      assert.equal(isPageFinale(chapter.id, steps[i]), false);
      assert.deepEqual(following(chapter.id, steps[i]), {
        page: chapter.id,
        step: steps[i + 1],
      });
    }
    const last = steps[steps.length - 1];
    assert.equal(isPageFinale(chapter.id, last), true);
    const next = PAGE_ORDER[PAGE_ORDER.indexOf(chapter.id) + 1];
    assert.deepEqual(following(chapter.id, last), {
      page: next,
      step: chapterSteps(next)[0] ?? null,
    });
  }
  assert.deepEqual(following("controls", "hideTerminal"), {
    page: "review",
    step: "readScoring",
  });
  assert.deepEqual(following("review", "accountSafety"), {
    page: "play",
    step: null,
  });
});

test("ship and explorer exercises keep their own chapter transition and final delay", () => {
  assert.deepEqual(following("move", "clickNearby"), {
    page: "ships",
    step: "selectShipPlanet",
  });
  assert.equal(isPageFinale("ships", "moveShip"), false);
  assert.deepEqual(following("ships", "deselect"), {
    page: "fog",
    step: "pressExplore",
  });
  assert.equal(isPageFinale("fog", "clickDark"), true);
  assert.deepEqual(following("fog", "clickDark"), {
    page: "controls",
    step: "pauseExplorer",
  });
});
