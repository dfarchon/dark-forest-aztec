import { hasOwner, isLocatable } from "@dfpunk/gamelogic";
import { getPlayerColor } from "@dfpunk/procedural";
import { Setting, type WorldCoords } from "@dfpunk/types";
import React, { useEffect, useRef } from "react";
import styled from "styled-components";

import type GameUIManager from "../../Backend/GameLogic/GameUIManager";
import Viewport from "../Game/Viewport";
import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { settingChanged$ } from "../Utils/SettingsHooks";
import type { TerrainRequest, TerrainResponse } from "./minimapTerrain.worker";

/**
 * Corner map modeled on the dfarchon mini-map plugin:
 * sample space type across the world, draw home and owned planets,
 * overlay the current viewport, and click or drag to recenter.
 */

const MAP_SIZE = 180;
const PAD = 8;
const SAMPLES = 96;
const MARKER_REFRESH_MS = 1000;
const BRIGHTEN = 1.9;

const COLOR_SETTINGS = [
  Setting.RendererColorInnerNebula,
  Setting.RendererColorNebula,
  Setting.RendererColorSpace,
  Setting.RendererColorDeepSpace,
  Setting.RendererColorDeadSpace,
] as const;

type Rgb = [number, number, number];

type MapColors = {
  inner: string;
  nebula: string;
  space: string;
  deep: string;
  dead: string;
};

const FALLBACK_COLORS: Record<(typeof COLOR_SETTINGS)[number], string> = {
  [Setting.RendererColorInnerNebula]: "#186469",
  [Setting.RendererColorNebula]: "#0B2B5B",
  [Setting.RendererColorSpace]: "#0B0F34",
  [Setting.RendererColorDeepSpace]: "#0B061F",
  [Setting.RendererColorDeadSpace]: "#11291b",
};

function parseHex(hex: string): Rgb {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length < 6) return [11, 15, 52];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function brighten(rgb: Rgb): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * BRIGHTEN)));
  return `rgb(${channel(rgb[0])},${channel(rgb[1])},${channel(rgb[2])})`;
}

function readColors(ui: GameUIManager): MapColors {
  const color = (setting: (typeof COLOR_SETTINGS)[number]) =>
    brighten(
      parseHex(ui.getStringSetting(setting) || FALLBACK_COLORS[setting])
    );
  return {
    inner: color(Setting.RendererColorInnerNebula),
    nebula: color(Setting.RendererColorNebula),
    space: color(Setting.RendererColorSpace),
    deep: color(Setting.RendererColorDeepSpace),
    dead: color(Setting.RendererColorDeadSpace),
  };
}

/** Bands produced by minimapTerrain.worker: 0 inner … 4 dead. */
function colorForBand(band: number, colors: MapColors): string {
  if (band === 0) return colors.inner;
  if (band === 1) return colors.nebula;
  if (band === 2) return colors.space;
  if (band === 3) return colors.deep;
  return colors.dead;
}

function worldToMap(
  x: number,
  y: number,
  radius: number
): { x: number; y: number } {
  const span = MAP_SIZE - PAD * 2;
  return {
    x: ((x + radius) / (radius * 2)) * span + PAD,
    y: ((-y + radius) / (radius * 2)) * span + PAD,
  };
}

function mapToWorld(px: number, py: number, radius: number): WorldCoords {
  const span = MAP_SIZE - PAD * 2;
  const nx = (px - PAD) / span;
  const ny = (py - PAD) / span;
  return {
    x: nx * radius * 2 - radius,
    y: -(ny * radius * 2 - radius),
  };
}

function worldDistToMap(distance: number, radius: number): number {
  const span = MAP_SIZE - PAD * 2;
  return (distance / (radius * 2)) * span;
}

function paintDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fill: string
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(x - size / 2 - 0.5, y - size / 2 - 0.5, size + 1, size + 1);
  ctx.fillStyle = fill;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
}

