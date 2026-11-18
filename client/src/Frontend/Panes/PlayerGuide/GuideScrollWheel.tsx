import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import styled, { keyframes } from "styled-components";

import dfstyles from "../../Styles/dfstyles";
import { DFZIndex } from "../../Utils/constants";

const scroll = keyframes`
  0% { transform: translateY(-4px); opacity: 0; }
  25%, 60% { opacity: 1; }
  100% { transform: translateY(8px); opacity: 0; }
`;

const Hint = styled.div<{ $up: boolean }>`
  position: fixed;
  width: 112px;
  height: 176px;
  z-index: ${DFZIndex.Tooltip + 1};
  pointer-events: none;
  color: ${dfstyles.colors.dfpink};
  text-align: center;
  line-height: 1.35;
  text-shadow: 0 1px 3px ${dfstyles.colors.background};

  svg {
    display: block;
    width: 80px;
    height: 136px;
    margin: 0 auto 4px;
  }
  .wheel-motion,
  .arrows {
    animation: ${scroll} 1.25s ease-in-out infinite;
    animation-direction: ${({ $up }) => ($up ? "reverse" : "normal")};
  }
  small {
    display: block;
    color: ${dfstyles.colors.text};
  }
  @media (prefers-reduced-motion: reduce) {
    .wheel-motion,
    .arrows {
      animation: none;
    }
  }
`;

/** A stationary wheel cue beside the lesson, never a moving pointer. */
export function GuideScrollWheel({
  panelRef,
  anchor,
  direction,
}: {
  panelRef: { readonly current: HTMLElement | null };
  anchor: { x: number; y: number };
  direction: "up" | "down";
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      const rect = panel.getBoundingClientRect();
      const width = 112,
        height = 176,
        gap = 24,
        margin = 12;
      const y = Math.max(
        margin,
        Math.min(
          window.innerHeight - height - margin,
          rect.top + rect.height / 2 - height / 2
        )
      );
      let next: { x: number; y: number } | null = null;
      if (rect.right + gap + width <= window.innerWidth - margin)
        next = { x: rect.right + gap, y };
      else if (rect.left - gap - width >= margin)
        next = { x: rect.left - gap - width, y };
      else if (rect.bottom + gap + height <= window.innerHeight - margin)
        next = { x: Math.max(margin, rect.left), y: rect.bottom + gap };
      setPoint((previous) =>
        previous?.x === next?.x && previous?.y === next?.y ? previous : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [panelRef, anchor.x, anchor.y, direction]);
  if (!point) return null;
  const up = direction === "up";
  return createPortal(
    <Hint
      $up={up}
      style={{ left: point.x, top: point.y }}
      role="img"
      aria-label={up ? "Scroll up to zoom in" : "Scroll down to zoom out"}
      data-guide-scroll-wheel={direction}
    >
      <svg
        viewBox="0 0 80 142"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect
          x="14"
          y="7"
          width="52"
          height="88"
          rx="26"
          fill={dfstyles.colors.background}
          fillOpacity="0.7"
        />
        <path d="M40 8V18M40 47V55" opacity="0.5" />
        <rect x="33" y="21" width="14" height="23" rx="7" />
        <path className="wheel-motion" d="M40 27V32" strokeWidth="4" />
        <g className="arrows">
          <g transform={up ? "rotate(180 40 119)" : undefined}>
            <path d="M29 108L40 118L51 108M29 120L40 130L51 120" />
          </g>
        </g>
      </svg>
      {up ? "Scroll up" : "Scroll down"}
      <small>{up ? "Zoom in" : "Zoom out"}</small>
    </Hint>,
    document.body
  );
}
