import { DarkForestSlider, DarkForestSliderHandle } from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

customElements.define(DarkForestSlider.tagName, DarkForestSlider);
customElements.define(DarkForestSliderHandle.tagName, DarkForestSliderHandle);

export { DarkForestSlider, DarkForestSliderHandle };

export const Slider = createComponent({
  react: React,
  tagName: DarkForestSlider.tagName,
  elementClass: DarkForestSlider,
  events: {
    onChange: "input",
  },
});

export const SliderHandle = createComponent({
  react: React,
  tagName: DarkForestSliderHandle.tagName,
  elementClass: DarkForestSliderHandle,
  events: {
    onChange: "change",
  },
});
