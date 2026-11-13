import { SpaceType, WorldCoords } from "@dfpunk/types";
import React, { useState } from "react";
import styled from "styled-components";

import GameUIManager from "../../Backend/GameLogic/GameUIManager";
import dfstyles from "../Styles/dfstyles";
import { useUIManager } from "../Utils/AppHooks";
import { DFZIndex } from "../Utils/constants";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";

class CoordsText extends React.Component<
  {
    uiManager: GameUIManager | undefined;
  },
  never
> {
  private coordsRef = React.createRef<HTMLSpanElement>();
  private spacetypeRef = React.createRef<HTMLSpanElement>();
  private uiEmitter = UIEmitter.getInstance();

  componentDidMount() {
    this.uiEmitter.on(UIEmitterEvent.WorldMouseMove, this.update);
  }

  componentWillUnmount() {
    this.uiEmitter.removeListener(UIEmitterEvent.WorldMouseMove, this.update);
  }

  update = (coords: WorldCoords) => {
    this.setCoords(coords);
    this.setSpacetype(coords);
  };

  setCoords(coords: WorldCoords) {
    if (this.coordsRef.current) {
      this.coordsRef.current.innerText = coords
        ? `(${Math.round(coords.x)}, ${Math.round(coords.y)})`
        : "(x, y)";
    }
  }

  setSpacetype(coords: WorldCoords) {
    let spacetypeText = "???";

    if (this.props.uiManager) {
      const per = this.props.uiManager.getSpaceTypePerlin(coords, false);
      const spaceType = this.props.uiManager.spaceTypeFromPerlin(per);

      let suff = "";
      if (spaceType === SpaceType.NEBULA) suff = "\u00b0 (NEBULA)";
      else if (spaceType === SpaceType.SPACE) suff = "\u00b0 (SPACE)";
      else if (spaceType === SpaceType.DEEP_SPACE) suff = "\u00b0 (DEEP SPACE)";
      else if (spaceType === SpaceType.DEAD_SPACE) suff = "\u00b0 (DEAD SPACE)";

      spacetypeText = `${Math.floor((16 - per) * 16)}${suff}`;
      if (this.spacetypeRef.current) {
        this.spacetypeRef.current.innerText = "TEMP: " + spacetypeText;
      }
    } else if (this.spacetypeRef.current) {
      this.spacetypeRef.current.innerText = "TEMP: " + spacetypeText;
    }
  }

  render() {
    return (
      <>
        <span ref={this.coordsRef}></span>
        <span ref={this.spacetypeRef}></span>
      </>
    );
  }
}

const StyledCoordsPane = styled.div`
  z-index: ${DFZIndex.MenuBar};
  width: max-content;
  min-width: 7em;
  min-height: 1.6em;
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  cursor: pointer;
  white-space: nowrap;
`;

const Content = styled.div<{ $hidden: boolean }>`
  display: ${({ $hidden }) => ($hidden ? "none" : "flex")};
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
`;

const Hint = styled.span`
  color: ${dfstyles.colors.subtext};
  line-height: 1.6em;

  &:hover {
    color: ${dfstyles.colors.text};
  }
`;

export function CoordsPane() {
  const [hovering, setHovering] = useState<boolean>(false);
  const [hidden, setHidden] = useState<boolean>(false);
  // The click that reveals the pane happens while the pointer is still inside.
  // Hold the "Click to hide" line back until the pointer leaves and returns.
  const [suppressHideHint, setSuppressHideHint] = useState<boolean>(false);
  const uiManager = useUIManager();
  const showHideHint = !hidden && hovering && !suppressHideHint;

  return (
    <StyledCoordsPane
      onClick={() => {
        setSuppressHideHint(hidden);
        setHidden((isHidden) => !isHidden);
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        setSuppressHideHint(false);
      }}
    >
      {hidden && hovering && <Hint>Click to show</Hint>}
      {showHideHint && <Hint>Click to hide</Hint>}
      <Content $hidden={hidden || showHideHint}>
        <CoordsText uiManager={uiManager} />
      </Content>
    </StyledCoordsPane>
  );
}
