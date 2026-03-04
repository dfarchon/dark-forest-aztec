import { DarkForestTheme } from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

customElements.define(DarkForestTheme.tagName, DarkForestTheme);

export const Theme = createComponent({
  react: React,
  tagName: DarkForestTheme.tagName,
  elementClass: DarkForestTheme,
});
