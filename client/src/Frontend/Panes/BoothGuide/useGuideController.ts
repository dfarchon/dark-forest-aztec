import { Setting } from "@dfpunk/types";
import { useEffect, useRef, useState } from "react";

import Viewport from "../../Game/Viewport";
import { useUIManager } from "../../Utils/AppHooks";
import { useSetting } from "../../Utils/SettingsHooks";
import { GuideAssistGate, needsGuideMouse } from "./guideAssist";
import { type CameraMotion, playGuideCamera } from "./guideCamera";
import {
  following,
  isPageFinale,
  isTask,
  PAGE_ORDER,
  type PageId,
  type StepId,
  type TaskId,
} from "./guideChapters";
import { moveGuideFrame } from "./guideEnergy";
import { STEPS, TASK_PAGES } from "./guidePages";
import { clearLocalControls } from "./guidePlanets";
import { GuidePointerSequence } from "./guidePointerSequence";
import { guideShip, guideShipLesson } from "./guideShip";
import { terminalGuide } from "./guideTerminal";
import { type DockPhase, PAGE_HOLD_MS, type ViewFrame } from "./guideTypes";
import {
  coordsFrame,
  homeRestFrame,
  minerAlreadyFramed,
  minerCenterFrame,
} from "./guideWorld";
import { useGuideWindow } from "./useGuideWindow";
const QUICK_ADVANCE_MS = 350;
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

function playDampedReturn(target: ViewFrame, onReady?: () => void): () => void {
  return playGuideCamera(Viewport.getInstance(), target, "return", onReady);
}

function playMinedReveal(target: ViewFrame, onReady?: () => void): () => void {
  return playGuideCamera(Viewport.getInstance(), target, "mined", onReady);
}

export function useGuideController(onComplete: () => void) {
  const uiManager = useUIManager();
  const [terminalReveal] = useSetting(uiManager, Setting.TerminalReveal);
  const [assistGate] = useState(() => new GuideAssistGate());
  const [assistId, setAssistId] = useState<number | null>(null);
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

  const panelWindow = useGuideWindow(page, stepId, phase);
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
    if (page === "play" && !reportedComplete.current) {
      reportedComplete.current = true;
      completeRef.current();
    }
  }, [page]);

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
    const returningHome =
      page === "review" && pageAtEntry.current === "controls";
    pageAtEntry.current = page;
    const preserveMoveSelection =
      page === "move" && stepId !== "selectMovePlanet";
    clearLocalControls(
      uiManager,
      preserveMoveSelection ||
        (page === "ships" && stepId !== "selectShipPlanet")
    );
    if (!keepReveal) {
      if (page === "cover" || returningHome) {
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

  const onAssistComplete = () => {
    if (
      !stepId ||
      !isTask(page) ||
      phaseRef.current !== "demonstrating" ||
      !assistGate.complete(assistId!, entryRef.current)
    )
      return;
    executeAssist(entryRef.current, stepId, page);
  };

  return {
    ...panelWindow,
    page,
    stepId,
    phase,
    uiManager,
    entry,
    assistId,
    pointerSequence,
    pointerReadyEntry,
    onAssistComplete,
    resetToCover,
    open,
    taskPage,
    TaskIntro,
    step,
    pageCountdown,
    dockText,
    shipUnavailable,
    runAssist,
    previous,
    next,
    navLocked,
  };
}
export type GuideController = ReturnType<typeof useGuideController>;
