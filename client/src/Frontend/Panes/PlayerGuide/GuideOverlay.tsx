import React from "react";

import { moveHaloPlanets } from "./guideEnergy";
import { GuideMouse } from "./GuideMouse";
import { sourcePlanet } from "./guidePlanets";
import { GuideScrollWheel } from "./GuideScrollWheel";
import { guideShipLesson } from "./guideShip";
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
      {page === "planet" && stepId === "selectPlanet" && (
        <PlanetHalo
          ui={uiManager}
          planets={() => {
            const planet = sourcePlanet(uiManager);
            return planet ? [planet] : [];
          }}
        />
      )}
      {(stepId === "selectMovePlanet" ||
        stepId === "clickNearby" ||
        stepId === "moveShip" ||
        stepId === "selectShipPlanet") && (
        <PlanetHalo
          ui={uiManager}
          planets={() => {
            if (stepId === "moveShip" || stepId === "selectShipPlanet") {
              const move = guideShipLesson(uiManager);
              return move
                ? [stepId === "selectShipPlanet" ? move.from : move.to]
                : [];
            }
            return moveHaloPlanets(uiManager, stepId);
          }}
        />
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
            planets={() => {
              if (page === "planet" && stepId === "selectPlanet") {
                const planet = sourcePlanet(uiManager);
                return planet ? [planet] : [];
              }
              if (
                stepId === "selectMovePlanet" ||
                stepId === "clickNearby" ||
                stepId === "moveShip" ||
                stepId === "selectShipPlanet"
              ) {
                if (stepId === "moveShip" || stepId === "selectShipPlanet") {
                  const move = guideShipLesson(uiManager);
                  return move
                    ? [stepId === "selectShipPlanet" ? move.from : move.to]
                    : [];
                }
                return moveHaloPlanets(uiManager, stepId);
              }
              return [];
            }}
            darkPatch={() => findOnScreenDarkPatch(uiManager)}
          />
        )}
    </>
  );
}
