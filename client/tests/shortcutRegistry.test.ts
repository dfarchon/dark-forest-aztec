import assert from "node:assert/strict";
import test from "node:test";

import {
  isShortcutKeyDown,
  onShortcutKeyDown,
  onShortcutKeyUp,
  registerShortcut,
  setActiveShortcutModal,
  type ShortcutKeyEvent,
} from "../src/Frontend/Utils/ShortcutRegistry.ts";

function keyEvent(
  key: string,
  path: EventTarget[] = [],
  extra: Partial<ShortcutKeyEvent> = {}
): ShortcutKeyEvent {
  return {
    key,
    composedPath: () => path,
    ...extra,
  };
}

function tap(
  key: string,
  path: EventTarget[] = [],
  extra: Partial<ShortcutKeyEvent> = {}
) {
  onShortcutKeyDown(keyEvent(key, path, extra));
  onShortcutKeyUp(keyEvent(key, path, extra));
}

test("global bindings run on keyup after an accepted keydown", () => {
  const seen: string[] = [];
  const unregister = registerShortcut("q", (key) => seen.push(key));
  try {
    onShortcutKeyUp(keyEvent("Q"));
    assert.deepEqual(seen, []);

    tap("Q");
    assert.deepEqual(seen, ["q"]);
    assert.equal(isShortcutKeyDown("q"), false);
  } finally {
    unregister();
    setActiveShortcutModal(undefined);
  }
});

test("ignored presses do not arm a shortcut", () => {
  const seen: string[] = [];
  const unregister = registerShortcut(["h", "j"], (key) => seen.push(key));
  try {
    tap("h", [], { ctrlKey: true });
    tap("h", [], { metaKey: true });
    tap("h", [], { altKey: true });
    tap("h", [], { isComposing: true });
    tap("h", [], { keyCode: 229 });
    tap("h", [{ tagName: "INPUT", type: "text" } as EventTarget]);
    tap("h", [{ tagName: "TEXTAREA" } as EventTarget]);
    tap("h", [{ tagName: "SELECT" } as EventTarget]);
    tap("h", [{ tagName: "DF-TEXT-INPUT" } as EventTarget]);
    tap("h", [{ tagName: "DF-NUMBER-INPUT" } as EventTarget]);
    tap("h", [{ tagName: "DF-SLIDER" } as EventTarget]);
    tap("h", [{ isContentEditable: true } as EventTarget]);
    assert.deepEqual(seen, []);

    tap("j", [{ tagName: "INPUT", type: "range" } as EventTarget]);
    assert.deepEqual(seen, ["j"]);
  } finally {
    unregister();
  }
});

test("a keydown inside an input does not fire when the key is released outside it", () => {
  const seen: string[] = [];
  const unregister = registerShortcut("a", () => seen.push("a"));
  try {
    onShortcutKeyDown(
      keyEvent("a", [{ tagName: "INPUT", type: "text" } as EventTarget])
    );
    onShortcutKeyUp(keyEvent("a"));
    assert.deepEqual(seen, []);
  } finally {
    unregister();
  }
});

test("the active modal binding wins only its own key", () => {
  const seen: string[] = [];
  const unregisterGlobal = registerShortcut("t", () => seen.push("global-t"));
  const unregisterModal = registerShortcut("t", () => seen.push("modal-t"), {
    modalId: "planet",
  });
  const unregisterOther = registerShortcut("t", () => seen.push("other-t"), {
    modalId: "help",
  });
  const unregisterHelp = registerShortcut("h", () => seen.push("help"));
  try {
    setActiveShortcutModal("planet");
    tap("t");
    tap("h");
    assert.deepEqual(seen, ["modal-t", "help"]);

    seen.length = 0;
    setActiveShortcutModal("help");
    tap("t");
    assert.deepEqual(seen, ["other-t"]);

    seen.length = 0;
    setActiveShortcutModal(undefined);
    tap("t");
    assert.deepEqual(seen, ["global-t"]);
  } finally {
    unregisterGlobal();
    unregisterModal();
    unregisterOther();
    unregisterHelp();
    setActiveShortcutModal(undefined);
  }
});

test("one registration can handle several keys", () => {
  const seen: string[] = [];
  const unregister = registerShortcut(["1", "!"], (key) => seen.push(key));
  try {
    tap("1");
    tap("!");
    assert.deepEqual(seen, ["1", "!"]);
  } finally {
    unregister();
  }
});

test("unregister stops the binding and releases a held key", () => {
  let calls = 0;
  const unregister = registerShortcut("m", () => {
    calls += 1;
  });
  onShortcutKeyDown(keyEvent("m"));
  assert.equal(isShortcutKeyDown("m"), true);
  unregister();
  assert.equal(isShortcutKeyDown("m"), false);
  onShortcutKeyUp(keyEvent("m"));
  assert.equal(calls, 0);
});
