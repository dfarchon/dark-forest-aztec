import assert from "node:assert/strict";
import test from "node:test";

import { TerminalRevealController } from "../src/Frontend/Utils/terminalReveal";

test("a quick icon click replaces the hover toggle instead of toggling twice", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let toggles = 0;
  const reveal = new TerminalRevealController(() => toggles++);
  reveal.enter();
  t.mock.timers.tick(100);
  reveal.click();
  assert.equal(toggles, 1);
  t.mock.timers.tick(1000);
  assert.equal(toggles, 1);
  reveal.leave();
});

test("hover toggles once per entry, and subsequent icon clicks still work", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let toggles = 0;
  const reveal = new TerminalRevealController(() => toggles++);
  reveal.enter();
  reveal.enter();
  t.mock.timers.tick(250);
  assert.equal(toggles, 1);
  reveal.click();
  assert.equal(toggles, 2);
  t.mock.timers.tick(1000);
  assert.equal(toggles, 2);
  reveal.leave();
  reveal.enter();
  t.mock.timers.tick(250);
  assert.equal(toggles, 3);
  reveal.leave();
});

test("leaving the edge or unmounting cancels a pending hover", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let toggles = 0;
  const reveal = new TerminalRevealController(() => toggles++);
  reveal.enter();
  reveal.leave();
  t.mock.timers.tick(1000);
  assert.equal(toggles, 0);
  reveal.enter();
  t.mock.timers.tick(250);
  assert.equal(toggles, 1);
  reveal.leave();
});
