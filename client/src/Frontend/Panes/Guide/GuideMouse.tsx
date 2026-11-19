import { type LocatablePlanet, Setting, type WorldCoords } from "@dfpunk/types";
import React, { useEffect, useRef } from "react";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import type { PageId, StepId } from "./guideChapters";
import { findDeselectPoint } from "./guideDeselect";
import { targetElement } from "./guideElements";
import { guideEnergyTarget } from "./guideEnergy";
import { guidePlanetPoint, guideWorldPoint } from "./guideMapPoint";
import { GuidePointer } from "./GuidePointer";
import type {
  GuidePoint as Point,
  GuidePointerPose as Pose,
} from "./guidePointerMotion";
import type { GuidePointerSequence } from "./guidePointerSequence";
import {
  guideControlPoint as controlPoint,
  guidePlanetControlPoint,
  guidePointerOrigin,
  guideSliderPose,
} from "./guidePointerTargets";
import { guideShipLesson } from "./guideShip";
import { terminalGuide } from "./guideTerminal";

export type GuideMouseProps = {
  assist?: { id: number; onComplete: (mapTarget?: WorldCoords) => void };
  sequence: GuidePointerSequence;
  entry: number;
  ui: GameUIManager;
  page: PageId;
  stepId: StepId;
  panelRef: { readonly current: HTMLElement | null };
  planets: () => LocatablePlanet[];
  darkPatch: () => WorldCoords | undefined;
};

function tryViewport(): Viewport | undefined {
  try {
    return Viewport.getInstance();
  } catch {
    return undefined;
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function resolvePose(
  props: GuideMouseProps,
  darkWorld: WorldCoords | undefined
): Pose {
  if (
    props.page === "cover" ||
    props.page === "play" ||
    (props.page === "review" && props.stepId !== "readScoring")
  )
    return { kind: "hide" };
  switch (props.stepId) {
    case "selectPlanet":
    case "selectMovePlanet":
    case "selectShipPlanet":
    case "moveShip":
    case "clickNearby": {
      if (props.stepId === "moveShip") {
        const move = guideShipLesson(props.ui);
        if (
          !move ||
          props.ui.getSelectedPlanet()?.locationId !== move.from.locationId ||
          props.ui.getArtifactSending(move.from.locationId)?.id !==
            move.ship.id ||
          !props.ui.isSendingForces()
        )
          return { kind: "hide" };
      }
      const planet = props.planets()[0];
      const at = planet && guidePlanetPoint(props.ui, planet);
      return at
        ? { kind: "click", at, mapTarget: planet.location.coords }
        : { kind: "hide" };
    }
    case "pressSend": {
      const at = controlPoint("send");
      return at ? { kind: "click", at } : { kind: "hide" };
    }
    case "selectShip":
    case "pressShipSend": {
      const move = guideShipLesson(props.ui);
      if (
        !move ||
        props.ui.getSelectedPlanet()?.locationId !== move.from.locationId
      )
        return { kind: "hide" };
      if (
        props.stepId === "pressShipSend" &&
        props.ui.getArtifactSending(move.from.locationId)?.id !== move.ship.id
      )
        return { kind: "hide" };
      const at = guidePlanetControlPoint(
        props.stepId === "selectShip" ? `ship-${move.ship.id}` : "send",
        move.from.locationId
      );
      return at ? { kind: "click", at } : { kind: "hide" };
    }
    case "readScoring": {
      const at = controlPoint("score");
      return at ? { kind: "click", at } : { kind: "hide" };
    }
    case "pauseExplorer":
    case "resumeExplorer": {
      const at = controlPoint("explore-toggle");
      return at ? { kind: "click", at } : { kind: "hide" };
    }
    case "hideTerminal": {
      const terminal = terminalGuide(
        props.ui.getStringSetting(Setting.TerminalReveal)
      );
      const at = controlPoint(terminal.target);
      return at ? { kind: terminal.gesture, at } : { kind: "hide" };
    }
    case "pressExplore": {
      const at = controlPoint("explore-move");
      return at ? { kind: "click", at } : { kind: "hide" };
    }
    case "clickDark": {
      if (!darkWorld) return { kind: "hide" };
      const at = guideWorldPoint(darkWorld);
      return at
        ? { kind: "click", at, mapTarget: darkWorld }
        : { kind: "hide" };
    }
    default:
      return { kind: "hide" };
  }
}

export function GuideMouse(props: GuideMouseProps) {
  const terminal = terminalGuide(
    props.ui.getStringSetting(Setting.TerminalReveal)
  );
  useEffect(() => {
    if (props.stepId !== "hideTerminal") return;
    const element = targetElement(terminal.target);
    element?.setAttribute("data-guide-active", "true");
    return () => {
      element?.removeAttribute("data-guide-active");
    };
  }, [props.stepId, terminal.target]);
  const goal = useRef<{ key: string; value?: number }>({ key: "" });
  const deselectPoint = useRef<Point>();
  const energy = useRef<{
    planet: NonNullable<ReturnType<GameUIManager["getSelectedPlanet"]>>;
    from: number;
    to: number;
  }>();
  const motionKey = `${props.page}:${props.stepId}:${props.entry}:${props.assist?.id ?? "hint"}`;
  return (
    <GuidePointer
      animationKey={motionKey}
      origin={() =>
        props.sequence.origin(
          `${props.page}:${props.stepId}${props.assist ? `:assist:${props.assist.id}` : ""}`,
          guidePointerOrigin(props.panelRef.current, props.stepId),
          window.innerWidth,
          window.innerHeight
        )
      }
      onEndpoint={(point) => props.sequence.remember(point)}
      onComplete={props.assist?.onComplete}
      onFrame={(frame) => {
        const drag = energy.current;
        if (
          props.assist &&
          drag &&
          frame.gesture === "drag" &&
          frame.dragProgress !== undefined
        ) {
          const value = Math.round(
            drag.from + (drag.to - drag.from) * frame.dragProgress
          );
          if (props.ui.getForcesSending(drag.planet.locationId) !== value)
            props.ui.setForcesSending(drag.planet.locationId, value);
        }
      }}
      pose={() => {
        if (props.stepId === "deselect") {
          const viewport = tryViewport();
          const at =
            viewport &&
            findDeselectPoint(props.ui, viewport, deselectPoint.current);
          deselectPoint.current = at;
          return at ? { kind: "click", at } : { kind: "hide" };
        }
        const now = performance.now();
        if (props.stepId === "setEnergy") {
          const selected = props.ui.getSelectedPlanet();
          if (
            !selected ||
            !props.ui.isOwnedByMe(selected) ||
            selected.destroyed ||
            props.ui.isSendingShip(selected.locationId)
          )
            return { kind: "hide" };
          const key = `${props.stepId}:${selected.locationId}:${Math.floor(now / 1000)}`;
          if (goal.current.key !== key)
            goal.current = { key, value: guideEnergyTarget(props.ui) };
          if (props.assist && goal.current.value !== undefined) {
            energy.current ??= {
              planet: selected,
              from: props.ui.getForcesSending(selected.locationId),
              to: goal.current.value,
            };
            return guideSliderPose(
              "energy-slider",
              energy.current.from,
              energy.current.to
            );
          }
          return goal.current.value === undefined
            ? { kind: "hide" }
            : guideSliderPose(
                "energy-slider",
                props.ui.getForcesSending(selected.locationId),
                goal.current.value
              );
        }
        return resolvePose(
          props,
          props.stepId === "clickDark" ? safe(props.darkPatch) : undefined
        );
      }}
    />
  );
}
