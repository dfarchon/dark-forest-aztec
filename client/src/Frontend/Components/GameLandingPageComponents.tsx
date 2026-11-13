import { Setting } from "@dfpunk/types";
import React, {
  Dispatch,
  SetStateAction,
  useLayoutEffect,
  useRef,
} from "react";
import styled, { css } from "styled-components";

import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { useSetting } from "../Utils/SettingsHooks";
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
      initRender={initRender}
      terminalEnabled={terminalEnabled}
      $universeView={universeView}
    >
      {children}
    </StyledTerminalWrapper>
  );
}

const StyledTerminalToggler = styled.div<{
  initRender: InitRenderState;
}>`
  position: fixed;
  right: 0;
  top: 0.6em;
  bottom: 200px;
  height: auto;
  width: 1.3em;

  background: ${dfstyles.colors.text};
  z-index: 1000;

  color: ${dfstyles.colors.background};

  display: ${({ initRender }) =>
    initRender !== InitRenderState.NONE ? "flex" : "none"};
  flex-direction: column;
  justify-content: center;
  align-items: center;

  opacity: 0;

  &:hover {
    opacity: 1;
    cursor: pointer;
  }

  & span {
    font-size: 1.25em;
    transform: scaleY(2);
  }
`;

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
`;

function EdgeReveal({
  setTerminalEnabled,
  initRender,
}: {
  setTerminalEnabled: Dispatch<SetStateAction<boolean>>;
  initRender: InitRenderState;
}) {
  const armed = useRef(true);

  return (
    <EdgeRevealStrip
      initRender={initRender}
      onMouseEnter={() => {
        if (!armed.current) return;
        armed.current = false;
        setTerminalEnabled((open) => !open);
      }}
      onMouseLeave={() => {
        armed.current = true;
      }}
    />
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
      initRender={initRender}
      onClick={() => setTerminalEnabled((b: boolean): boolean => !b)}
    >
      <span>{terminalEnabled ? ">" : "<"}</span>
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
