import { type LocatablePlanet, Setting, type WorldCoords } from "@dfpunk/types";
import React, { useEffect, useRef } from "react";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import type { PageId, StepId } from "./guideChapters";
import { gameCanvas, targetElement } from "./guideElements";
import { guideEnergyTarget } from "./guideEnergy";
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

const CURSOR_W = 86;
const CURSOR_H = 99;

export type GuideMouseProps = {
  assist?: { id: number; onComplete: () => void };
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

function canvasRect(): DOMRect | null {
  const canvas = gameCanvas();
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return rect;
}

function worldToClient(world: WorldCoords): Point | null {
  const viewport = tryViewport();
  const canvas = gameCanvas();
  if (!viewport || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const local = viewport.worldToCanvasCoords(world);
  const scaleX = canvas.width > 0 ? rect.width / canvas.width : 1;
  const scaleY = canvas.height > 0 ? rect.height / canvas.height : 1;
  return { x: rect.left + local.x * scaleX, y: rect.top + local.y * scaleY };
}

function inside(rect: DOMRect, point: Point, slop = 0): boolean {
  return (
    point.x >= rect.left - slop &&
    point.x <= rect.right + slop &&
    point.y >= rect.top - slop &&
    point.y <= rect.bottom + slop
  );
}

function clampToRect(point: Point, rect: DOMRect, inset: number): Point {
  return {
    x: Math.min(rect.right - inset, Math.max(rect.left + inset, point.x)),
    y: Math.min(rect.bottom - inset, Math.max(rect.top + inset, point.y)),
  };
}

function overlapsPanel(
  panel: HTMLElement | null,
  x: number,
  y: number
): boolean {
  if (!panel) return false;
  const rect = panel.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  return (
    x < rect.right &&
    x + CURSOR_W > rect.left &&
    y < rect.bottom &&
    y + CURSOR_H > rect.top
  );
}

function scrollAnchor(panel: HTMLElement | null): Point | null {
  const rect = canvasRect();
  if (!rect) return null;
  const center = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  if (!overlapsPanel(panel, center.x, center.y)) return center;
  const panelRect = panel?.getBoundingClientRect();
  const candidates = panelRect
    ? [
        { x: panelRect.right + 28, y: center.y },
        { x: center.x, y: panelRect.bottom + 28 },
        { x: rect.left + rect.width * 0.72, y: rect.top + rect.height * 0.62 },
      ]
    : [];
  for (const candidate of candidates) {
    const clamped = clampToRect(candidate, rect, 48);
    if (inside(rect, clamped, 0) && !overlapsPanel(panel, clamped.x, clamped.y))
      return clamped;
  }
  return center;
}

function planetTip(ui: GameUIManager, planet: LocatablePlanet): Point | null {
  const viewport = tryViewport();
  const canvas = gameCanvas();
  const center = worldToClient(planet.location.coords);
  if (!viewport || !canvas || !center) return null;
  const rect = canvas.getBoundingClientRect();
  if (!inside(rect, center, 0)) return null;
  const rad = Math.max(ui.getRadiusOfPlanetLevel(planet.planetLevel), 1);
  const scale = canvas.width > 0 ? rect.width / canvas.width : 1;
  const screenRad = Math.max(viewport.worldToCanvasDist(rad) * scale, 10);
  return clampToRect(
    { x: center.x + screenRad * 0.7, y: center.y + screenRad * 0.7 },
    rect,
    8
  );
}

function pickOnScreenPlanet(
  planets: LocatablePlanet[],
  nearest: boolean
): LocatablePlanet | undefined {
  const rect = canvasRect();
  if (!rect) return undefined;
  const visible = planets.filter((planet) => {
    const point = worldToClient(planet.location.coords);
    return point ? inside(rect, point, 0) : false;
  });
  if (visible.length === 0) return undefined;
  if (!nearest || visible.length === 1) return visible[0];
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best = visible[0];
  let bestD = Infinity;
  for (const planet of visible) {
    const point = worldToClient(planet.location.coords);
    if (!point) continue;
    const dist = (point.x - cx) ** 2 + (point.y - cy) ** 2;
    if (dist < bestD) {
      bestD = dist;
      best = planet;
    }
  }
  return best;
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
  panel: HTMLElement | null,
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
      const planets = safe(() => props.planets()) ?? [];
      const planet = pickOnScreenPlanet(
        planets,
        props.stepId === "clickNearby"
      );
      if (!planet) return { kind: "hide" };
      const at = planetTip(props.ui, planet);
      return at ? { kind: "click", at } : { kind: "hide" };
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
    case "deselect": {
      const at = scrollAnchor(panel);
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
      const at = worldToClient(darkWorld);
      const rect = canvasRect();
      if (!at || !rect || !inside(rect, at, 0)) return { kind: "hide" };
      return { kind: "click", at };
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
          props.panelRef.current,
          props.stepId === "clickDark" ? safe(props.darkPatch) : undefined
        );
      }}
    />
  );
}
