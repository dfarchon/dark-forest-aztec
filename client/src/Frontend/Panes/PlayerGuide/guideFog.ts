import type { Rectangle, WorldCoords } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import { SpiralPattern } from "../../../Backend/Miner/MiningPatterns";
import { MIN_CHUNK_SIZE } from "../../Utils/constants";

export function fogChunk(coords: WorldCoords): Rectangle {
  return new SpiralPattern(coords, MIN_CHUNK_SIZE).fromChunk;
}

export function fogChunkCenter(chunk: Rectangle): WorldCoords {
  return {
    x: chunk.bottomLeft.x + chunk.sideLength / 2,
    y: chunk.bottomLeft.y + chunk.sideLength / 2,
  };
}

export function guideMinerAnchor(ui: GameUIManager): WorldCoords {
  const live = ui.getMinerLocation();
  if (live) return { ...live };
  const exploring = ui.getGameManager().getCurrentlyExploringChunk();
  if (exploring) return fogChunkCenter(exploring);
  const pattern = ui.getMiningPattern();
  return pattern
    ? fogChunkCenter(pattern.fromChunk)
    : { ...ui.getHomeCoords() };
}

export function isGuideFogDestination(
  ui: GameUIManager,
  coords: WorldCoords,
  previous?: WorldCoords
): boolean {
  if (
    !Number.isFinite(coords.x) ||
    !Number.isFinite(coords.y) ||
    coords.x ** 2 + coords.y ** 2 >= ui.getWorldRadius() ** 2
  )
    return false;
  const chunk = fogChunk(coords);
  if (previous) {
    const before = fogChunk(previous);
    if (
      before.bottomLeft.x === chunk.bottomLeft.x &&
      before.bottomLeft.y === chunk.bottomLeft.y
    )
      return false;
  }
  return !ui.getGameManager().hasMinedChunk(chunk);
}

/** Called after explorer listeners have applied the requested mining pattern. */
export function confirmGuideFogMove(
  ui: GameUIManager,
  coords: WorldCoords
): boolean {
  const actual = ui.getMiningPattern()?.fromChunk;
  const wanted = fogChunk(coords);
  if (
    !actual ||
    actual.bottomLeft.x !== wanted.bottomLeft.x ||
    actual.bottomLeft.y !== wanted.bottomLeft.y
  )
    return false;
  if (!ui.isMining()) ui.startExplore();
  return ui.isMining();
}

export type FogView = { center: WorldCoords; width: number; height: number };

/** Aim inside the fog, with room for a slightly imprecise click and ongoing mining. */
export function isGuideFogTarget(
  ui: GameUIManager,
  coords: WorldCoords,
  view: FogView,
  previous?: WorldCoords
): boolean {
  if (!isGuideFogDestination(ui, coords, previous)) return false;
  const margin = Math.max(
    MIN_CHUNK_SIZE,
    Math.min(view.width, view.height) * 0.06
  );
  if (Math.hypot(coords.x, coords.y) + margin >= ui.getWorldRadius())
    return false;
  for (const { chunkFootprint: chunk } of ui
    .getGameManager()
    .getExploredChunks()) {
    const nearestX = Math.max(
      chunk.bottomLeft.x,
      Math.min(coords.x, chunk.bottomLeft.x + chunk.sideLength)
    );
    const nearestY = Math.max(
      chunk.bottomLeft.y,
      Math.min(coords.y, chunk.bottomLeft.y + chunk.sideLength)
    );
    if (Math.hypot(coords.x - nearestX, coords.y - nearestY) <= margin)
      return false;
  }
  return true;
}

/** Keep Ares's preferred direction, but search the whole visible map on a miss. */
export function pickGuideFogTarget(
  anchor: WorldCoords,
  view: FogView,
  valid: (coords: WorldCoords) => boolean
): WorldCoords | undefined {
  const { width, height, center } = view;
  if (!(width > 0 && height > 0)) return undefined;
  const left = center.x - width * 0.42,
    right = center.x + width * 0.42;
  const bottom = center.y - height * 0.42,
    top = center.y + height * 0.42;
  const preferred = { x: anchor.x + width * 0.35, y: anchor.y + height * 0.22 };
  const accepts = (point: WorldCoords) =>
    point.x >= left &&
    point.x <= right &&
    point.y >= bottom &&
    point.y <= top &&
    Math.hypot(point.x - anchor.x, point.y - anchor.y) >=
      Math.min(width, height) * 0.2 &&
    valid(point);
  const pattern = new SpiralPattern(preferred, MIN_CHUNK_SIZE);
  let chunk = pattern.fromChunk;
  for (let i = 0; i < 64; i++) {
    const point = fogChunkCenter(chunk);
    if (accepts(point)) return point;
    chunk = pattern.nextChunk(chunk);
  }
  const candidates: WorldCoords[] = [];
  for (let x = 0; x <= 24; x++)
    for (let y = 0; y <= 24; y++)
      candidates.push(
        fogChunkCenter(
          fogChunk({
            x: left + ((right - left) * x) / 24,
            y: bottom + ((top - bottom) * y) / 24,
          })
        )
      );
  candidates.sort(
    (a, b) =>
      Math.hypot(a.x - preferred.x, a.y - preferred.y) -
      Math.hypot(b.x - preferred.x, b.y - preferred.y)
  );
  return candidates.find(accepts);
}

/** One world target per lesson. Explorer motion alone never changes it. */
export class GuideFogTarget {
  private target: WorldCoords | undefined;
  private checked = -Infinity;
  reset(): void {
    this.target = undefined;
    this.checked = -Infinity;
  }
  resolve(
    now: number,
    choose: () => WorldCoords | undefined,
    valid: (point: WorldCoords) => boolean
  ): WorldCoords | undefined {
    if (now - this.checked >= 400) {
      this.checked = now;
      if (!this.target || !valid(this.target)) {
        const next = choose();
        this.target = next && valid(next) ? { ...next } : undefined;
      }
    }
    return this.target ? { ...this.target } : undefined;
  }
}

const targets = new WeakMap<GameUIManager, GuideFogTarget>();
export function guideFogTarget(ui: GameUIManager): GuideFogTarget {
  let target = targets.get(ui);
  if (!target) {
    target = new GuideFogTarget();
    targets.set(ui, target);
  }
  return target;
}
