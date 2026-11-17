import { isLocatable } from "@dfpunk/gamelogic";
import {
  CursorState,
  LocatablePlanet,
  Planet,
  Setting,
  WorldCoords,
} from "@dfpunk/types";
import React, { useEffect, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import { SpiralPattern } from "../../../Backend/Miner/MiningPatterns";
import { Btn } from "../../Components/Btn";
import { Link } from "../../Components/CoreUI";
import Viewport from "../../Game/Viewport";
import dfstyles from "../../Styles/dfstyles";
import { useUIManager } from "../../Utils/AppHooks";
import { MIN_CHUNK_SIZE } from "../../Utils/constants";
import { useSetting } from "../../Utils/SettingsHooks";
import UIEmitter, { UIEmitterEvent } from "../../Utils/UIEmitter";
import { controlsPage } from "./ControlsPage";
import { fogPage } from "./FogPage";
import { GuideAssistGate, needsGuideMouse } from "./guideAssist";
import { type CameraMotion, playGuideCamera } from "./guideCamera";
import {
  chapterSteps,
  following,
  isPageFinale,
  isTask,
  PAGE_ORDER,
  type PageId,
  type StepId,
  TASK_ORDER,
  type TaskId,
} from "./guideChapters";
import {
  fogChunkCenter,
  guideFogTarget,
  guideMinerAnchor as minerAnchor,
  isGuideFogTarget,
  pickGuideFogTarget,
} from "./guideFog";
import { GuideMouse } from "./GuideMouse";
import { useGuidePanelPlacement } from "./guidePanelPlacement";
import { GuidePointerSequence } from "./guidePointerSequence";
import { GuideScrollWheel } from "./GuideScrollWheel";
import { guideShip, guideShipLesson } from "./guideShip";
import { terminalGuide } from "./guideTerminal";
import { guideMovePlanet, moveHaloPlanets, movePage } from "./MovePage";
import { PlanetHalo, planetPage } from "./PlanetPage";
import { reviewPage } from "./ReviewPage";
import { shipPage } from "./ShipPage";

const QUICK_ADVANCE_MS = 350;
const PAGE_HOLD_MS = 3000;
const PANEL_WIDTH = 320;
const PANEL_VISIBLE_MARGIN = 48;
const CLOSE_RADII = 28;
const HOME_REST_SPACINGS = 2;
const MINED_FRAME_PAD = 1.55;
export const SEND_PERCENT = 50;
export const SLIDER_ASIDE = 10;
const ZOOM_MAX_RATIO = 0.99;
const UNIVERSE_COVER = 0.8;
const DARK_SEARCH_LIMIT = 8000;
const ON_SCREEN_MIN_SHIFT = 0.12;
const FRAME_ZOOM_SLACK = 0.15;

export type { PageId, StepId, TaskId } from "./guideChapters";
type DockPhase = "waiting" | "demonstrating" | "running" | "done";

export type StepCopy = {
  label: string;
  hint: string;
  button: string;
  running: string;
  done: string;
  assistLead?: string;
};

export type ViewFrame = { center: WorldCoords; width: number };

export type WatchHooks = {
  ui: GameUIManager;
  stepId: StepId;
  finish: () => void;
  hidePointer: () => void;
  reject: (message: string) => void;
  notify: (message: string) => void;
  showCoach: (text: string | null) => void;
  releaseTour: () => void;
  stopTour: () => void;
  isSettled: () => boolean;
  isRunning: () => boolean;
  isDemonstrating: () => boolean;
};

export type AssistHooks = {
  ui: GameUIManager;
  stepId: StepId;
  finish: () => void;
  isDone: () => boolean;
  isCurrent: () => boolean;
  playTour: (target: ViewFrame, onDone: () => void) => void;
  playReveal: (target: ViewFrame, onDone: () => void) => void;
  playApproach: (target: ViewFrame, onDone: () => void) => void;
};

export type GuidePage = {
  id: TaskId;
  steps: readonly StepId[];
  copy: Partial<Record<StepId, StepCopy>>;
  Intro: () => JSX.Element;
  open: (ui: GameUIManager, step: StepId) => void;
  watch: (hooks: WatchHooks) => () => void;
  assist: (hooks: AssistHooks) => Promise<void>;
};

const TASK_PAGES: Record<TaskId, GuidePage> = {
  planet: planetPage,
  move: movePage,
  ships: shipPage,
  fog: fogPage,
  controls: controlsPage,
  review: reviewPage,
};

const STEPS = {
  ...planetPage.copy,
  ...movePage.copy,
  ...shipPage.copy,
  ...fogPage.copy,
  ...reviewPage.copy,
} as Record<StepId, StepCopy>;

function pageTitle(page: PageId): string {
  if (!isTask(page)) return page === "cover" ? "Visitor guide" : "You can play";
  return `Page ${TASK_ORDER.indexOf(page) + 1} / ${TASK_ORDER.length}`;
}

function stepsOf(page: PageId): readonly StepId[] {
  return chapterSteps(page);
}

function firstStep(page: PageId): StepId | null {
  return stepsOf(page)[0] ?? null;
}

function failMessage(error: unknown, fallback: string): string {
  if (
    error instanceof Error &&
    error.message.length > 0 &&
    error.message.length < 140
  ) {
    return error.message;
  }
  return fallback;
}

export function locatableHome(ui: GameUIManager): LocatablePlanet | undefined {
  const home = ui.getHomePlanet();
  return home && isLocatable(home) && ui.isOwnedByMe(home) && !home.destroyed
    ? home
    : undefined;
}

export function sourcePlanet(ui: GameUIManager): LocatablePlanet | undefined {
  const home = ui.getHomePlanet();
  if (
    home &&
    isLocatable(home) &&
    ui.isOwnedByMe(home) &&
    !home.destroyed &&
    home.energy > 1
  )
    return home;
  const owned = ui
    .getGameManager()
    .getMyPlanets()
    .filter(
      (planet): planet is LocatablePlanet =>
        isLocatable(planet) &&
        ui.isOwnedByMe(planet) &&
        !planet.destroyed &&
        planet.energy > 1
    )
    .sort((a, b) => b.energy - a.energy);
  if (owned[0]) return owned[0];
  return home && isLocatable(home) ? home : undefined;
}

export function pickTarget(
  ui: GameUIManager,
  from: LocatablePlanet,
  enemyOnly: boolean,
  percent: number = SEND_PERCENT
): LocatablePlanet | undefined {
  let planets: Planet[] = [];
  try {
    planets = ui
      .getGameManager()
      .getPlanetsInRange(from.locationId, percent, false);
  } catch {
    return undefined;
  }
  const fromCoords = from.location.coords;
  const candidates = planets.filter((planet): planet is LocatablePlanet => {
    if (
      !isLocatable(planet) ||
      planet.destroyed ||
      planet.locationId === from.locationId
    )
      return false;
    if (enemyOnly && ui.isOwnedByMe(planet)) return false;
    return true;
  });
  candidates.sort(
    (a, b) =>
      ui.getDistCoords(fromCoords, a.location.coords) -
      ui.getDistCoords(fromCoords, b.location.coords)
  );
  return candidates[0];
}

function clearLocalControls(
  ui: GameUIManager,
  preserveSelection = false
): void {
  UIEmitter.getInstance().emit(UIEmitterEvent.SendCancelled);
  if (!preserveSelection) ui.setSelectedPlanet(undefined);
  ui.getModalManager().setCursorState(CursorState.Normal);
}

export function armSend(ui: GameUIManager, planet: LocatablePlanet): void {
  ui.setSending(true);
  UIEmitter.getInstance().emit(UIEmitterEvent.SendInitiated, planet);
}

export function findDarkPatch(ui: GameUIManager): WorldCoords | undefined {
  const anchor = minerAnchor(ui);
  const pattern = new SpiralPattern(anchor, MIN_CHUNK_SIZE);
  const radius = Math.max(ui.getWorldRadius(), 1);
  const game = ui.getGameManager();
  let chunk = pattern.fromChunk;
  for (let i = 0; i < DARK_SEARCH_LIMIT; i++) {
    chunk = pattern.nextChunk(chunk);
    const coords = {
      x: chunk.bottomLeft.x + chunk.sideLength / 2,
      y: chunk.bottomLeft.y + chunk.sideLength / 2,
    };
    if (coords.x ** 2 + coords.y ** 2 >= radius ** 2) continue;
    if (!game.hasMinedChunk(chunk)) return coords;
  }
  return undefined;
}

function neighborhoodWidth(ui: GameUIManager, viewport: Viewport): number {
  const home = locatableHome(ui);
  if (!home) return viewport.widthInWorldUnits;
  const rad = Math.max(ui.getRadiusOfPlanetLevel(home.planetLevel), 1);
  const height = CLOSE_RADII * 14 * rad;
  return clampWidth(height * aspectRatio(viewport), viewport);
}

function minerCenterFrame(ui: GameUIManager): ViewFrame {
  const viewport = Viewport.getInstance();
  const anchor = minerAnchor(ui);
  let minX = anchor.x;
  let maxX = anchor.x;
  let minY = anchor.y;
  let maxY = anchor.y;
  for (const chunk of ui.getGameManager().getExploredChunks()) {
    const box = chunk.chunkFootprint;
    minX = Math.min(minX, box.bottomLeft.x);
    maxX = Math.max(maxX, box.bottomLeft.x + box.sideLength);
    minY = Math.min(minY, box.bottomLeft.y);
    maxY = Math.max(maxY, box.bottomLeft.y + box.sideLength);
  }
  const reachX = Math.max(anchor.x - minX, maxX - anchor.x);
  const reachY = Math.max(anchor.y - minY, maxY - anchor.y);
  const aspect = aspectRatio(viewport);
  const span = Math.max(
    reachX * 2,
    reachY * 2 * aspect,
    neighborhoodWidth(ui, viewport) / MINED_FRAME_PAD
  );
  return {
    center: anchor,
    width: clampWidth(span * MINED_FRAME_PAD, viewport),
  };
}

function minerAlreadyFramed(ui: GameUIManager): boolean {
  const viewport = Viewport.getInstance();
  const frame = minerCenterFrame(ui);
  const center = viewport.getViewportPosition();
  const width = viewport.getViewportWorldWidth();
  const height = viewport.getViewportWorldHeight();
  if (width > frame.width * (1 + FRAME_ZOOM_SLACK)) return false;
  if (width < frame.width * (1 - FRAME_ZOOM_SLACK)) return false;
  return (
    Math.abs(frame.center.x - center.x) <= width * ON_SCREEN_MIN_SHIFT &&
    Math.abs(frame.center.y - center.y) <= height * ON_SCREEN_MIN_SHIFT
  );
}

export function findOnScreenDarkPatch(
  ui: GameUIManager
): WorldCoords | undefined {
  const viewport = Viewport.getInstance();
  const view = {
    center: viewport.getViewportPosition(),
    width: viewport.getViewportWorldWidth(),
    height: viewport.getViewportWorldHeight(),
  };
  const previous = ui.getMiningPattern();
  const origin = previous ? fogChunkCenter(previous.fromChunk) : undefined;
  const valid = (point: WorldCoords) => {
    if (
      Math.abs(point.x - view.center.x) > view.width * 0.42 ||
      Math.abs(point.y - view.center.y) > view.height * 0.42 ||
      !isGuideFogTarget(ui, point, view, origin)
    )
      return false;
    const panel = document.querySelector("[data-booth-panel]");
    const canvas = document.querySelector("canvas[data-game-canvas]");
    if (
      !(panel instanceof HTMLElement) ||
      !(canvas instanceof HTMLCanvasElement)
    )
      return true;
    const bounds = panel.getBoundingClientRect(),
      rect = canvas.getBoundingClientRect();
    const local = viewport.worldToCanvasCoords(point);
    const x =
      rect.left + local.x * (canvas.width > 0 ? rect.width / canvas.width : 1);
    const y =
      rect.top +
      local.y * (canvas.height > 0 ? rect.height / canvas.height : 1);
    return (
      x < bounds.left - 20 ||
      x > bounds.right + 20 ||
      y < bounds.top - 20 ||
      y > bounds.bottom + 20
    );
  };
  return guideFogTarget(ui).resolve(
    performance.now(),
    () => pickGuideFogTarget(minerAnchor(ui), view, valid),
    valid
  );
}

function isControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest("df-button, button, a"))
  );
}

