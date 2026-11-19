import type { WorldCoords } from "@dfpunk/types";

import type GameUIManager from "../../../Backend/GameLogic/GameUIManager";
import type { StepId, TaskId } from "./guideChapters";
export type { PageId, StepId, TaskId } from "./guideChapters";
export type DockPhase = "waiting" | "demonstrating" | "running" | "done";
export const SEND_PERCENT = 50;
export const SLIDER_ASIDE = 10;
export const PAGE_HOLD_MS = 3000;
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
  mapTarget?: WorldCoords;
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
