import type { WorldCoords } from "@dfpunk/types";
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styled, { keyframes } from "styled-components";

import dfstyles from "../../Styles/dfstyles";
import { DFZIndex } from "../../Utils/constants";
import {
  type GuidePoint,
  type GuidePointerFrame,
  type GuidePointerPose,
  sampleGuidePointer,
} from "./guidePointerMotion";

const ACCENT = dfstyles.colors.dfpink;

const rippleAnim = keyframes`
  0%, 42% { opacity: 0; transform: scale(0.3); }
  60% { opacity: 0.85; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.8); }
`;

const chevronDown = keyframes`
  0%, 100% { transform: translateY(0); opacity: 0.4; }
  50% { transform: translateY(10px); opacity: 1; }
`;

const chevronUp = keyframes`
  0%, 100% { transform: translateY(0); opacity: 0.4; }
  50% { transform: translateY(-10px); opacity: 1; }
`;

const Layer = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${DFZIndex.Tooltip + 1};
  overflow: visible;
  pointer-events: none;
  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
    }
  }
`;

const Cursor = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  will-change: transform;
`;

const Shift = styled.div`
  position: relative;
  transform-origin: 0 0;
  width: 0;
  height: 0;
`;

const Pointer = styled.svg`
  display: block;
  overflow: visible;
  filter: drop-shadow(0 0 10px ${ACCENT})
    drop-shadow(0 2px 2px rgba(0, 0, 0, 0.55));
`;

const Ripple = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border: 2px solid ${ACCENT};
  border-radius: 50%;

  ${Shift}[data-gesture='click'] & {
    display: block;
    animation: ${rippleAnim} 1.35s ease-out infinite;
  }
`;

const Chevrons = styled.div`
  position: absolute;
  top: 3px;
  left: 59px;
  display: none;

  svg {
    display: block;
  }

  &[data-dir="up"] svg {
    transform: rotate(180deg);
  }

  &[data-dir="down"] {
    animation: ${chevronDown} 0.9s ease-in-out infinite;
  }

  &[data-dir="up"] {
    animation: ${chevronUp} 0.9s ease-in-out infinite;
  }

  ${Shift}[data-gesture='scroll'] & {
    display: block;
  }
`;

export type GuidePointerProps = {
  animationKey: string;
  origin: () => GuidePoint | null;
  pose: () => GuidePointerPose;
  onFrame?: (frame: GuidePointerFrame) => void;
  onEndpoint?: (point: GuidePoint) => void;
  onComplete?: (mapTarget?: WorldCoords) => void;
};

/** Shared visual layer. It never synthesizes DOM clicks or slider input. */
export function GuidePointer(props: GuidePointerProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const cursorRef = useRef<HTMLDivElement>(null);
  const shiftRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<SVGSVGElement>(null);
  const chevronRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cursor = cursorRef.current,
      shift = shiftRef.current;
    const pointer = pointerRef.current,
      chevrons = chevronRef.current;
    if (!cursor || !shift || !pointer || !chevrons) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      clockKey = "",
      clockStart = 0,
      lastCycle = -1;
    let reported = false;
    let lastPoint: GuidePoint | null = null;
    let travelFrom: GuidePoint | null = null;
    const reset = () => {
      clockKey = "";
    };
    const tick = (now: number) => {
      if (document.hidden) {
        cursor.style.visibility = "hidden";
        reset();
        frame = requestAnimationFrame(tick);
        return;
      }
      const current = propsRef.current;
      let pose: GuidePointerPose = { kind: "hide" };
      let origin: GuidePoint | null = null;
      try {
        pose = current.pose();
        origin = current.origin();
      } catch {
        /* Target not ready. */
      }
      const mapTarget = pose.kind === "click" ? pose.mapTarget : undefined;
      const mapKey =
        pose.kind === "click" && mapTarget
          ? [
              mapTarget.x,
              mapTarget.y,
              Math.round(pose.at.x),
              Math.round(pose.at.y),
            ].join(",")
          : "";
      const key = `${current.animationKey}:${pose.kind}:${mapKey}:${pose.kind === "drag" ? (pose.thenScroll ?? "") : ""}`;
      if (key !== clockKey) {
        travelFrom = mapKey ? lastPoint : null;
        clockKey = key;
        clockStart = now;
        lastCycle = -1;
      }
      const sample = sampleGuidePointer(
        pose,
        travelFrom ?? origin,
        now - clockStart,
        reduced.matches
      );
      if (sample.cycle !== lastCycle) {
        lastCycle = sample.cycle;
        reported = false;
      }
      if (!sample.at || sample.opacity <= 0) {
        cursor.style.visibility = "hidden";
      } else {
        const at = sample.at;
        lastPoint = at;
        cursor.style.visibility = "visible";
        cursor.style.opacity = String(sample.opacity);
        cursor.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
        shift.dataset.gesture = sample.gesture;
        shift.style.transform = sample.pressed ? "scale(0.94)" : "none";
        chevrons.dataset.dir = sample.direction;
        const flipX = at.x + 69 > window.innerWidth - 8,
          flipY = at.y + 96 > window.innerHeight - 8;
        pointer.style.transformOrigin = "0 0";
        pointer.style.transform = `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
        chevrons.style.left = flipX ? "-32px" : "59px";
      }
      if (sample.at && sample.opacity > 0) current.onEndpoint?.(sample.at);
      current.onFrame?.(sample);
      if (sample.complete && !reported) {
        reported = true;
        current.onComplete?.(mapTarget);
      }
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", reset);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);

  return createPortal(
    <Layer aria-hidden="true">
      <Cursor ref={cursorRef} data-guide-pointer>
        <Shift ref={shiftRef}>
          <Pointer ref={pointerRef} viewBox="0 0 64 92" width="62" height="88">
            <path
              d="M1 1 L1 62 L16 48 L30 84 L42 78 L28 43 L52 43 Z"
              fill={ACCENT}
              stroke="#1a1014"
              strokeWidth="3"
              strokeLinejoin="miter"
            />
          </Pointer>
          <Ripple />
          <Chevrons ref={chevronRef}>
            <svg viewBox="0 0 24 32" width="22" height="29">
              <path
                d="M4 4 L12 13 L20 4"
                fill="none"
                stroke={ACCENT}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 16 L12 25 L20 16"
                fill="none"
                stroke={ACCENT}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Chevrons>
        </Shift>
      </Cursor>
    </Layer>,
    document.body
  );
}