function eventInPanel(event: Event, panel: HTMLElement | null): boolean {
  return Boolean(panel && event.composedPath().includes(panel));
}

function eventOnPanelButton(event: Event, panel: HTMLElement | null): boolean {
  if (!eventInPanel(event, panel)) return false;
  return event.composedPath().some((node) => node instanceof HTMLButtonElement);
}

function blurPanelFocus(panel: HTMLElement | null): void {
  if (!panel) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !panel.contains(active)) return;
  const inner = active.shadowRoot?.activeElement;
  if (inner instanceof HTMLElement) inner.blur();
  active.blur();
}

function clampPosition(
  x: number,
  y: number,
  parent: HTMLElement | null
): { x: number; y: number } {
  const width = parent?.clientWidth ?? window.innerWidth;
  const height = parent?.clientHeight ?? window.innerHeight;
  return {
    x: Math.min(
      Math.max(x, PANEL_VISIBLE_MARGIN - PANEL_WIDTH),
      width - PANEL_VISIBLE_MARGIN
    ),
    y: Math.min(Math.max(y, 0), Math.max(0, height - PANEL_VISIBLE_MARGIN)),
  };
}

function clampWidth(width: number, viewport: Viewport): number {
  return Math.min(
    viewport.maxWorldWidth,
    Math.max(viewport.minWorldWidth, width)
  );
}

