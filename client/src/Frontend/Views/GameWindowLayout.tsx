import { ModalId, ModalName, Setting } from "@dfpunk/types";
import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { BorderlessPane } from "../Components/CoreUI";
import {
  CanvasContainer,
  CanvasWrapper,
  MainWindow,
  WindowWrapper,
} from "../Components/GameWindowComponents";
import ControllableCanvas from "../Game/ControllableCanvas";
import { ArtifactHoverPane } from "../Panes/ArtifactHoverPane";
import { DiagnosticsPane } from "../Panes/DiagnosticsPane";
import { ExplorePane } from "../Panes/ExplorePane";
import { HelpPane } from "../Panes/HelpPane";
import { HoverPlanetPane } from "../Panes/HoverPlanetPane";
import { MiniMapPane } from "../Panes/MiniMapPane";
import OnboardingPane from "../Panes/OnboardingPane";
import { PlanetContextPane } from "../Panes/PlanetContextPane";
import { PlanetDexPane } from "../Panes/PlanetDexPane";
import { PlayerArtifactsPane } from "../Panes/PlayerArtifactsPane";
import { PluginLibraryPane } from "../Panes/PluginLibraryPane";
import { PrivatePane } from "../Panes/PrivatePane";
import { SettingsPane } from "../Panes/SettingsPane";
import { TransactionLogPane } from "../Panes/TransactionLogPane";
import { TutorialPane } from "../Panes/TutorialPane";
import { TwitterVerifyPane } from "../Panes/TwitterVerifyPane";
import { useSelectedPlanet, useUIManager } from "../Utils/AppHooks";
import { DFZIndex } from "../Utils/constants";
import { useBooleanSetting } from "../Utils/SettingsHooks";
import {
  TOGGLE_DIAGNOSTICS_PANE,
  TOGGLE_UNIVERSE_VIEW,
} from "../Utils/ShortcutConstants";
import { setActiveShortcutModal } from "../Utils/ShortcutRegistry";
import UIEmitter, { UIEmitterEvent } from "../Utils/UIEmitter";
import { useShortcut } from "../Utils/useShortcut";
import { NotificationsPane } from "./Notifications";
import { SidebarPane } from "./SidebarPane";
import { SponsoredFpcBalanceWarning } from "./SponsoredFpcBalanceWarning";
import { TopBar } from "./TopBar";

