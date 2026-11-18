import { type LocatablePlanet, type WorldCoords } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import {
  fogChunkCenter,
  guideFogTarget,
  guideMinerAnchor as minerAnchor,
  isGuideFogTarget,
  pickGuideFogTarget,
} from "./guideFog";
import { guideWorldPoint } from "./guideMapPoint";
import { locatableHome, sourcePlanet } from "./guidePlanets";
import { type ViewFrame } from "./guideTypes";
const CLOSE_RADII = 28;
const HOME_REST_SPACINGS = 2;
const MINED_FRAME_PAD = 1.55;
const ZOOM_MAX_RATIO = 0.99;
const UNIVERSE_COVER = 0.8;
const ON_SCREEN_MIN_SHIFT = 0.12;
const FRAME_ZOOM_SLACK = 0.15;

export function neighborhoodWidth(
  ui: GameUIManager,
  viewport: Viewport
): number {
  const home = locatableHome(ui);
  if (!home) return viewport.widthInWorldUnits;
  const rad = Math.max(ui.getRadiusOfPlanetLevel(home.planetLevel), 1);
  const height = CLOSE_RADII * 14 * rad;
  return clampWidth(height * aspectRatio(viewport), viewport);
}

export function minerCenterFrame(ui: GameUIManager): ViewFrame {
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

export function minerAlreadyFramed(ui: GameUIManager): boolean {
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
    return Boolean(guideWorldPoint(point));
  };
  return guideFogTarget(ui).resolve(
    performance.now(),
    () => pickGuideFogTarget(minerAnchor(ui), view, valid),
    valid
  );
}

export function clampWidth(width: number, viewport: Viewport): number {
  return Math.min(
    viewport.maxWorldWidth,
    Math.max(viewport.minWorldWidth, width)
  );
}

export function aspectRatio(viewport: Viewport): number {
  if (viewport.viewportHeight <= 0) return 1;
  return viewport.viewportWidth / viewport.viewportHeight;
}

export function homeRestFrame(
  ui: GameUIManager,
  viewport: Viewport
): ViewFrame {
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

export function applyView(
  viewport: Viewport,
  center: WorldCoords,
  width: number
): void {
  viewport.setData({
    widthInWorldUnits: clampWidth(width, viewport),
    centerWorldCoords: center,
  });
}

export function axisCover(
  viewMin: number,
  viewMax: number,
  radius: number
): number {
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

export function coordsFrame(
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

export function focusHome(ui: GameUIManager): void {
  const home = locatableHome(ui);
  if (home) showClose(ui, home);
  else Viewport.getInstance().centerCoords(ui.getHomeCoords());
}