function aspectRatio(viewport: Viewport): number {
  if (viewport.viewportHeight <= 0) return 1;
  return viewport.viewportWidth / viewport.viewportHeight;
}

function homeRestFrame(ui: GameUIManager, viewport: Viewport): ViewFrame {
  const home = locatableHome(ui);
  const center = home ? { ...home.location.coords } : { ...ui.getHomeCoords() };
  const spacing = Math.sqrt(Math.max(ui.getGameManager().getPlanetRarity(), 1));
  const height = HOME_REST_SPACINGS * spacing;
  return {
    center,
    width: clampWidth(height * aspectRatio(viewport), viewport),
  };
}

export function universeFrame(
  ui: GameUIManager,
  viewport: Viewport
): ViewFrame {
  const radius = Math.max(ui.getWorldRadius(), 1);
  const span = Math.max(aspectRatio(viewport), 1);
  return {
    center: { x: 0, y: 0 },
    width: clampWidth(radius * 2 * span * 1.08, viewport),
  };
}

function applyView(
  viewport: Viewport,
  center: WorldCoords,
  width: number
): void {
  viewport.setData({
    widthInWorldUnits: clampWidth(width, viewport),
    centerWorldCoords: center,
  });
}

function axisCover(viewMin: number, viewMax: number, radius: number): number {
  const overlap = Math.min(viewMax, radius) - Math.max(viewMin, -radius);
  return overlap / (radius * 2);
}

