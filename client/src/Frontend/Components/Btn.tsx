import {
  DarkForestButton,
  DarkForestShortcutButton,
  ShortcutPressedEvent,
} from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

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

export const ShortcutBtn = createComponent({
  react: React,
  tagName: DarkForestShortcutButton.tagName,
  elementClass: DarkForestShortcutButton,
  events: {
    onClick: "click",
    onShortcutPressed: "shortcut-pressed",
  },
});
