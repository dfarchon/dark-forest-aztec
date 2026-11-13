import React, { useEffect, useRef } from "react";
import styled from "styled-components";

const GLYPHS = ".,·:;-=+*%#@&";
const CELL_WIDTH = 14 * 0.62;
const CELL_HEIGHT = 14 * 1.05;

const LAYERS = [
  { speed: 0.025, scale: 1.8, seed: 0, threshold: 0.4, alpha: 0.55 },
  { speed: 0.05, scale: 2.4, seed: 50, threshold: 0.36, alpha: 0.7 },
  { speed: 0.09, scale: 3.2, seed: 100, threshold: 0.33, alpha: 0.85 },
  { speed: 0.15, scale: 4.5, seed: 170, threshold: 0.3, alpha: 1 },
] as const;

const PERMUTATION = buildPermutation();

function buildPermutation(): Uint8Array {
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  for (let i = 255; i > 0; i--) {
    const swap = (i * 7919 + 1) & 255;
    const value = source[i];
    source[i] = source[swap];
    source[swap] = value;
  }

  const table = new Uint8Array(512);
  for (let i = 0; i < 512; i++) table[i] = source[i & 255];
  return table;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  return (h < 2 ? x : -x) + (h === 0 || h === 3 ? y : -y);
}

function noise2(x: number, y: number): number {
  const x0 = Math.floor(x) & 255;
  const y0 = Math.floor(y) & 255;
  const dx = x - Math.floor(x);
  const dy = y - Math.floor(y);
  const u = fade(dx);
  const v = fade(dy);
  const aa = PERMUTATION[PERMUTATION[x0] + y0];
  const ab = PERMUTATION[PERMUTATION[x0] + y0 + 1];
  const ba = PERMUTATION[PERMUTATION[x0 + 1] + y0];
  const bb = PERMUTATION[PERMUTATION[x0 + 1] + y0 + 1];
  return lerp(
    lerp(grad(aa, dx, dy), grad(ba, dx - 1, dy), u),
    lerp(grad(ab, dx, dy - 1), grad(bb, dx - 1, dy - 1), u),
    v
  );
}

function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise2(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / norm;
}

function glyph(density: number): string {
  const index = Math.min(Math.floor(density * 12), 12);
  return GLYPHS[index];
}

const Field = styled.canvas`
  position: fixed;
  top: 0;
  left: 0;
  z-index: -1;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  background: #000;
`;

export function AsciiFieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const influenceRef = useRef(new Float32Array(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const onMove = (event: MouseEvent) => {
      mouseRef.current.x = event.clientX;
      mouseRef.current.y = event.clientY;
    };
    window.addEventListener("mousemove", onMove);

    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / CELL_WIDTH) + 1;
      rows = Math.ceil(height / CELL_HEIGHT) + 1;
      influenceRef.current = new Float32Array(cols * rows);
    };
    resize();
    window.addEventListener("resize", resize);

    let prevX = mouseRef.current.x;
    let prevY = mouseRef.current.y;
    let frame = 0;

    const draw = (time: number) => {
      const seconds = time * 0.001;
      const mouseX = mouseRef.current.x;
      const mouseY = mouseRef.current.y;
      const dx = mouseX - prevX;
      const dy = mouseY - prevY;
      const influence = influenceRef.current;

      if (dx * dx + dy * dy > 1) {
        const cellX = Math.round(mouseX / CELL_WIDTH);
        const cellY = Math.round(mouseY / CELL_HEIGHT);
        const x0 = Math.max(0, cellX - 6);
        const x1 = Math.min(cols - 1, cellX + 6);
        const y0 = Math.max(0, cellY - 6);
        const y1 = Math.min(rows - 1, cellY + 6);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const ox = x - cellX;
            const oy = y - cellY;
            const dist2 = ox * ox + oy * oy;
            if (dist2 < 36) {
              const falloff = 1 - dist2 / 36;
              const index = y * cols + x;
              influence[index] = Math.min(
                1,
                Math.max(influence[index], falloff * falloff)
              );
            }
          }
        }
        prevX = mouseX;
        prevY = mouseY;
      }

      for (let i = 0; i < influence.length; i++) influence[i] *= 0.985;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.font = "14px monospace";
      ctx.textBaseline = "top";

      const originX = cols * 0.5;
      const originY = rows * 0.4;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const nx = (x - originX) / originX;
          const ny = (y - originY) / originY;
          const radius = Math.sqrt(nx * nx + ny * ny);
          const angle = Math.atan2(ny, nx);

          let density = 0;
          let layerAlpha = 0;
          let brightness = 0.5;

          for (let i = 0; i < LAYERS.length; i++) {
            const layer = LAYERS[i];
            const radial =
              Math.log(radius + 0.05) * layer.scale - seconds * layer.speed;
            const angular = angle * 3.5 + layer.seed;
            const sample = radial + layer.seed * 0.1;
            const value =
              (fbm(angular, sample, 4) + 1) *
              0.5 *
              (1 - Math.exp(-radius * 2.5));
            if (value > layer.threshold) {
              const t = (value - layer.threshold) / (1 - layer.threshold);
              const smooth = t * t * (3 - 2 * t);
              if (smooth > density) {
                density = smooth;
                layerAlpha = layer.alpha;
                brightness =
                  0.45 +
                  (fbm(angular * 0.5 + 20, sample * 0.5 + 20, 2) + 1) *
                    0.5 *
                    0.55;
              }
            }
          }

          const base =
            (fbm(
              angle * 2 + 7,
              Math.log(radius + 0.1) * 2 - seconds * 0.03 + 7,
              3
            ) +
              1) *
            0.5;
          let ink = Math.max(base * 0.35, density);
          const wipe = influence[y * cols + x];
          if (wipe > 0.001) ink *= 1 - wipe * 0.85;

          const shade = 0.5 + ink * brightness * 0.5;
          let red = Math.round(lerp(240, 255, shade));
          let green = Math.round(lerp(180, 220, shade));
          let blue = Math.round(lerp(210, 245, shade));
          let alpha =
            density > 0.01 ? lerp(0.5, layerAlpha, density) : 0.3 + base * 0.3;

          if (wipe > 0.001) {
            red = Math.round(lerp(red, 160, wipe * 0.5));
            green = Math.round(lerp(green, 235, wipe * 0.5));
            blue = Math.round(lerp(blue, 255, wipe * 0.5));
            alpha = Math.min(1, alpha + wipe * 0.3);
          }

          ctx.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
          ctx.fillText(glyph(ink), x * CELL_WIDTH, y * CELL_HEIGHT);
        }
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <Field ref={canvasRef} aria-hidden />;
}
