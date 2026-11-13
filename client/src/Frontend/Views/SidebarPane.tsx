import { ModalName } from "@dfpunk/types";
import React, { useState } from "react";
import styled from "styled-components";

import { Hook } from "../../_types/global/GlobalTypes";
import { BorderlessPane, EmSpacer } from "../Components/CoreUI";
import dfstyles from "../Styles/dfstyles";
import { DFZIndex } from "../Utils/constants";
import {
  TOGGLE_HELP_PANE,
  TOGGLE_PLUGINS_PANE,
  TOGGLE_SETTINGS_PANE,
  TOGGLE_TRANSACTIONS_PANE,
  TOGGLE_YOUR_ARTIFACTS_PANE,
  TOGGLE_YOUR_PLANETS_DEX_PANE,
} from "../Utils/ShortcutConstants";
import { ModalToggleButton } from "./ModalIcon";

export function SidebarPane({
  settingsHook,
  helpHook,
  pluginsHook,
  yourArtifactsHook,
  planetdexHook,
  transactionLogHook,
}: {
  settingsHook: Hook<boolean>;
  helpHook: Hook<boolean>;
  pluginsHook: Hook<boolean>;
  yourArtifactsHook: Hook<boolean>;
  planetdexHook: Hook<boolean>;
  transactionLogHook: Hook<boolean>;
}) {
  const [sidebarHovered, setSidebarHovered] = useState<boolean>(false);

  return (
    <WindowTogglesPaneContainer
      onMouseEnter={() => setSidebarHovered(true)}
      onMouseLeave={() => setSidebarHovered(false)}
    >
      <BorderlessPane
        style={{
          zIndex: sidebarHovered ? DFZIndex.Tooltip : undefined,
          margin: "8px 8px 0 8px",
        }}
      >
        <ToolButtonFrame $active={settingsHook[0]}>
          <ModalToggleButton
            modal={ModalName.Settings}
            hook={settingsHook}
            text={sidebarHovered ? "Settings" : undefined}
            size="stretch"
            shortcutKey={TOGGLE_SETTINGS_PANE}
            shortcutText={sidebarHovered ? TOGGLE_SETTINGS_PANE : undefined}
          />
        </ToolButtonFrame>
        <EmSpacer height={0.5} />
        <ToolButtonFrame $active={helpHook[0]}>
          <ModalToggleButton
            modal={ModalName.Help}
            hook={helpHook}
            text={sidebarHovered ? "Help" : undefined}
            size="stretch"
            shortcutKey={TOGGLE_HELP_PANE}
            shortcutText={sidebarHovered ? TOGGLE_HELP_PANE : undefined}
          />
        </ToolButtonFrame>
        <EmSpacer height={0.5} />
        <ToolButtonFrame $active={pluginsHook[0]}>
          <ModalToggleButton
            modal={ModalName.Plugins}
            hook={pluginsHook}
            text={sidebarHovered ? "Plugins" : undefined}
            size="stretch"
            shortcutKey={TOGGLE_PLUGINS_PANE}
            shortcutText={sidebarHovered ? TOGGLE_PLUGINS_PANE : undefined}
          />
        </ToolButtonFrame>
        <EmSpacer height={0.5} />
        <ToolButtonFrame $active={yourArtifactsHook[0]}>
          <ModalToggleButton
            modal={ModalName.YourArtifacts}
            hook={yourArtifactsHook}
            text={sidebarHovered ? "Your Inventory" : undefined}
            size="stretch"
            shortcutKey={TOGGLE_YOUR_ARTIFACTS_PANE}
            shortcutText={
              sidebarHovered ? TOGGLE_YOUR_ARTIFACTS_PANE : undefined
            }
          />
        </ToolButtonFrame>
        <EmSpacer height={0.5} />
        <ToolButtonFrame $active={planetdexHook[0]}>
          <ModalToggleButton
            modal={ModalName.PlanetDex}
            hook={planetdexHook}
            text={sidebarHovered ? "Your Planets" : undefined}
            size="stretch"
            shortcutKey={TOGGLE_YOUR_PLANETS_DEX_PANE}
            shortcutText={
              sidebarHovered ? TOGGLE_YOUR_PLANETS_DEX_PANE : undefined
            }
          />
        </ToolButtonFrame>
        <EmSpacer height={0.5} />
        <ToolButtonFrame $active={transactionLogHook[0]}>
          <ModalToggleButton
            modal={ModalName.TransactionLog}
            hook={transactionLogHook}
            text={sidebarHovered ? "Transaction Log" : undefined}
            size="stretch"
            shortcutKey={TOGGLE_TRANSACTIONS_PANE}
            shortcutText={sidebarHovered ? TOGGLE_TRANSACTIONS_PANE : undefined}
          />
        </ToolButtonFrame>
      </BorderlessPane>
    </WindowTogglesPaneContainer>
  );
}

const WindowTogglesPaneContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  pointer-events: auto;
`;

const ToolButtonFrame = styled.div<{ $active: boolean }>`
  border-left: 2px solid
    ${({ $active }) => ($active ? dfstyles.colors.dfgreen : "transparent")};
  padding-left: 4px;
`;
