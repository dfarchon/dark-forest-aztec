import React, { useEffect, useRef, useState } from "react";

import type { DockPhase, PageId, StepId } from "./guideTypes";
const PANEL_WIDTH = 320;
const PANEL_VISIBLE_MARGIN = 48;
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

export function useGuideWindow(
  page: PageId,
  stepId: StepId | null,
  phase: DockPhase
) {
  const panelRef = useRef<HTMLElement | null>(null);
  const dragOrigin = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [position, setPosition] = useState({ x: 56, y: 52 });
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
    const keepVisible = () =>
      setPosition((pos) =>
        clampPosition(pos.x, pos.y, panelRef.current?.parentElement ?? null)
      );
    keepVisible();
    window.addEventListener("resize", keepVisible);
    return () => window.removeEventListener("resize", keepVisible);
  }, []);

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

  return {
    panelRef,
    position,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
  };
}