export function universeOnScreen(ui: GameUIManager): boolean {
  const viewport = Viewport.getInstance();
  const radius = Math.max(ui.getWorldRadius(), 1);
  const cover = Math.min(
    axisCover(viewport.getLeftBound(), viewport.getRightBound(), radius),
    axisCover(viewport.getBottomBound(), viewport.getTopBound(), radius)
  );
  if (cover >= UNIVERSE_COVER) return true;
  const originInside =
    viewport.getLeftBound() <= 0 &&
    viewport.getRightBound() >= 0 &&
    viewport.getBottomBound() <= 0 &&
    viewport.getTopBound() >= 0;
  return scrolledOutFully() && originInside;
}

export function scrolledOutFully(): boolean {
  const viewport = Viewport.getInstance();
  return viewport.widthInWorldUnits >= viewport.maxWorldWidth * ZOOM_MAX_RATIO;
}

export function planetCloseFrame(
  ui: GameUIManager,
  planet: LocatablePlanet
): ViewFrame {
  const viewport = Viewport.getInstance();
  const rad = Math.max(ui.getRadiusOfPlanetLevel(planet.planetLevel), 1);
  return {
    center: { ...planet.location.coords },
    width: clampWidth(CLOSE_RADII * rad * aspectRatio(viewport), viewport),
  };
}

export function approachPlanetFrame(ui: GameUIManager): ViewFrame {
  const planet = sourcePlanet(ui);
  if (planet) return planetCloseFrame(ui, planet);
  const viewport = Viewport.getInstance();
  const home = ui.getHomePlanet();
  const rad = Math.max(
    home ? ui.getRadiusOfPlanetLevel(home.planetLevel) : 1,
    1
  );
  return {
    center: { ...ui.getHomeCoords() },
    width: clampWidth(CLOSE_RADII * rad * aspectRatio(viewport), viewport),
  };
}

export function planetNearCenter(ui: GameUIManager): boolean {
  const planet = sourcePlanet(ui);
  if (!planet) return false;
  const viewport = Viewport.getInstance();
  const nearbyWidth = approachPlanetFrame(ui).width * 4;
  if (viewport.getViewportWorldWidth() > nearbyWidth) return false;
  const center = viewport.getViewportPosition();
  const dx = Math.abs(planet.location.coords.x - center.x);
  const dy = Math.abs(planet.location.coords.y - center.y);
  return (
    dx <= viewport.getViewportWorldWidth() * 0.25 &&
    dy <= viewport.getViewportWorldHeight() * 0.25
  );
}

export function showClose(ui: GameUIManager, planet: LocatablePlanet): void {
  const viewport = Viewport.getInstance();
  const rad = Math.max(ui.getRadiusOfPlanetLevel(planet.planetLevel), 1);
  const height = CLOSE_RADII * rad;
  applyView(
    viewport,
    { ...planet.location.coords },
    height * aspectRatio(viewport)
  );
}

export function showNeighborhood(ui: GameUIManager): void {
  const home = locatableHome(ui);
  const viewport = Viewport.getInstance();
  if (!home) {
    viewport.centerCoords(ui.getHomeCoords());
    return;
  }
  const rad = Math.max(ui.getRadiusOfPlanetLevel(home.planetLevel), 1);
  const height = CLOSE_RADII * 14 * rad;
  applyView(
    viewport,
    { ...home.location.coords },
    height * aspectRatio(viewport)
  );
}

function coordsFrame(
  viewport: Viewport,
  a: WorldCoords,
  b: WorldCoords
): ViewFrame {
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const aspect = aspectRatio(viewport);
  const width = Math.max(
    dx * 1.8,
    dy * 1.8 * aspect,
    viewport.minWorldWidth * 40
  );
  return { center, width: clampWidth(width, viewport) };
}

export function frameCoords(
  viewport: Viewport,
  a: WorldCoords,
  b: WorldCoords
): void {
  const frame = coordsFrame(viewport, a, b);
  applyView(viewport, frame.center, frame.width);
}

function moveGuideFrame(ui: GameUIManager, viewport: Viewport): ViewFrame {
  const from = guideMovePlanet(ui);
  if (!from) return homeRestFrame(ui, viewport);
  const target = pickTarget(ui, from, false, SEND_PERCENT);
  if (!target) return planetCloseFrame(ui, from);
  const dx = Math.abs(from.location.coords.x - target.location.coords.x);
  const dy = Math.abs(from.location.coords.y - target.location.coords.y);
  const span = Math.max(dx * 2, dy * 2 * aspectRatio(viewport));
  return {
    center: { ...from.location.coords },
    width: clampWidth(
      Math.max(span * 1.45, viewport.minWorldWidth * 40),
      viewport
    ),
  };
}

function playDampedReturn(target: ViewFrame, onReady?: () => void): () => void {
  return playGuideCamera(Viewport.getInstance(), target, "return", onReady);
}

function playMinedReveal(target: ViewFrame, onReady?: () => void): () => void {
  return playGuideCamera(Viewport.getInstance(), target, "mined", onReady);
}

export function focusHome(ui: GameUIManager): void {
  const home = locatableHome(ui);
  if (home) showClose(ui, home);
  else Viewport.getInstance().centerCoords(ui.getHomeCoords());
}

