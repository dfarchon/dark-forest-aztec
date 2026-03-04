import { DarkForestRow } from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

customElements.define(DarkForestRow.tagName, DarkForestRow);

export const Row = createComponent({
  react: React,
  tagName: DarkForestRow.tagName,
  elementClass: DarkForestRow,
});
