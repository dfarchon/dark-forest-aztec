import { Setting } from "@dfpunk/types";
import React from "react";

import { useUIManager } from "../Utils/AppHooks";
import { useBooleanSetting } from "../Utils/SettingsHooks";
import { Btn, ShortcutBtn, ShortcutBtnProps } from "./Btn";

/**
 * A button that will show shortcuts if enabled globally in the game, otherwise it will display a normal button
 *
 * Must ONLY be used when a GameUIManager is available.
 */
export function MaybeShortcutButton(props: ShortcutBtnProps) {
  const uiManager = useUIManager();
  const [disableDefaultShortcuts] = useBooleanSetting(
    uiManager,
    Setting.DisableDefaultShortcuts
  );

  if (disableDefaultShortcuts) {
    const {
      shortcutKey: _shortcutKey,
      shortcutText: _shortcutText,
      shortcutModalId: _shortcutModalId,
      shortcutPressed: _shortcutPressed,
      onShortcutPressed: _onShortcutPressed,
      ...buttonProps
    } = props;
    return <Btn {...buttonProps} />;
  } else {
    return <ShortcutBtn {...props} />;
  }
}
