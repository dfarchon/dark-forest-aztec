import {
  DarkForestButton,
  DarkForestShortcutButton,
  ShortcutPressedEvent,
} from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

import { useShortcut, useShortcutKeyDown } from "../Utils/useShortcut";

customElements.define(DarkForestButton.tagName, DarkForestButton);
customElements.define(
  DarkForestShortcutButton.tagName,
  DarkForestShortcutButton
);

export { DarkForestButton, DarkForestShortcutButton, ShortcutPressedEvent };

export const Btn = createComponent({
  react: React,
  tagName: DarkForestButton.tagName,
  elementClass: DarkForestButton,
  events: {
    onClick: "click",
  },
});

const LitShortcutBtn = createComponent({
  react: React,
  tagName: DarkForestShortcutButton.tagName,
  elementClass: DarkForestShortcutButton,
  events: {
    onClick: "click",
  },
});

export type ShortcutBtnProps = React.ComponentProps<typeof LitShortcutBtn> & {
  /** When set, this binding only runs while the modal is the active one. */
  shortcutModalId?: string;
  onShortcutPressed?: (event: ShortcutPressedEvent) => void;
};

export const ShortcutBtn = React.forwardRef<
  DarkForestShortcutButton,
  ShortcutBtnProps
>(function ShortcutBtn(
  {
    shortcutKey,
    shortcutModalId,
    onShortcutPressed,
    disabled,
    shortcutPressed: _shortcutPressed,
    ...rest
  },
  ref
) {
  useShortcut(
    shortcutKey ?? "",
    () => {
      onShortcutPressed?.(new ShortcutPressedEvent());
    },
    {
      modalId: shortcutModalId,
      enabled: Boolean(shortcutKey && onShortcutPressed && !disabled),
    }
  );
  const pressed = useShortcutKeyDown(disabled ? undefined : shortcutKey);

  return (
    <LitShortcutBtn
      {...rest}
      ref={ref}
      shortcutKey={shortcutKey}
      disabled={disabled}
      shortcutPressed={pressed}
    />
  );
});
