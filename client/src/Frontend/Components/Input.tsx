import {
  DarkForestCheckbox,
  DarkForestColorInput,
  DarkForestNumberInput,
  DarkForestTextInput,
} from "@dfpunk/ui";
import { createComponent } from "@lit/react";
import React from "react";

customElements.define(DarkForestCheckbox.tagName, DarkForestCheckbox);
customElements.define(DarkForestColorInput.tagName, DarkForestColorInput);
customElements.define(DarkForestNumberInput.tagName, DarkForestNumberInput);
customElements.define(DarkForestTextInput.tagName, DarkForestTextInput);

export {
  DarkForestCheckbox,
  DarkForestColorInput,
  DarkForestNumberInput,
  DarkForestTextInput,
};

export const Checkbox = createComponent({
  react: React,
  tagName: DarkForestCheckbox.tagName,
  elementClass: DarkForestCheckbox,
  events: {
    onChange: "input",
  },
});

export const ColorInput = createComponent({
  react: React,
  tagName: DarkForestColorInput.tagName,
  elementClass: DarkForestColorInput,
  events: {
    onChange: "input",
  },
});

export const NumberInput = createComponent({
  react: React,
  tagName: DarkForestNumberInput.tagName,
  elementClass: DarkForestNumberInput,
  events: {
    onChange: "input",
  },
});

export const TextInput = createComponent({
  react: React,
  tagName: DarkForestTextInput.tagName,
  elementClass: DarkForestTextInput,
  events: {
    onChange: "input",
    onBlur: "blur",
  },
});
