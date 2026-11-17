import { Setting } from "@dfpunk/types";
import React, {
  Dispatch,
  SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import styled, { css } from "styled-components";

import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { useSetting } from "../Utils/SettingsHooks";
import { TerminalRevealController } from "../Utils/terminalReveal";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";

export const enum InitRenderState {
  NONE,
  LOADING,
  COMPLETE,
}

type LandingWrapperProps = {
  children: React.ReactNode;
  initRender: InitRenderState;
  terminalEnabled: boolean;
};

const StyledWrapper = styled.div<{
  initRender: InitRenderState;
}>`
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  position: relative;
  background: ${dfstyles.colors.background};

  justify-content: ${(props) =>
    props.initRender !== InitRenderState.NONE
      ? "space-between"
      : "space-around"};
`;

export function Wrapper({ children, initRender }: LandingWrapperProps) {
  return <StyledWrapper initRender={initRender}>{children}</StyledWrapper>;
}

const STWInit = css`
  position: absolute;
  box-sizing: border-box;
  width: ${dfstyles.game.terminalWidth};
  right: 0;
  /* Above the mini map. Coordinates sit beside the map, not over this column. */
  top: 0.6em;
  bottom: 200px;
  height: auto;
  max-height: none;
  padding: 0.4em 0 0.4em 0.6em;
  font-size: ${dfstyles.game.terminalFontSize};
  background: transparent;
  pointer-events: none;
  z-index: 20;

  & * {
    pointer-events: none !important;
  }

  color: ${dfstyles.colors.text};
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  --df-terminal-ink: ${dfstyles.colors.text};
  --df-terminal-ink-dim: ${dfstyles.colors.text};

  .startup-status {
    background: transparent;
    border-top: none;
    color: ${dfstyles.colors.text};
  }
`;

const STWNoInit = css`
  max-width: 60em;
  width: 60%;
  padding: 2em 0;
  font-size: ${dfstyles.fontSizeS};
`;

const StyledTerminalWrapper = styled.div<{
  initRender: InitRenderState;
  terminalEnabled: boolean;
  $universeView: boolean;
}>`
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100vh;
  overflow: hidden;
  background: ${dfstyles.colors.background};
  position: relative;

  ${(props) =>
    props.initRender !== InitRenderState.NONE ? STWInit : STWNoInit};

  ${({ initRender, terminalEnabled, $universeView }) =>
    initRender !== InitRenderState.NONE &&
    css`
      /* Must win over the base height: 100%, or the log scrolls below the page. */
      height: auto;
      min-height: 0;
      transform: translateX(${terminalEnabled ? "0" : "100%"});
      opacity: ${$universeView ? 0 : 1};
      ${$universeView ? "pointer-events: none;" : ""}
      transition:
        transform 0.4s cubic-bezier(0.22, 1.2, 0.36, 1),
        opacity 0.3s ease;
    `}

  @media (max-width: 660px) {
    ${(props) =>
      props.initRender === InitRenderState.NONE
        ? css`
            width: 100%;
            padding: 1.5em 2em;
          `
        : css`
            width: min(${dfstyles.game.terminalWidth}, 46vw);
            padding: 0.4em 0 0.4em 0.5em;
          `}
  }
`;

export function TerminalWrapper({
  children,
  initRender,
  terminalEnabled,
  universeView = false,
}: LandingWrapperProps & { universeView?: boolean }) {
  return (
    <StyledTerminalWrapper
      data-guide-obstacle={
        terminalEnabled && initRender !== InitRenderState.NONE && !universeView
          ? true
          : undefined
      }
      initRender={initRender}
      terminalEnabled={terminalEnabled}
      $universeView={universeView}
    >
      {children}
    </StyledTerminalWrapper>
  );
}

const revealTerminalStatus = css`
  &:hover > [data-terminal-status],
  &:focus-within > [data-terminal-status],
  &[data-guide-active] > [data-terminal-status] {
    transform: translate(0, -50%);
    border-color: ${dfstyles.colors.dfpink};
    color: ${dfstyles.colors.dfpink};
    background: ${dfstyles.colors.backgrounddark};
  }
`;

const StyledTerminalToggler = styled.div<{
  initRender: InitRenderState;
}>`
  position: fixed;
  right: 0;
  top: 0.6em;
  bottom: 200px;
  height: auto;
  width: 1.3em;

  background: transparent;
  z-index: 1000;

  color: ${dfstyles.colors.text};

  display: ${({ initRender }) =>
    initRender !== InitRenderState.NONE ? "flex" : "none"};
  flex-direction: column;
  justify-content: center;
  align-items: center;

  &:hover {
    background: rgba(255, 180, 193, 0.15);
    cursor: pointer;
  }

  &[data-guide-active] {
    background: ${dfstyles.colors.dfpink};
  }

  ${revealTerminalStatus}
`;

const TerminalStatusBadge = styled.button<{ $open: boolean }>`
  position: absolute;
  right: 0;
  top: 50%;
  /* Leave an 8px handle visible at the viewport edge. */
  transform: translate(24px, -50%);
  width: 32px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
  appearance: none;
  cursor: pointer;
  border: 1px solid
    ${({ $open }) =>
      $open ? dfstyles.colors.dfpink : dfstyles.colors.borderDark};
  border-right: 0;
  border-radius: 6px 0 0 6px;
  background: ${dfstyles.colors.background};
  color: ${({ $open }) =>
    $open ? dfstyles.colors.dfpink : dfstyles.colors.text};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 150ms ease,
    color 150ms ease,
    background 150ms ease;

  svg {
    width: 24px;
    height: 24px;
  }

  &:focus-visible {
    outline: 2px solid ${dfstyles.colors.dfpink};
    outline-offset: -3px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

function TerminalStatusIcon({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <TerminalStatusBadge
      type="button"
      $open={open}
      data-terminal-status
      aria-label={open ? "Hide terminal" : "Show terminal"}
      aria-expanded={open}
      title={`${open ? "Hide" : "Show"} terminal`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="1.5" y="5" width="15" height="14" rx="2" />
        <path d="M2 9h14M5 12l2 2-2 2M10 16h3" />
        <path d={open ? "M20 9l3 3-3 3" : "M23 9l-3 3 3 3"} />
      </svg>
    </TerminalStatusBadge>
  );
}

const EdgeRevealStrip = styled.div<{
  initRender: InitRenderState;
}>`
  position: fixed;
  right: 0;
  top: 0.6em;
  bottom: 200px;
  width: 6px;
  z-index: 1000;
  display: ${({ initRender }) =>
    initRender !== InitRenderState.NONE ? "block" : "none"};
  cursor: pointer;

  &:hover {
    background: rgba(255, 180, 193, 0.15);
  }

  &[data-guide-active] {
    background: ${dfstyles.colors.dfpink};
    box-shadow: 0 0 8px ${dfstyles.colors.dfpink};
  }

  ${revealTerminalStatus}
`;

function EdgeReveal({
  terminalEnabled,
  setTerminalEnabled,
  initRender,
}: {
  terminalEnabled: boolean;
  setTerminalEnabled: Dispatch<SetStateAction<boolean>>;
  initRender: InitRenderState;
}) {
  const reveal = useMemo(
    () =>
      new TerminalRevealController(() => setTerminalEnabled((open) => !open)),
    [setTerminalEnabled]
  );
  useEffect(() => () => reveal.leave(), [reveal]);

  return (
    <EdgeRevealStrip
      data-booth-target="terminal-edge"
      title={`Terminal ${terminalEnabled ? "expanded" : "collapsed"}. Hover the edge or click the icon to ${terminalEnabled ? "hide" : "show"}.`}
      aria-label={`Terminal ${terminalEnabled ? "expanded" : "collapsed"}`}
      initRender={initRender}
      onMouseEnter={reveal.enter}
      onMouseLeave={reveal.leave}
    >
      <TerminalStatusIcon open={terminalEnabled} onClick={reveal.click} />
    </EdgeRevealStrip>
  );
}

export function InGameTerminalChrome({
  terminalEnabled,
  setTerminalEnabled,
  initRender,
  universeView = false,
}: {
  terminalEnabled: boolean;
  setTerminalEnabled: Dispatch<SetStateAction<boolean>>;
  initRender: InitRenderState;
  universeView?: boolean;
}) {
  const uiManager = useUIManager();
  const [reveal] = useSetting(uiManager, Setting.TerminalReveal);
  if (universeView) return null;
  if (reveal === "bar") {
    return (
      <TerminalToggler
        terminalEnabled={terminalEnabled}
        setTerminalEnabled={setTerminalEnabled}
        initRender={initRender}
      />
    );
  }
  return (
    <EdgeReveal
      terminalEnabled={terminalEnabled}
      setTerminalEnabled={setTerminalEnabled}
      initRender={initRender}
    />
  );
}

export function TerminalToggler({
  terminalEnabled,
  setTerminalEnabled,
  initRender,
}: {
  terminalEnabled: boolean;
  setTerminalEnabled: Dispatch<SetStateAction<boolean>>;
  initRender: InitRenderState;
}) {
  const uiEmitter = UIEmitter.getInstance();
  useLayoutEffect(() => {
    uiEmitter.emit(UIEmitterEvent.UIChange);
  }, [terminalEnabled, uiEmitter]);

  return (
    <StyledTerminalToggler
      data-booth-target="terminal-toggle"
      title={`${terminalEnabled ? "Hide" : "Show"} terminal`}
      initRender={initRender}
      onClick={() => setTerminalEnabled((b: boolean): boolean => !b)}
    >
      <TerminalStatusIcon
        open={terminalEnabled}
        onClick={() => setTerminalEnabled((open) => !open)}
      />
    </StyledTerminalToggler>
  );
}

const StyledGameWindowWrapper = styled.div<{
  initRender: InitRenderState;
}>`
  background: ${dfstyles.colors.background};
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;

  display: ${(props) =>
    props.initRender !== InitRenderState.NONE ? "block" : "none"};
`;

export function GameWindowWrapper({
  children,
  initRender,
}: LandingWrapperProps) {
  return (
    <StyledGameWindowWrapper initRender={initRender}>
      {initRender && <>{children}</>}
    </StyledGameWindowWrapper>
  );
}

export const Hidden = styled.div`
  display: none;
  position: absolute;
  top: -10000;
  left: -10000;
`;