export function GameWindowLayout({
  terminalVisible,
  setTerminalVisible,
  universeView,
  setUniverseView,
}: {
  terminalVisible: boolean;
  setTerminalVisible: (visible: boolean) => void;
  universeView: boolean;
  setUniverseView: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const uiManager = useUIManager();
  const modalManager = uiManager.getModalManager();
  const modalPositions = modalManager.getModalPositions();

  /**
   * We use the existence of a window position for a given modal as an indicator
   * that it should be opened on page load. This is to satisfy the feature of
   * peristent modal positions across browser sessions for a given account.
   */
  const isModalOpen = useCallback(
    (modalId: ModalId) => {
      const pos = modalPositions.get(modalId);
      if (pos) {
        return pos.state !== "closed";
      } else {
        return false;
      }
    },
    [modalPositions]
  );

  const [helpVisible, setHelpVisible] = useState<boolean>(
    isModalOpen(ModalName.Help)
  );
  const [transactionLogVisible, setTransactionLogVisible] = useState<boolean>(
    isModalOpen(ModalName.TransactionLog)
  );
  const [planetdexVisible, setPlanetdexVisible] = useState<boolean>(
    isModalOpen(ModalName.PlanetDex)
  );
  const [playerArtifactsVisible, setPlayerArtifactsVisible] = useState<boolean>(
    isModalOpen(ModalName.YourArtifacts)
  );
  const [twitterVerifyVisible, setTwitterVerifyVisible] = useState<boolean>(
    isModalOpen(ModalName.TwitterVerify)
  );
  const [settingsVisible, setSettingsVisible] = useState<boolean>(
    isModalOpen(ModalName.Settings)
  );
  const [privateVisible, setPrivateVisible] = useState<boolean>(
    isModalOpen(ModalName.Private)
  );
  const [pluginsVisible, setPluginsVisible] = useState<boolean>(
    isModalOpen(ModalName.Plugins)
  );
  const [diagnosticsVisible, setDiagnosticsVisible] = useState<boolean>(
    isModalOpen(ModalName.Diagnostics)
  );

  const [modalsContainer, setModalsContainer] = useState<
    HTMLDivElement | undefined
  >();
  const modalsContainerCB = useCallback((node: HTMLDivElement) => {
    setModalsContainer(node);
  }, []);

  const [onboardingVisible, setOnboardingVisible] = useBooleanSetting(
    uiManager,
    Setting.NewPlayer
  );
  const tutorialHook = useBooleanSetting(uiManager, Setting.TutorialOpen);

  const selected = useSelectedPlanet(uiManager).value;
  const [selectedPlanetVisible, setSelectedPlanetVisible] =
    useState<boolean>(!!selected);

  const [userTerminalVisibleSetting, setTerminalVisibleSetting] =
    useBooleanSetting(uiManager, Setting.TerminalVisible);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const minimapEdgeArmed = useRef(true);

  useEffect(() => {
    uiManager.setOverlayContainer(modalsContainer);
  }, [uiManager, modalsContainer]);

  const account = uiManager.getAccount();
  const terminalSettingLoaded = React.useRef(false);
  useEffect(() => {
    if (!uiManager.getAccount()) return;
    setTerminalVisible(uiManager.getBooleanSetting(Setting.TerminalVisible));
  }, [account, uiManager, setTerminalVisible]);

  useEffect(() => {
    // The first paint still has the default hidden state. Writing that would
    // turn the saved "visible" setting off and the log would disappear.
    if (!uiManager.getAccount()) return;
    if (!terminalSettingLoaded.current) {
      terminalSettingLoaded.current = true;
      return;
    }
    if (userTerminalVisibleSetting !== terminalVisible) {
      setTerminalVisibleSetting(terminalVisible);
    }
  }, [
    account,
    uiManager,
    userTerminalVisibleSetting,
    setTerminalVisibleSetting,
    terminalVisible,
  ]);

  useEffect(
    () => setSelectedPlanetVisible(!!selected),
    [selected, setSelectedPlanetVisible]
  );

  const [disableDefaultShortcuts] = useBooleanSetting(
    uiManager,
    Setting.DisableDefaultShortcuts
  );

  useEffect(() => {
    const subscription = modalManager.activeModalId$.subscribe((modalId) => {
      setActiveShortcutModal(modalId);
    });
    return () => {
      subscription.unsubscribe();
      setActiveShortcutModal(undefined);
    };
  }, [modalManager]);

  useShortcut(
    TOGGLE_DIAGNOSTICS_PANE,
    () => {
      setDiagnosticsVisible((visible) => !visible);
    },
    { enabled: !disableDefaultShortcuts }
  );

  useShortcut(
    TOGGLE_UNIVERSE_VIEW,
    () => {
      setUniverseView((visible) => !visible);
    },
    { enabled: !disableDefaultShortcuts }
  );

  useEffect(() => {
    const uiEmitter = UIEmitter.getInstance();
    uiEmitter.emit(UIEmitterEvent.UIChange);
  }, [universeView]);

  /** Universe view hides only edge chrome; open modals/plugins stay visible. */
  const showEdgeChrome = !universeView;

  return (
    <WindowWrapper>
      <UniverseFade $hidden={!showEdgeChrome}>
        <TopBarPaneContainer>
          <BorderlessPane>
            <TopBar
              twitterVerifyHook={[
                twitterVerifyVisible,
                setTwitterVerifyVisible,
              ]}
            />
          </BorderlessPane>
        </TopBarPaneContainer>
        <SponsoredFpcBalanceWarning />
      </UniverseFade>

      {/* all modals rendered into here */}
      <div ref={modalsContainerCB}>
        <HelpPane visible={helpVisible} onClose={() => setHelpVisible(false)} />
        <TransactionLogPane
          visible={transactionLogVisible}
          onClose={() => setTransactionLogVisible(false)}
        />
        <PlanetDexPane
          visible={planetdexVisible}
          onClose={() => setPlanetdexVisible(false)}
        />
        <TwitterVerifyPane
          visible={twitterVerifyVisible}
          onClose={() => setTwitterVerifyVisible(false)}
        />
        <SettingsPane
          visible={settingsVisible}
          onClose={() => setSettingsVisible(false)}
          onOpenPrivate={() => setPrivateVisible(true)}
        />
        <PrivatePane
          visible={privateVisible}
          onClose={() => setPrivateVisible(false)}
        />
        <PlayerArtifactsPane
          visible={playerArtifactsVisible}
          onClose={() => setPlayerArtifactsVisible(false)}
        />
        <PlanetContextPane
          visible={selectedPlanetVisible}
          onClose={() => setSelectedPlanetVisible(false)}
        />
        <DiagnosticsPane
          visible={diagnosticsVisible}
          onClose={() => setDiagnosticsVisible(false)}
        />

        {modalsContainer && (
          <PluginLibraryPane
            modalsContainer={modalsContainer}
            gameUIManager={uiManager}
            visible={pluginsVisible}
            onClose={() => setPluginsVisible(false)}
          />
        )}
      </div>

      <OnboardingPane
        visible={onboardingVisible}
        onClose={() => setOnboardingVisible(false)}
      />

      <MainWindow>
        <CanvasContainer>
          <CanvasWrapper>
            <ControllableCanvas />
          </CanvasWrapper>

          <UniverseFade $hidden={!showEdgeChrome}>
            <TopRightStack>
              <NotificationsPane />
            </TopRightStack>
            <BottomRightStack $open={minimapOpen}>
              <MiniMapPane />
            </BottomRightStack>
            <MiniMapEdge
              onMouseEnter={() => {
                if (!showEdgeChrome || !minimapEdgeArmed.current) return;
                minimapEdgeArmed.current = false;
                setMinimapOpen((open) => !open);
              }}
              onMouseLeave={() => {
                minimapEdgeArmed.current = true;
              }}
            />
            <TutorialPane tutorialHook={tutorialHook} />
          </UniverseFade>
          <HiddenEdgeChrome $hidden={!showEdgeChrome}>
            <BottomLeftDock>
              <SidebarPane
                transactionLogHook={[
                  transactionLogVisible,
                  setTransactionLogVisible,
                ]}
                settingsHook={[settingsVisible, setSettingsVisible]}
                helpHook={[helpVisible, setHelpVisible]}
                pluginsHook={[pluginsVisible, setPluginsVisible]}
                yourArtifactsHook={[
                  playerArtifactsVisible,
                  setPlayerArtifactsVisible,
                ]}
                planetdexHook={[planetdexVisible, setPlanetdexVisible]}
              />
              <ExplorePane />
            </BottomLeftDock>
          </HiddenEdgeChrome>

          <HoverPlanetPane />
          <ArtifactHoverPane />
        </CanvasContainer>
      </MainWindow>
    </WindowWrapper>
  );
}

const TopBarPaneContainer = styled.div`
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  width: max-content;
  position: absolute;
  top: 0;
  left: 0;
  z-index: ${DFZIndex.MenuBar};
`;

const TopRightStack = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  z-index: ${DFZIndex.Notification};
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin: 0.5em;
`;

const BottomRightStack = styled.div<{ $open: boolean }>`
  position: absolute;
  right: 0;
  bottom: 0;
  /* Above the bottom-left dock, whose box is transparent and can cover the map. */
  z-index: ${DFZIndex.MenuBar + 1};
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 0.75em;
  margin: 0.5em;
  transform: translateX(${({ $open }) => ($open ? "0" : "calc(100% + 0.5em)")});
  transition: transform 0.4s cubic-bezier(0.22, 1.2, 0.36, 1);
`;

const MiniMapEdge = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  width: 6px;
  height: 200px;
  z-index: 1000;
`;

const BottomLeftDock = styled.div`
  position: absolute;
  left: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  z-index: ${DFZIndex.MenuBar};
  /* The box is as wide as the explore bar and as tall as the sidebar plus
     that bar. Its empty corner would otherwise swallow map clicks. */
  pointer-events: none;
`;

/**
 * Fades edge UI in universe view but keeps it mounted so shortcut
 * registrations (h, j, k, space, etc.) stay active.
 */
const HiddenEdgeChrome = styled.div<{ $hidden: boolean }>`
  opacity: ${({ $hidden }) => ($hidden ? 0 : 1)};
  transition: opacity 0.3s ease;
  ${({ $hidden }) => ($hidden ? "pointer-events: none;" : "")}
`;

const UniverseFade = styled.div<{ $hidden: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: ${({ $hidden }) => ($hidden ? 0 : 1)};
  transition: opacity 0.3s ease;

  & > * {
    pointer-events: ${({ $hidden }) => ($hidden ? "none" : "auto")};
  }
`;
