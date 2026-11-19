import type { LocatablePlanet } from "@dfpunk/types";
import React, { useEffect, useRef } from "react";
import styled from "styled-components";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import Viewport from "../../Game/Viewport";
import dfstyles from "../../Styles/dfstyles";
const HaloCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  z-index: 4;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

export function PlanetHalo({
  ui,
  planets,
}: {
  ui: GameUIManager;
  planets: () => LocatablePlanet[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const planetsRef = useRef(planets);
  planetsRef.current = planets;

  useEffect(() => {
    let frame = 0;
    let stopped = false;
    const draw = (now: number) => {
      if (stopped) return;
      const canvas = ref.current;
      if (canvas) {
        const parent = canvas.parentElement;
        const width = parent?.clientWidth ?? 0;
        const height = parent?.clientHeight ?? 0;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx && width > 0 && height > 0) {
          ctx.clearRect(0, 0, width, height);
          const viewport = Viewport.getInstance();
          const pulse = 1.45 + 0.28 * Math.sin(now / 280);
          ctx.strokeStyle = dfstyles.colors.dfpink;
          ctx.lineWidth = 3;
          for (const planet of planetsRef.current()) {
            const point = viewport.worldToCanvasCoords(planet.location.coords);
            const rad = Math.max(
              ui.getRadiusOfPlanetLevel(planet.planetLevel),
              1
            );
            const screenRad = Math.max(viewport.worldToCanvasDist(rad), 10);
            ctx.beginPath();
            ctx.arc(point.x, point.y, screenRad * pulse, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [ui]);

  return <HaloCanvas ref={ref} />;
}