const Panel = styled.aside`
  position: absolute;
  z-index: 10;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: ${PANEL_WIDTH}px;
  padding: 12px;
  overflow: hidden;
  background: ${dfstyles.colors.backgroundlighter};
  color: ${dfstyles.colors.text};
  border: 1px solid ${dfstyles.colors.border};
  line-height: 1.45;

  p {
    margin: 0 0 8px;
  }

  ul {
    margin: 0 0 8px;
    padding-left: 1.1em;
  }

  li + li {
    margin-top: 4px;
  }
`;

const Body = styled.div`
  min-height: 0;
  overflow-y: auto;
`;

const DragBar = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -12px -12px 12px;
  padding: 8px 12px;
  cursor: grab;
  user-select: none;
  touch-action: none;
  border-bottom: 1px solid ${dfstyles.colors.border};

  &:active {
    cursor: grabbing;
  }
`;

const StepList = styled.ol`
  margin: 0 0 8px;
  padding: 0;
  list-style: none;

  li + li {
    margin-top: 0;
  }
`;

const StepButton = styled.button<{ $current: boolean }>`
  display: block;
  width: 100%;
  margin: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: ${({ $current }) =>
    $current ? dfstyles.colors.dfgreen : dfstyles.colors.text};
  font: inherit;
  font-weight: ${({ $current }) => ($current ? 600 : 400)};
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  outline: none;

  &:hover {
    text-decoration: underline;
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

const Dock = styled.div`
  flex: none;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid ${dfstyles.colors.border};
`;

const ScrollHint = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: ${dfstyles.colors.dfpink};

  span {
    font-size: 24px;
    line-height: 1;
  }
`;

const DockStatus = styled.p<{ $done: boolean }>`
  color: ${({ $done }) =>
    $done ? dfstyles.colors.dfgreen : dfstyles.colors.text};
  white-space: pre-line;
`;

const celebrationPulse = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.7);
  }
  30% {
    opacity: 1;
    transform: scale(1.12);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
`;

const CompleteCelebration = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  color: ${dfstyles.colors.dfpink};
  animation: ${celebrationPulse} 500ms ease-out both;

  span {
    position: relative;
    display: inline-block;
    width: 20px;
    height: 20px;
    flex: none;
    border: 2px solid ${dfstyles.colors.dfpink};
    border-radius: 50%;
    box-shadow: 0 0 8px ${dfstyles.colors.dfpink};
  }
`;

const BrightAction = styled.div`
  margin-top: 12px;

  df-button {
    width: 100%;
    --df-button-color: ${dfstyles.colors.dfgreen};
    --df-button-border: 1px solid ${dfstyles.colors.dfgreen};
    --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};
  }
`;

const PageNav = styled.div`
  display: flex;
  flex: none;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
