import { RECOMMENDED_MODAL_WIDTH } from "@dfpunk/constants";
import { ModalName, PluginId, Setting } from "@dfpunk/types";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReactSortable } from "react-sortablejs";
import styled from "styled-components";
import { v4 as uuidv4 } from "uuid";

import GameUIManager from "../../Backend/GameLogic/GameUIManager";
import { SerializedPlugin } from "../../Backend/Plugins/SerializedPlugin";
import { Btn } from "../Components/Btn";
import { Link, Spacer, Truncate } from "../Components/CoreUI";
import { PluginModal } from "../Components/PluginModal";
import { RemoteModal } from "../Components/RemoteModal";
import { Sub } from "../Components/Text";
import dfstyles from "../Styles/dfstyles";
import { useEmitterValue } from "../Utils/EmitterHooks";
import {
  getBooleanSetting,
  setSetting,
  useBooleanSetting,
} from "../Utils/SettingsHooks";
import { ModalPane } from "../Views/ModalPane";
import { PluginEditorPane } from "./PluginEditorPane";

function HelpContent() {
  return (
    <div>
      <p>
        Plugins are bits of code that can be written by anyone, and allows the
        writer to program the game. Plugins range from cosmetic (try the rage
        cage plugin) to functional (imagine a plugin that fights your wars for
        you).
      </p>
      <Spacer height={8} />
      <p>
        Dark Forest maintains a repository to which community members can submit
        their own plugins. You can find it{" "}
        <Link to="https://dfares-plugins.netlify.app/">here</Link>.
      </p>
      <Spacer height={8} />
      <p>Try editing one of the default plugins to see how it works!</p>
    </div>
  );
}

const ScrollWrapper = styled.div`
  display: flex;
  position: relative;
  max-height: 300px;
`;

const PluginListContainer = styled.div`
  flex: 1;
  min-width: 0;
  max-height: 300px;
  overflow-y: auto;
`;

const ScrollTrack = styled.div`
  width: 10px;
  flex-shrink: 0;
  margin-left: 8px;
  position: relative;
  background: ${dfstyles.colors.backgrounddark};
  border: 1px solid ${dfstyles.colors.borderDark};
  border-radius: 5px;
  cursor: pointer;
`;

const ScrollThumb = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  background: ${dfstyles.colors.subtext};
  border-radius: 5px;
  cursor: grab;
  transition: background 0.15s;

  &:hover {
    background: ${dfstyles.colors.text};
  }

  &:active {
    cursor: grabbing;
    background: ${dfstyles.colors.text};
  }
`;

const PluginRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  gap: 8px;
  min-height: 32px;
`;

const PluginName = styled.div`
  flex: 1;
  min-width: 0;
`;

const Actions = styled.div`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;

  .blue {
    --df-button-hover-background: ${dfstyles.colors.dfblue};
    --df-button-hover-border: 1px solid ${dfstyles.colors.dfblue};
  }

  .red {
    --df-button-hover-background: ${dfstyles.colors.dfred};
    --df-button-hover-border: 1px solid ${dfstyles.colors.dfred};
  }

  .green {
    --df-button-hover-background: ${dfstyles.colors.dfgreen};
    --df-button-hover-border: 1px solid ${dfstyles.colors.dfgreen};
  }
`;

/**
 * This modal presents an overview of all of the player's plugins. Has a button to add a new plugin,
 * and lists out all the existing plugins, allowing the user to view their titles, as well as either
 * edit, delete, or open their modal.
 *
 * You can think of this as the plugin process list, the Activity Monitor of Dark forest.
 */
