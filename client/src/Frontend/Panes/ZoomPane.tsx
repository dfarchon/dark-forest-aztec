import React from "react";
import styled from "styled-components";

import { LongDash } from "../Components/Text";
import dfstyles from "../Styles/dfstyles";
import { DFZIndex } from "../Utils/constants";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";

const StyledZoomPane = styled.div`
  z-index: ${DFZIndex.MenuBar};
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 4px;
  font-size: 1.5em;
  line-height: 1;
  color: ${dfstyles.colors.subtext};

  & > button {
    all: unset;
    line-height: 1;
    cursor: pointer;
    user-select: none;
    background: transparent;
    -webkit-tap-highlight-color: transparent;

    &:first-child {
      margin-right: 0.75em;
    }

    &:hover {
      color: ${dfstyles.colors.text};
    }

    &:active {
      color: ${dfstyles.colors.subbertext};
    }

    &:focus,
    &:focus-visible {
      outline: none;
      box-shadow: none;
      background: transparent;
    }

    &::selection {
      background: transparent;
    }
  }
`;

function preventFocusOnMouseDown(e: React.MouseEvent<HTMLButtonElement>) {
  e.preventDefault();
}

export function ZoomPane() {
  const uiEmitter = UIEmitter.getInstance();
  return (
    <StyledZoomPane>
      <button
        type="button"
        onMouseDown={preventFocusOnMouseDown}
        onClick={() => uiEmitter.emit(UIEmitterEvent.ZoomOut)}
      >
        <LongDash />
      </button>
      <button
        type="button"
        onMouseDown={preventFocusOnMouseDown}
        onClick={() => uiEmitter.emit(UIEmitterEvent.ZoomIn)}
      >
        +
      </button>
    </StyledZoomPane>
  );
}
