import { DarkForestModal, PositionChangedEvent } from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

customElements.define(DarkForestModal.tagName, DarkForestModal);

export { DarkForestModal, PositionChangedEvent };

export const Modal = createComponent({
  react: React,
  tagName: DarkForestModal.tagName,
  elementClass: DarkForestModal,
  events: {
    onMouseDown: "mousedown",
    onPositionChanged: "position-changed",
  },
});