function strokeWorld(ctx: CanvasRenderingContext2D) {
  const span = MAP_SIZE - PAD * 2;
  ctx.beginPath();
  ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, span / 2, 0, Math.PI * 2);
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function clipWorld(ctx: CanvasRenderingContext2D) {
  const span = MAP_SIZE - PAD * 2;
  ctx.beginPath();
  ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, span / 2, 0, Math.PI * 2);
  ctx.clip();
}

export function MiniMapPane() {
  const uiManager = useUIManager();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let alive = true;
    let jobId = 0;
    let frame = 0;
    let lastMarkerRefresh = 0;
    let worker: Worker | null = null;
    let terrainSample: TerrainResponse | null = null;
    const radiusRef = { current: 0 };

    const terrain = document.createElement("canvas");
    const markers = document.createElement("canvas");

    const bitmapSize = (dpr: number) => Math.floor(MAP_SIZE * dpr);

    const ensureSize = (buffer: HTMLCanvasElement, dpr: number) => {
      const size = bitmapSize(dpr);
      if (buffer.width !== size || buffer.height !== size) {
        buffer.width = size;
        buffer.height = size;
      }
    };

    // Assigning width resets context state, including a clip left by a cancelled pass.
    const resetBuffer = (buffer: HTMLCanvasElement, dpr: number) => {
      const size = bitmapSize(dpr);
      buffer.width = size;
      buffer.height = size;
    };

    const paintTerrain = () => {
      const radius = radiusRef.current;
      const dpr = window.devicePixelRatio || 1;
      resetBuffer(terrain, dpr);
      const ctx = terrain.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      const sample = terrainSample;
      if (!sample || sample.radius !== radius || radius <= 0) return;

      ctx.save();
      clipWorld(ctx);
      const colors = readColors(uiManager);
      const dot = (MAP_SIZE - PAD * 2) / SAMPLES + 1.35;
      const { xs, ys, bands } = sample;
      for (let i = 0; i < bands.length; i++) {
        ctx.fillStyle = colorForBand(bands[i], colors);
        const point = worldToMap(xs[i], ys[i], radius);
        ctx.fillRect(point.x - dot / 2, point.y - dot / 2, dot, dot);
      }
      ctx.restore();
    };

    const onTerrainMessage = (event: MessageEvent<TerrainResponse>) => {
      if (!alive || event.data.id !== jobId) return;
      terrainSample = event.data;
      paintTerrain();
    };

    const requestTerrain = () => {
      const radius = uiManager.getWorldRadius();
      radiusRef.current = radius;
      if (radius <= 0) return;
      if (terrainSample && terrainSample.radius === radius) {
        // Drop an in-flight sample for a radius we no longer want.
        jobId += 1;
        paintTerrain();
        return;
      }

      const id = ++jobId;
      const perlin = uiManager.getPerlinConfig(false);
      const { PERLIN_THRESHOLD_1, PERLIN_THRESHOLD_2, PERLIN_THRESHOLD_3 } =
        uiManager.contractConstants;
      if (!worker) {
        worker = new Worker(
          new URL("./minimapTerrain.worker.ts", import.meta.url),
          { type: "module" }
        );
        worker.addEventListener("message", onTerrainMessage);
      }
      const request: TerrainRequest = {
        id,
        radius,
        samples: SAMPLES,
        key: perlin.key,
        scale: perlin.scale,
        mirrorX: perlin.mirrorX,
        mirrorY: perlin.mirrorY,
        t1: PERLIN_THRESHOLD_1,
        t2: PERLIN_THRESHOLD_2,
        t3: PERLIN_THRESHOLD_3,
      };
      worker.postMessage(request);
    };

    const rebuildMarkers = () => {
      const radius = radiusRef.current;
      const dpr = window.devicePixelRatio || 1;
      resetBuffer(markers, dpr);
      const ctx = markers.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      if (radius <= 0) return;

      ctx.save();
      clipWorld(ctx);

      for (const planet of uiManager.getPlanetMap().values()) {
        if (!isLocatable(planet) || planet.destroyed || planet.isHomePlanet) {
          continue;
        }
        if (!hasOwner(planet)) continue;
        const { x, y } = planet.location.coords;
        if (x * x + y * y > radius * radius) continue;
        const point = worldToMap(x, y, radius);
        const mine = uiManager.isOwnedByMe(planet);
        paintDot(
          ctx,
          point.x,
          point.y,
          mine ? 4 : 3,
          mine ? "#ffffff" : getPlayerColor(planet.owner)
        );
      }

      const home = uiManager.getGameManager().getHomeCoords();
      if (home) {
        const point = worldToMap(home.x, home.y, radius);
        paintDot(ctx, point.x, point.y, 6, "#ffffff");
      }

      ctx.restore();
    };

    const drawViewport = (ctx: CanvasRenderingContext2D) => {
      const radius = radiusRef.current;
      if (radius <= 0) return;
      let viewport: Viewport;
      try {
        viewport = Viewport.getInstance();
      } catch {
        return;
      }
      const topLeft = viewport.canvasToWorldCoords({ x: 0, y: 0 });
      const origin = worldToMap(topLeft.x, topLeft.y, radius);
      let w = worldDistToMap(viewport.widthInWorldUnits, radius);
      let h = worldDistToMap(viewport.heightInWorldUnits, radius);
      let x = origin.x;
      let y = origin.y;
      const minSize = 4;
      if (w < minSize) {
        x -= (minSize - w) / 2;
        w = minSize;
      }
      if (h < minSize) {
        y -= (minSize - h) / 2;
        h = minSize;
      }
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.strokeStyle = "#f4f4f4";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ensureSize(canvas, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
      ctx.drawImage(terrain, 0, 0, MAP_SIZE, MAP_SIZE);

      if (now - lastMarkerRefresh > MARKER_REFRESH_MS) {
        const radius = uiManager.getWorldRadius();
        if (radius > 0 && radius !== radiusRef.current) requestTerrain();
        rebuildMarkers();
        lastMarkerRefresh = now;
      }

      ctx.drawImage(markers, 0, 0, MAP_SIZE, MAP_SIZE);
      if (radiusRef.current > 0) strokeWorld(ctx);
      drawViewport(ctx);
    };

    const panFromEvent = (event: PointerEvent) => {
      const radius = radiusRef.current;
      if (radius <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * MAP_SIZE;
      const py = ((event.clientY - rect.top) / rect.height) * MAP_SIZE;
      const world = mapToWorld(px, py, radius);
      if (world.x * world.x + world.y * world.y > radius * radius) return;
      try {
        Viewport.getInstance().centerCoords(world);
      } catch {
        // Viewport is created with the game canvas.
      }
    };

    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      panFromEvent(event);
      canvas.style.cursor = "grabbing";
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer can already be gone if the event was not a live drag.
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      panFromEvent(event);
    };
    const endDrag = () => {
      dragging = false;
      canvas.style.cursor = "pointer";
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      try {
        const viewport = Viewport.getInstance();
        // Scale the camera around its own center, so the rectangle drawn on
        // the mini map grows or shrinks without sliding to another point.
        viewport.zoomAt(event.deltaY, viewport.getViewportPosition());
      } catch {
        // Viewport is created with the game canvas.
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const colorSub = settingChanged$.subscribe((setting) => {
      if ((COLOR_SETTINGS as readonly string[]).includes(setting)) {
        paintTerrain();
      }
    });

    requestTerrain();
    rebuildMarkers();
    lastMarkerRefresh = performance.now();
    frame = requestAnimationFrame(draw);

    return () => {
      alive = false;
      jobId += 1;
      worker?.terminate();
      cancelAnimationFrame(frame);
      colorSub.unsubscribe();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [uiManager]);

  return (
    <Frame>
      <MapCanvas
        ref={canvasRef}
        aria-label="Mini map. Click or drag to move the view. Scroll to zoom the view."
      />
    </Frame>
  );
}

const Frame = styled.div`
  line-height: 0;
  background: #000;
  border: 1px solid ${dfstyles.colors.borderDark};
  ${dfstyles.prefabs.noselect};
`;

const MapCanvas = styled.canvas`
  width: ${MAP_SIZE}px;
  height: ${MAP_SIZE}px;
  display: block;
  cursor: pointer;
  touch-action: none;
`;
