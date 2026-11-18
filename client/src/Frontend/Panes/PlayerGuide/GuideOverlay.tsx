import React from "react";

import { GuideMouse } from "./GuideMouse";
import { GuideScrollWheel } from "./GuideScrollWheel";
import { findOnScreenDarkPatch } from "./guideWorld";
import { PlanetHalo } from "./PlanetHalo";
import type { GuideController } from "./useGuideController";
export function GuideOverlay({ controller }: { controller: GuideController }) {
  const {
    page,
    stepId,
    phase,
    panelRef,
    position,
    uiManager,
    entry,
    assistId,
    pointerSequence,
    pointerReadyEntry,
    onAssistComplete,
  } = controller;
  const planets = () => {
    const planet = controller.lessonPlanet();
    return planet ? [planet] : [];
  };
  return (
    <>
      {page === "planet" &&
        (phase === "waiting" || phase === "running") &&
        (stepId === "zoom" || stepId === "zoomIn") && (
          <GuideScrollWheel
            panelRef={panelRef}
            anchor={position}
            direction={stepId === "zoom" ? "down" : "up"}
          />
        )}
      {(stepId === "selectPlanet" ||
        stepId === "selectMovePlanet" ||
        stepId === "clickNearby" ||
        stepId === "moveShip" ||
        stepId === "selectShipPlanet") && (
        <PlanetHalo ui={uiManager} planets={planets} />
      )}
      {(phase === "waiting" || phase === "demonstrating") &&
        pointerReadyEntry === entry &&
        stepId &&
        (page !== "review" || stepId === "readScoring") &&
        stepId !== "zoom" &&
        stepId !== "zoomIn" && (
          <GuideMouse
            key={`${page}:${stepId}:${entry}:${assistId ?? "hint"}`}
            assist={
              assistId !== null
                ? {
                    id: assistId,
                    onComplete: onAssistComplete,
                  }
                : undefined
            }
            sequence={pointerSequence}
            entry={entry}
            ui={uiManager}
            page={page}
            stepId={stepId}
            panelRef={panelRef}
            planets={planets}
            darkPatch={() => findOnScreenDarkPatch(uiManager)}
          />
        )}
    </>
  );
}
