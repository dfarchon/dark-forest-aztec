import { Setting } from "@dfpunk/types";
import React, { useEffect, useState } from "react";

import TutorialManager, {
  TutorialManagerEvent,
  TutorialState,
} from "../../../Backend/GameLogic/TutorialManager";
import { useUIManager } from "../../Utils/AppHooks";
import { useBooleanSetting } from "../../Utils/SettingsHooks";
import { GuidePane } from "./GuidePane";

/** Share the existing per-account tutorial settings and reset action. */
export function Guide({
  universeView,
  setUniverseView,
}: {
  universeView: boolean;
  setUniverseView: (value: boolean) => void;
}) {
  const ui = useUIManager();
  const [open] = useBooleanSetting(ui, Setting.TutorialOpen);
  const [completed, setCompleted] = useBooleanSetting(
    ui,
    Setting.TutorialCompleted
  );
  const [closed, setClosed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [session, setSession] = useState(0);
  const manager = TutorialManager.getInstance(ui);
  const visible = !closed && (finished || (open && !completed));

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
    <GuidePane
      key={session}
      onComplete={() => {
        setFinished(true);
        manager.complete();
      }}
      onClose={() => {
        setClosed(true);
        setFinished(false);
        setCompleted(true);
      }}
    />
  );
}
