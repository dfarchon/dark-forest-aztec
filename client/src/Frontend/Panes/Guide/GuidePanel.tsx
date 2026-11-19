import React from "react";

import { Btn } from "../../Components/Btn";
import {
  chapterSteps,
  isPageFinale,
  isTask,
  type PageId,
  type StepId,
  TASK_ORDER,
  type TaskId,
} from "./guideChapters";
import { CoverCopy, PlayCopy } from "./GuideIntro";
import {
  Body,
  BrightAction,
  CompleteCelebration,
  Dock,
  DockStatus,
  DragBar,
  PageNav,
  Panel,
  ScrollHint,
  StepButton,
  StepList,
} from "./guidePanelStyles";
import { PAGE_HOLD_MS } from "./guideTypes";
import type { GuideController } from "./useGuideController";
function pageTitle(page: PageId): string {
  if (!isTask(page)) return page === "cover" ? "Visitor guide" : "You can play";
  return `Page ${TASK_ORDER.indexOf(page) + 1} / ${TASK_ORDER.length}`;
}

function firstStep(page: PageId): StepId | null {
  return chapterSteps(page)[0] ?? null;
}

export function GuidePanel({
  controller,
  onClose,
}: {
  controller: GuideController;
  onClose: () => void;
}) {
  const {
    panelRef,
    position,
    panelMaxHeight,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    resetToCover,
    page,
    open,
    taskPage,
    TaskIntro,
    stepId,
    step,
    phase,
    pageCountdown,
    dockText,
    shipUnavailable,
    runAssist,
    previous,
    next,
    navLocked,
  } = controller;
  return (
    <Panel
      ref={panelRef}
      role="region"
      aria-label="Guide"
      data-guide-panel
      style={{
        left: position.x,
        top: position.y,
        maxHeight: panelMaxHeight ?? `calc(100% - ${position.y}px - 16px)`,
      }}
    >
      <DragBar
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
      >
        <span>{pageTitle(page)}</span>
        <div>
          <Btn size="small" onClick={resetToCover}>
            Back to start
          </Btn>
          <Btn size="small" onClick={onClose}>
            Close guide
          </Btn>
        </div>
      </DragBar>
      <Body data-guide-body>
        {page === "cover" && (
          <CoverCopy onStart={() => open("planet", "zoom")} />
        )}
        {page === "play" && (
          <>
            <PlayCopy />
            <BrightAction>
              <Btn size="stretch" onClick={onClose}>
                Start playing
              </Btn>
            </BrightAction>
          </>
        )}
        {taskPage && TaskIntro && stepId && (
          <>
            <TaskIntro />
            <StepList>
              {taskPage.steps.map((id, index) => (
                <li key={id}>
                  <StepButton
                    type="button"
                    tabIndex={-1}
                    data-guide-step={id}
                    aria-current={id === stepId ? "step" : undefined}
                    $current={id === stepId}
                    onClick={() => open(page, id)}
                  >
                    {index + 1}. {taskPage.copy[id]!.label}
                  </StepButton>
                </li>
              ))}
            </StepList>
          </>
        )}
        {taskPage && step && (
          <Dock data-guide-current-step={stepId}>
            {phase === "waiting" &&
              (stepId === "zoom" || stepId === "zoomIn") && (
                <ScrollHint>
                  <span aria-hidden="true">
                    {stepId === "zoom" ? "↓" : "↑"}
                  </span>
                  {stepId === "zoom"
                    ? "Scroll down to zoom out"
                    : "Scroll up to zoom in"}
                </ScrollHint>
              )}
            {stepId && phase === "done" && isPageFinale(page, stepId) && (
              <CompleteCelebration>
                <span aria-hidden="true" />
                <div>
                  <div>
                    Page {TASK_ORDER.indexOf(page as TaskId) + 1} complete.
                  </div>
                  <div>
                    {page === TASK_ORDER[TASK_ORDER.length - 1]
                      ? "Finishing in"
                      : "Next page in"}{" "}
                    {pageCountdown ?? PAGE_HOLD_MS / 1000}s.
                  </div>
                </div>
              </CompleteCelebration>
            )}
            <DockStatus $done={phase === "done"}>{dockText}</DockStatus>
            {phase === "waiting" && (
              <BrightAction>
                <p>
                  {shipUnavailable
                    ? "This exercise needs an available ship:"
                    : (step.assistLead ?? "We can do this part:")}
                </p>
                <Btn size="stretch" onClick={runAssist}>
                  {shipUnavailable ? "Skip ship exercise" : step.button}
                </Btn>
              </BrightAction>
            )}
          </Dock>
        )}
        {(previous || (next && page !== "cover")) && (
          <PageNav>
            {previous ? (
              <Btn
                disabled={navLocked}
                onClick={() => open(previous, firstStep(previous))}
              >
                Previous
              </Btn>
            ) : (
              <span />
            )}
            {next && page !== "cover" ? (
              <Btn
                disabled={navLocked}
                onClick={() => open(next, firstStep(next))}
              >
                Next
              </Btn>
            ) : (
              <span />
            )}
          </PageNav>
        )}
      </Body>
    </Panel>
  );
}
