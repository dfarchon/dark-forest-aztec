import { Setting } from "@dfpunk/types";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import TutorialManager, {
  TutorialManagerEvent,
  TutorialState,
} from "../../../Backend/GameLogic/TutorialManager";
import { clearGuideSearch, isGuideEntry } from "../../../config/guideEntry";
import { useUIManager } from "../../Utils/AppHooks";
import { useBooleanSetting } from "../../Utils/SettingsHooks";
import { BoothGuidePane } from "./BoothGuidePane";

/** Share the existing per-account tutorial settings and reset action. */
export function UserGuide({
  universeView,
  setUniverseView,
}: {
  universeView: boolean;
  setUniverseView: (value: boolean) => void;
}) {
  const ui = useUIManager();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const requested = isGuideEntry(search);
  const [newPlayer, setNewPlayer] = useBooleanSetting(ui, Setting.NewPlayer);
  const [open, setOpen] = useBooleanSetting(ui, Setting.TutorialOpen);
  const [completed, setCompleted] = useBooleanSetting(
    ui,
    Setting.TutorialCompleted
  );
  const [closed, setClosed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [session, setSession] = useState(0);
  const manager = TutorialManager.getInstance(ui);
  const visible =
    !closed && (requested || finished || (!completed && (newPlayer || open)));

  const clearEntry = () => {
    if (new URLSearchParams(search).has("guide")) {
      navigate(
        { pathname, search: clearGuideSearch(search), hash },
        { replace: true }
      );
    }
  };

  useEffect(() => {
    const reset = (state: TutorialState) => {
      if (state !== TutorialState.None) return;
      setClosed(false);
      setFinished(false);
      setSession((value) => value + 1);
    };
    manager.on(TutorialManagerEvent.StateChanged, reset);
    return () => {
      manager.removeListener(TutorialManagerEvent.StateChanged, reset);
    };
  }, [manager]);

  useEffect(() => {
    if (visible && universeView) setUniverseView(false);
  }, [visible, universeView, setUniverseView]);

  if (!visible) return null;
  return (
    <BoothGuidePane
      key={session}
      onComplete={() => {
        setFinished(true);
        setNewPlayer(false);
        setOpen(false);
        manager.complete();
        clearEntry();
      }}
      onClose={() => {
        setClosed(true);
        setFinished(false);
        setNewPlayer(false);
        setOpen(false);
        setCompleted(true);
        clearEntry();
      }}
    />
  );
}