`;

function CoverCopy({ onStart }: { onStart: () => void }) {
  return (
    <>
      <p>
        Dark Forest is a fully onchain ZK warfare of exploration, strategy, and
        conquest.
      </p>
      <p>
        Follow {TASK_ORDER.length} short chapters: your planet, sending energy,
        ships, exploration, controls, and scoring with account safety.
      </p>
      <BrightAction>
        <Btn size="stretch" onClick={onStart}>
          Start guide
        </Btn>
      </BrightAction>
    </>
  );
}

function PlayCopy() {
  return (
    <>
      <p>
        This is the whole guide, only a basic introduction. Dark Forest has more
        worth exploring.
      </p>
      <p>
        Follow us on Twitter:{" "}
        <Link to="https://twitter.com/DFArchon" color={dfstyles.colors.dfpink}>
          @DFArchon
        </Link>
      </p>
    </>
  );
}

export function BoothGuidePane({
  onComplete,
  onClose,
}: {
  onComplete: () => void;
  onClose: () => void;
}) {
  const uiManager = useUIManager();
  const [terminalReveal] = useSetting(uiManager, Setting.TerminalReveal);
  const [assistGate] = useState(() => new GuideAssistGate());
  const [assistId, setAssistId] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragOrigin = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const stopTour = useRef<(() => void) | null>(null);
  const stopHomeReturn = useRef<() => void>(() => {});
  const finishRef = useRef<() => void>(() => {});
  const phaseRef = useRef<DockPhase>("waiting");
  const entryRef = useRef(0);
  const pageAtEntry = useRef<PageId>("cover");
  const retainFogCamera = useRef(false);
  const openRef = useRef<
    (nextPage: PageId, nextStep: StepId | null, continuous?: boolean) => void
  >(() => {});
  const [pointerSequence] = useState(() => new GuidePointerSequence());
  const [position, setPosition] = useState({ x: 56, y: 52 });
  const panelMaxHeight = useGuidePanelPlacement(
    panelRef,
    position,
    setPosition,
    dragOrigin
  );
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const reportedComplete = useRef(false);
  const [page, setPage] = useState<PageId>("cover");
  const [stepId, setStepId] = useState<StepId | null>(null);
  const [phase, setPhase] = useState<DockPhase>("waiting");
  const [notice, setNotice] = useState<string | null>(null);
  const [coach, setCoach] = useState<string | null>(null);
  const [entry, setEntry] = useState(0);
  const [pointerReadyEntry, setPointerReadyEntry] = useState(-1);
  const [pageCountdown, setPageCountdown] = useState<number | null>(null);

  phaseRef.current = phase;
  entryRef.current = entry;

  const stopCameraTour = () => {
    stopTour.current?.();
    stopTour.current = null;
  };

  const open = (
    nextPage: PageId,
    nextStep: StepId | null,
    continuous = false
  ) => {
    if (
      !continuous &&
      (nextPage === "cover" || nextPage !== page || nextStep !== stepId)
    ) {
      pointerSequence.reset();
    }
    assistGate.cancel();
    setAssistId(null);
    stopCameraTour();
    retainFogCamera.current = page === "fog" && nextPage === "fog";
    if (!retainFogCamera.current) {
      stopHomeReturn.current();
      stopHomeReturn.current = () => {};
    }
    phaseRef.current = "waiting";
    if (nextPage === "cover") reportedComplete.current = false;
    setPage(nextPage);
    setStepId(nextStep);
    setPhase("waiting");
    setNotice(null);
    setCoach(null);
    setEntry((n) => n + 1);
  };
  openRef.current = open;

  useEffect(() => {
    return () => {
      entryRef.current = -1;
      assistGate.cancel();
      stopCameraTour();
      stopHomeReturn.current();
      stopHomeReturn.current = () => {};
      clearLocalControls(uiManager, true);
    };
  }, [uiManager, assistGate]);

  useEffect(() => {
    const stopButtonKeys = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter" && event.code !== "Space")
        return;
      if (!eventInPanel(event, panelRef.current)) return;
      event.preventDefault();
    };
    const keepButtonsUnfocused = (event: MouseEvent) => {
      if (!eventOnPanelButton(event, panelRef.current)) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", stopButtonKeys, true);
    window.addEventListener("mousedown", keepButtonsUnfocused, true);
    return () => {
      window.removeEventListener("keydown", stopButtonKeys, true);
      window.removeEventListener("mousedown", keepButtonsUnfocused, true);
    };
  }, []);

  useEffect(() => {
    blurPanelFocus(panelRef.current);
  }, [page, stepId, phase]);

  useEffect(() => {
    if (page === "play" && !reportedComplete.current) {
      reportedComplete.current = true;
      completeRef.current();
    }
  }, [page]);

  useEffect(() => {
    const keepVisible = () =>
      setPosition((pos) =>
        clampPosition(pos.x, pos.y, panelRef.current?.parentElement ?? null)
      );
    keepVisible();
    window.addEventListener("resize", keepVisible);
    return () => window.removeEventListener("resize", keepVisible);
  }, []);

  useEffect(() => {
    if (phase !== "done" || !stepId) return;
    const next = following(page, stepId);
    const finale = isPageFinale(page, stepId);
    const delay = finale
      ? PAGE_HOLD_MS
      : (page === "planet" && (stepId === "zoom" || stepId === "zoomIn")) ||
          (page === "move" && stepId === "pressSend")
        ? 0
        : QUICK_ADVANCE_MS;
    let tick = 0;
    if (finale) {
      const seconds = PAGE_HOLD_MS / 1000;
      const started = performance.now();
      setPageCountdown(seconds);
      tick = window.setInterval(() => {
        const left = Math.ceil(
          (PAGE_HOLD_MS - (performance.now() - started)) / 1000
        );
        setPageCountdown(Math.max(0, left));
      }, 200);
    }
    const timer = window.setTimeout(
      () => openRef.current(next.page, next.step, true),
      delay
    );
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(tick);
      setPageCountdown(null);
    };
  }, [phase, page, stepId]);

  useEffect(() => {
    if (entry === 0 && stepId === null) return;

    let settled = false;
    const pointerReady = () => {
      if (!settled) setPointerReadyEntry(entry);
    };
    let framingPointerTarget = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      assistGate.cancel();
      setAssistId(null);
      phaseRef.current = "done";
      setNotice(null);
      setPhase("done");
    };
    finishRef.current = finish;
    const reject = (message: string) => {
      if (settled) return;
      phaseRef.current = "waiting";
      setNotice(message);
      setPhase("waiting");
    };

    const keepReveal = retainFogCamera.current;
    retainFogCamera.current = false;
    stopCameraTour();
    const enteringFog = page === "fog" && pageAtEntry.current !== "fog";
    pageAtEntry.current = page;
    const preserveMoveSelection =
      page === "move" && stepId !== "selectMovePlanet";
    clearLocalControls(
      uiManager,
      preserveMoveSelection ||
        (page === "ships" && stepId !== "selectShipPlanet")
    );
    if (!keepReveal) {
      if (page === "cover") {
        stopHomeReturn.current = playDampedReturn(
          homeRestFrame(uiManager, Viewport.getInstance())
        );
      } else if (
        (page === "move" && stepId === "selectMovePlanet") ||
        (page === "ships" && stepId === "selectShipPlanet")
      ) {
        framingPointerTarget = true;
        stopHomeReturn.current = playDampedReturn(
          page === "ships" && guideShip(uiManager)
            ? coordsFrame(
                Viewport.getInstance(),
                guideShip(uiManager)!.from.location.coords,
                guideShip(uiManager)!.to.location.coords
              )
            : moveGuideFrame(uiManager, Viewport.getInstance()),
          pointerReady
        );
      } else if (
        page === "fog" &&
        (enteringFog || !minerAlreadyFramed(uiManager))
      ) {
        framingPointerTarget = true;
        stopHomeReturn.current = playMinedReveal(
          minerCenterFrame(uiManager),
          pointerReady
        );
      }
    }

    const stopWatchers: Array<() => void> = [];
    if (stepId && isTask(page)) {
      const taskPage = TASK_PAGES[page];
      taskPage.open(uiManager, stepId);
      const showCoach = (text: string | null) => {
        setCoach((prev) => (prev === text ? prev : text));
      };
      const releaseTour = () => {
        if (!stopTour.current || settled) return;
        stopCameraTour();
        phaseRef.current = "waiting";
        setPhase("waiting");
      };
      stopWatchers.push(
        taskPage.watch({
          ui: uiManager,
          stepId,
          finish,
          hidePointer: () => setPointerReadyEntry(-1),
          reject,
          notify: (message) => setNotice(message),
          showCoach,
          releaseTour,
          stopTour: stopCameraTour,
          isSettled: () => settled,
          isRunning: () => phaseRef.current === "running",
          isDemonstrating: () => phaseRef.current === "demonstrating",
        })
      );
    }

    if (!framingPointerTarget) pointerReady();

    return () => {
      settled = true;
      finishRef.current = () => {};
      stopWatchers.forEach((stop) => stop());
      if (retainFogCamera.current) return;
      stopCameraTour();
      stopHomeReturn.current();
      stopHomeReturn.current = () => {};
    };
  }, [entry, stepId, page, uiManager, assistGate]);

  const executeAssist = (generation: number, step: StepId, task: TaskId) => {
    if (entryRef.current !== generation || phaseRef.current === "done") return;
    setAssistId(null);
    phaseRef.current = "running";
    setNotice(null);
    setPhase("running");

    const play = (
      motion: CameraMotion,
      target: ViewFrame,
      onDone: () => void
    ) => {
      stopTour.current = playGuideCamera(
        Viewport.getInstance(),
        target,
        motion,
        () => {
          stopTour.current = null;
          onDone();
        }
      );
    };
    void (async () => {
      try {
        await TASK_PAGES[task].assist({
          ui: uiManager,
          stepId: step,
          finish: () => finishRef.current(),
          isDone: () => phaseRef.current === "done",
          isCurrent: () => entryRef.current === generation,
          playTour: (target, onDone) => play("tour", target, onDone),
          playReveal: (target, onDone) => play("reveal", target, onDone),
          playApproach: (target, onDone) => play("approach", target, onDone),
        });
      } catch (error) {
        if (entryRef.current !== generation || phaseRef.current !== "running")
          return;
        phaseRef.current = "waiting";
        setPhase("waiting");
        setNotice(
          failMessage(
            error,
            "That did not work. Try the step yourself, or press again."
          )
        );
      }
    })();
  };

  const runAssist = () => {
    if (!stepId || !isTask(page) || phaseRef.current !== "waiting") return;
    if (
      page === "ships" &&
      stepId !== "deselect" &&
      !guideShipLesson(uiManager)
    ) {
      open("ships", "deselect");
      return;
    }
    if (needsGuideMouse(stepId)) {
      phaseRef.current = "demonstrating";
      setNotice(null);
      setAssistId(assistGate.begin(entryRef.current));
      setPhase("demonstrating");
    } else executeAssist(entryRef.current, stepId, page);
  };

  useEffect(() => {
    if (assistId === null) return;
    const cancel = (message: string) => {
      if (!assistGate.isCurrent(assistId)) return;
      assistGate.cancel();
      setAssistId(null);
      if (phaseRef.current !== "demonstrating") return;
      phaseRef.current = "waiting";
      setPhase("waiting");
      setNotice(message);
    };
    const onInput = () =>
      cancel(
        "Demonstration cancelled. You can continue yourself or try the assist button again."
      );
    const onVisibility = () => {
      if (document.hidden) onInput();
    };
    const timer = window.setTimeout(
      () =>
        cancel(
          "The target is not ready. Check that its panel is open, then try again."
        ),
      10000
    );
    window.addEventListener("pointerdown", onInput, true);
    window.addEventListener("keydown", onInput, true);
    window.addEventListener("wheel", onInput, true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onInput, true);
      window.removeEventListener("keydown", onInput, true);
      window.removeEventListener("wheel", onInput, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [assistId, assistGate]);

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isControlTarget(event.target)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.x,
      top: position.y,
    };
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    setPosition(
      clampPosition(
        origin.left + event.clientX - origin.x,
        origin.top + event.clientY - origin.y,
        panelRef.current?.parentElement ?? null
      )
    );
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId === event.pointerId)
      dragOrigin.current = null;
  };

  const resetToCover = () => {
    open("cover", null);
  };

  const pageIndex = PAGE_ORDER.indexOf(page);
  const previous = pageIndex > 0 ? PAGE_ORDER[pageIndex - 1] : null;
  const next =
    pageIndex < PAGE_ORDER.length - 1 ? PAGE_ORDER[pageIndex + 1] : null;
  const navLocked = phase !== "waiting";
  const taskPage = isTask(page) ? TASK_PAGES[page] : null;
  const step = stepId ? STEPS[stepId] : null;
  const shipUnavailable =
    page === "ships" &&
    stepId !== "deselect" &&
    phase === "waiting" &&
    !guideShipLesson(uiManager);
  const dockText = shipUnavailable
    ? "No idle ship with a known destination is available. You can wait for one to arrive, or skip this exercise."
    : step
      ? phase === "running" || phase === "demonstrating"
        ? step.running
        : phase === "done"
          ? step.done
          : (notice ??
            coach ??
            (stepId === "hideTerminal"
              ? terminalGuide(terminalReveal).hint
              : step.hint))
      : "";
  const TaskIntro = taskPage?.Intro;

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
                    onComplete: () => {
                      if (
                        !stepId ||
                        !isTask(page) ||
                        phaseRef.current !== "demonstrating" ||
                        !assistGate.complete(assistId, entryRef.current)
                      )
                        return;
                      executeAssist(entryRef.current, stepId, page);
                    },
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
            focusPlanet={() => sourcePlanet(uiManager)}
            darkPatch={() => findOnScreenDarkPatch(uiManager)}
            zoomNeedsDrag={() =>
              !universeOnScreen(uiManager) && scrolledOutFully()
            }
          />
        )}
      <Panel
        ref={panelRef}
        role="region"
        aria-label="Player guide"
        data-booth-panel
        style={{
          left: position.x,
          top: position.y,
          maxHeight: panelMaxHeight ?? `calc(100% - ${position.y}px - 16px)`,
        }}
      >
        <DragBar
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
        >
          <span>{pageTitle(page)}</span>
          <div>
            <Btn size="small" onClick={resetToCover}>
              Back to start
            </Btn>
            <Btn size="small" onClick={onClose}>
              Close guide
            </Btn>
          </div>
        </DragBar>
        <Body data-guide-body>
          {page === "cover" && (
            <CoverCopy onStart={() => open("planet", "zoom")} />
          )}
          {page === "play" && (
            <>
              <PlayCopy />
              <BrightAction>
                <Btn size="stretch" onClick={onClose}>
                  Start playing
                </Btn>
              </BrightAction>
            </>
          )}
          {taskPage && TaskIntro && stepId && (
            <>
              <TaskIntro />
              <StepList>
                {taskPage.steps.map((id, index) => (
                  <li key={id}>
                    <StepButton
                      type="button"
                      tabIndex={-1}
                      data-guide-step={id}
                      aria-current={id === stepId ? "step" : undefined}
                      $current={id === stepId}
                      onClick={() => open(page, id)}
                    >
                      {index + 1}. {STEPS[id].label}
                    </StepButton>
                  </li>
                ))}
              </StepList>
            </>
          )}
          {taskPage && step && (
            <Dock data-guide-current-step={stepId}>
              {phase === "waiting" &&
                (stepId === "zoom" || stepId === "zoomIn") && (
                  <ScrollHint>
                    <span aria-hidden="true">
                      {stepId === "zoom" ? "↓" : "↑"}
                    </span>
                    {stepId === "zoom"
                      ? "Scroll down to zoom out"
                      : "Scroll up to zoom in"}
                  </ScrollHint>
                )}
              {stepId && phase === "done" && isPageFinale(page, stepId) && (
                <CompleteCelebration>
                  <span aria-hidden="true" />
                  <div>
                    <div>
                      Page {TASK_ORDER.indexOf(page as TaskId) + 1} complete.
                    </div>
                    <div>
                      {page === TASK_ORDER[TASK_ORDER.length - 1]
                        ? "Finishing in"
                        : "Next page in"}{" "}
                      {pageCountdown ?? PAGE_HOLD_MS / 1000}s.
                    </div>
                  </div>
                </CompleteCelebration>
              )}
              <DockStatus $done={phase === "done"}>{dockText}</DockStatus>
              {phase === "waiting" && (
                <BrightAction>
                  <p>
                    {shipUnavailable
                      ? "This exercise needs an available ship:"
                      : (step.assistLead ?? "We can do this part:")}
                  </p>
                  <Btn size="stretch" onClick={runAssist}>
                    {shipUnavailable ? "Skip ship exercise" : step.button}
                  </Btn>
                </BrightAction>
              )}
            </Dock>
          )}
          {(previous || (next && page !== "cover")) && (
            <PageNav>
              {previous ? (
                <Btn
                  disabled={navLocked}
                  onClick={() => open(previous, firstStep(previous))}
                >
                  Previous
                </Btn>
              ) : (
                <span />
              )}
              {next && page !== "cover" ? (
                <Btn
                  disabled={navLocked}
                  onClick={() => open(next, firstStep(next))}
                >
                  Next
                </Btn>
              ) : (
                <span />
              )}
            </PageNav>
          )}
        </Body>
      </Panel>
    </>
  );
}
