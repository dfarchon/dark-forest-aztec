import styled, { keyframes } from "styled-components";

import dfstyles from "../../Styles/dfstyles";

const PANEL_WIDTH = 320;
export const Panel = styled.aside`
  position: absolute;
  z-index: 10;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: ${PANEL_WIDTH}px;
  padding: 12px;
  background: ${dfstyles.colors.backgroundlighter};
  color: ${dfstyles.colors.text};
  border: 1px solid ${dfstyles.colors.border};
  line-height: 1.45;

  p {
    margin: 0 0 8px;
  }

  ul {
    margin: 0 0 8px;
    padding-left: 1.1em;
  }

  li + li {
    margin-top: 4px;
  }
`;

export const Body = styled.div``;

export const DragBar = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: -12px -12px 12px;
  padding: 8px 12px;
  cursor: grab;
  user-select: none;
  touch-action: none;
  border-bottom: 1px solid ${dfstyles.colors.border};

  &:active {
    cursor: grabbing;
  }

  > div {
    display: flex;
    flex: none;
    gap: 8px;
    white-space: nowrap;
  }

  df-button {
    display: inline-flex;
    flex: none;
  }
`;

export const StepList = styled.ol`
  margin: 0 0 8px;
  padding: 0;
  list-style: none;

  li + li {
    margin-top: 0;
  }
`;

export const StepButton = styled.button<{ $current: boolean }>`
  display: block;
  width: 100%;
  margin: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: ${({ $current }) =>
    $current ? dfstyles.colors.dfgreen : dfstyles.colors.text};
  font: inherit;
  font-weight: ${({ $current }) => ($current ? 600 : 400)};
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  outline: none;

  &:hover {
    text-decoration: underline;
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

export const Dock = styled.div`
  flex: none;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid ${dfstyles.colors.border};
`;

export const ScrollHint = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: ${dfstyles.colors.dfpink};

  span {
    font-size: 24px;
    line-height: 1;
  }
`;

export const DockStatus = styled.p<{ $done: boolean }>`
  color: ${({ $done }) =>
    $done ? dfstyles.colors.dfgreen : dfstyles.colors.text};
  white-space: pre-line;
`;

export const celebrationPulse = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.7);
  }
  30% {
    opacity: 1;
    transform: scale(1.12);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
`;

export const CompleteCelebration = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  color: ${dfstyles.colors.dfpink};
  animation: ${celebrationPulse} 500ms ease-out both;

  span {
    position: relative;
    display: inline-block;
    width: 20px;
    height: 20px;
    flex: none;
    border: 2px solid ${dfstyles.colors.dfpink};
    border-radius: 50%;
    box-shadow: 0 0 8px ${dfstyles.colors.dfpink};
  }
`;

export const BackupAction = styled.div`
  margin-top: 12px;

  df-button {
    width: 100%;
    --df-button-color: ${dfstyles.colors.dfgreen};
    --df-button-border: 1px solid ${dfstyles.colors.dfgreen};
    --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};
  }

  p {
    margin: 8px 0 0;
  }
`;

export const BrightAction = styled.div`
  margin-top: 12px;

  df-button {
    width: 100%;
    --df-button-color: ${dfstyles.colors.dfgreen};
    --df-button-border: 1px solid ${dfstyles.colors.dfgreen};
    --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};
  }
`;

export const PageNav = styled.div`
  display: flex;
  flex: none;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
`;