export function PluginLibraryPane({
  gameUIManager,
  visible,
  onClose,
  modalsContainer,
}: {
  gameUIManager: GameUIManager;
  visible: boolean;
  onClose: () => void;
  modalsContainer: Element;
}) {
  const pluginManager = gameUIManager.getPluginManager();
  const modalManager = gameUIManager.getModalManager();
  const plugins = useEmitterValue(
    pluginManager.plugins$,
    pluginManager.getLibrary()
  );
  const contractAddress = gameUIManager.getContractAddress();
  const account = gameUIManager.getAccount();
  const config = { contractAddress, account };
  const isAdmin = gameUIManager.isAdmin();
  const [editorIsOpen, setEditorIsOpen] = useState(false);
  const [warningIsOpen, setWarningIsOpen] = useState(false);
  const [clicksUntilHasPlugins, setClicksUntilHasPlugins] = useState(8);
  const [forceReloadEmbeddedPlugins, _s] = useBooleanSetting(
    gameUIManager,
    Setting.ForceReloadEmbeddedPlugins
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbTop, setThumbTop] = useState(0);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [showScrollbar, setShowScrollbar] = useState(false);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartScrollTop = useRef(0);

  const updateThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setShowScrollbar(false);
      return;
    }
    setShowScrollbar(true);
    const ratio = clientHeight / scrollHeight;
    const newThumbHeight = Math.max(ratio * clientHeight, 30);
    const maxTop = clientHeight - newThumbHeight;
    const scrollRatio = scrollTop / (scrollHeight - clientHeight);
    setThumbHeight(newThumbHeight);
    setThumbTop(scrollRatio * maxTop);
  }, []);

  useEffect(() => {
    updateThumb();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateThumb);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateThumb, plugins]);

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      if ((e.target as HTMLElement) !== track) return;
      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const ratio = clickY / rect.height;
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    },
    []
  );

  const handleThumbMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartScrollTop.current = scrollRef.current?.scrollTop ?? 0;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const el = scrollRef.current;
        if (!el) return;
        const deltaY = ev.clientY - dragStartY.current;
        const trackHeight = el.clientHeight;
        const scrollDelta = (deltaY / trackHeight) * el.scrollHeight;
        el.scrollTop = dragStartScrollTop.current + scrollDelta;
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    []
  );

  /**
   * the id of the plugin that the user is currently editing.
   */
  const [currentlyEditingPluginId, setEditingPluginId] = useState<
    PluginId | undefined
  >();

  /**
   * to get a unique editor for every time we open the editor. this means that every
   * time you open the editor, you get a fresh copy of your plugin, or a blank state.
   * if we did not do this, then the previous unsaved edits would persist in the editor
   * ui.
   */
  const [editorNonce, setEditorNonce] = useState(0);

  /**
   * Opens an editor that would overwrite an existing plugin if one
   * exists for the given plugin id. If one doesn't exist, opens
   * an editor that will save a new plugin. Returns a function that
   * closes the editor.
   */
  function openEditorForPlugin(pluginId?: PluginId) {
    if (!account || !getBooleanSetting(config, Setting.HasAcceptedPluginRisk)) {
      setWarningIsOpen(true);
      return;
    }

    setWarningIsOpen(false);
    setEditorIsOpen(true);
    setEditorNonce(editorNonce + 1);

    if (currentlyEditingPluginId !== pluginId) {
      setEditingPluginId(pluginId);
    }
  }

  function runPluginClicked(pluginId: PluginId) {
    modalManager.setModalState(pluginId, "open");
  }

  /**
   * Overwrites the plugin with the given plugin id, killing its process
   * if it has a process. If `pluginId` is undefined, saves a new plugin.
   */
  const saveAndReloadPlugin = (
    newName: string,
    newCode: string,
    pluginId?: PluginId
  ): void => {
    if (pluginId && newCode) {
      pluginManager?.overwritePlugin(newName || "no name", newCode, pluginId);
    } else {
      // Auto generate a PluginId
      const pluginId = uuidv4() as PluginId;
      pluginManager?.addPluginToLibrary(
        pluginId,
        newName || "no name",
        newCode || ""
      );
    }
  };

  const onAcceptWarningClick = () => {
    if (clicksUntilHasPlugins === 1) {
      account && setSetting(config, Setting.HasAcceptedPluginRisk, true + "");
      setWarningIsOpen(false);
    }

    setClicksUntilHasPlugins(clicksUntilHasPlugins - 1);
  };

  /**
   * When we first load this component, make sure that we've loaded all
   * the plugins from disk.
   */
  useEffect(() => {
    pluginManager.load(isAdmin, forceReloadEmbeddedPlugins);
  }, [pluginManager, isAdmin, forceReloadEmbeddedPlugins]);

  function addPluginClicked(): void {
    openEditorForPlugin(undefined);
  }

  function deletePluginClicked(pluginId: PluginId) {
    if (confirm("are you sure you want to delete this plugin?")) {
      pluginManager.deletePlugin(pluginId);
      modalManager.clearModalPosition(pluginId);
      setEditorIsOpen(false);
    }
  }

  function onPluginReorder(newOrder: SerializedPlugin[]) {
    pluginManager?.reorderPlugins(newOrder.map((p) => p.id));
  }

  /**
   * The Dark Forest process list.
   */
  function renderPluginsList() {
    if (!plugins || plugins.length === 0) {
      return "you have no plugins!";
    }

    return (
      // @ts-expect-error ReactSortable types omit children but component accepts them
      <ReactSortable list={plugins} setList={onPluginReorder}>
        {plugins.map((plugin) => (
          <PluginRow key={plugin.id}>
            <PluginName>
              <Truncate maxWidth={"100%"} style={{ verticalAlign: "unset" }}>
                <Sub>{plugin.name}</Sub>
              </Truncate>
            </PluginName>
            <Actions>
              <Btn
                className="blue"
                onClick={() => openEditorForPlugin(plugin.id)}
              >
                edit
              </Btn>
              <Btn
                className="red"
                onClick={() => deletePluginClicked(plugin.id)}
              >
                del
              </Btn>
              <Btn
                className="green"
                onClick={() => runPluginClicked(plugin.id)}
              >
                run
              </Btn>
            </Actions>
          </PluginRow>
        ))}
      </ReactSortable>
    );
  }

  function onPluginClosed(pluginId: PluginId) {
    pluginManager.destroy(pluginId);
    modalManager.setModalState(pluginId, "closed");
  }
  function onPluginRendered(pluginId: PluginId, el: HTMLDivElement) {
    // This is `async` but we don't care about the result
    pluginManager.render(pluginId, el);
  }

  const pluginModals = (plugins ?? []).map((plugin) => {
    return (
      <PluginModal
        key={plugin.id}
        id={plugin.id}
        title={plugin.name}
        container={modalsContainer}
        onClose={() => onPluginClosed(plugin.id)}
        onRender={(el) => onPluginRendered(plugin.id, el)}
      />
    );
  });

  return (
    <>
      <RemoteModal
        id={ModalName.PluginWarning}
        container={modalsContainer}
        title="WARNING"
        visible={warningIsOpen}
        onClose={() => setWarningIsOpen(false)}
        width={RECOMMENDED_MODAL_WIDTH}
      >
        <p>
          Dark Forest supports plugins, which allow you to write JavaScript code
          that can interact with the game. Plugins are powerful and can enhance
          your gameplay experience, but they can also be dangerous!
        </p>
        <br />
        <p>
          Be careful using plugins that were authored by somebody other than
          yourself! Plugins can impersonate your account, and steal all your
          money. A malicious plugin could transfer all your planets and
          artifacts to somebody else!
        </p>
        <br />
        <Btn variant="danger" onClick={onAcceptWarningClick}>
          Click {clicksUntilHasPlugins} times for Plugins
        </Btn>
      </RemoteModal>
      <RemoteModal
        id={ModalName.PluginEditor}
        container={modalsContainer}
        title="Plugin Editor"
        visible={editorIsOpen}
        onClose={() => setEditorIsOpen(false)}
      >
        <PluginEditorPane
          key={currentlyEditingPluginId + "" + editorNonce}
          pluginId={currentlyEditingPluginId}
          setIsOpen={setEditorIsOpen}
          pluginHost={pluginManager}
          overwrite={saveAndReloadPlugin}
        />
      </RemoteModal>

      {pluginModals}

      <ModalPane
        visible={visible}
        onClose={onClose}
        id={ModalName.Plugins}
        title={"Plugin Library"}
        helpContent={HelpContent}
        width={RECOMMENDED_MODAL_WIDTH}
      >
        <ScrollWrapper>
          <PluginListContainer ref={scrollRef} onScroll={updateThumb}>
            {renderPluginsList()}
          </PluginListContainer>
          {showScrollbar && (
            <ScrollTrack ref={trackRef} onClick={handleTrackClick}>
              <ScrollThumb
                style={{ top: thumbTop, height: thumbHeight }}
                onMouseDown={handleThumbMouseDown}
              />
            </ScrollTrack>
          )}
        </ScrollWrapper>
        <Spacer height={8} />
        <Btn onClick={addPluginClicked}>Add Plugin</Btn>
      </ModalPane>
    </>
  );
}
