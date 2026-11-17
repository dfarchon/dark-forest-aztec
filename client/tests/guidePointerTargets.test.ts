import assert from "node:assert/strict";
import test from "node:test";

import {
  guideSliderPose,
  guidePlanetControlPoint,
} from "../src/Frontend/Panes/BoothGuide/guidePointerTargets";

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

test("the real Spectrum slider follows its controls and thumb instead of the tiny native input", () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = Object.fromEntries(
    ["HTMLElement", "document", "window"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ])
  );
  class Element {
    disabled = false;
    bounds = rect(100, 200, 300, 70);
    hasAttribute() {
      return false;
    }
    getBoundingClientRect() {
      return this.bounds;
    }
    shadowRoot = {
      querySelector: (selector: string) => ({
        getBoundingClientRect: () =>
          selector === "#controls"
            ? rect(112, 230, 276, 24)
            : selector === ".handle"
              ? rect(132, 234, 16, 16)
              : rect(139, 240, 1, 1),
      }),
    };
  }
  try {
    const hidden = new Element();
    hidden.bounds = rect(0, 0, 0, 0);
    const visible = new Element();
    globals.HTMLElement = Element;
    globals.document = { querySelectorAll: () => [hidden, visible] };
    globals.window = {
      innerWidth: 1200,
      innerHeight: 800,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    };
    const pose = guideSliderPose("energy-slider", 10, 65);
    assert.deepEqual(pose, {
      kind: "drag",
      from: { x: 139.6, y: 242 },
      to: { x: 291.4, y: 242 },
    });
    visible.disabled = true;
    assert.deepEqual(guideSliderPose("energy-slider", 10, 65), {
      kind: "hide",
    });
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  }
});

test("ship guidance stays in the teaching planet's interactive panel, never a duplicate preview", () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = Object.fromEntries(
    ["HTMLElement", "document", "window"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  class Element {
    pointerEvents = "auto";
    constructor(private bounds: ReturnType<typeof rect>) {}
    hasAttribute() {
      return false;
    }
    querySelector() {
      return null;
    }
    getBoundingClientRect() {
      return this.bounds;
    }
  }
  try {
    const preview = new Element(rect(120, 200, 40, 40));
    const ship = new Element(rect(800, 400, 40, 40));
    let open = true,
      globalLookups = 0;
    const panel = { querySelectorAll: () => [ship] };
    globals.HTMLElement = Element;
    globals.document = {
      querySelector: (selector: string) => {
        assert.equal(selector, '[data-guide-send-planet="source"]');
        return open ? panel : null;
      },
      querySelectorAll: () => {
        globalLookups++;
        return [preview, ship];
      },
    };
    globals.window = {
      innerWidth: 1200,
      innerHeight: 800,
      getComputedStyle: (element: Element) => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        pointerEvents: element.pointerEvents,
      }),
    };
    assert.deepEqual(guidePlanetControlPoint("ship-first", "source"), {
      x: 820,
      y: 420,
    });
    open = false;
    assert.equal(guidePlanetControlPoint("ship-first", "source"), null);
    assert.equal(globalLookups, 0);
    open = true;
    ship.pointerEvents = "none";
    assert.equal(guidePlanetControlPoint("ship-first", "source"), null);
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  }
});
