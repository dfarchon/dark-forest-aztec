import { SpecialKey } from "@dfpunk/constants";

/**
 * One document listener for every shortcut. Bindings register while mounted.
 * A modal binding wins only for its own key, and only while that modal is active.
 */

const SPECIAL_KEYS = new Set<string>(Object.values(SpecialKey));

const EDITABLE_HOSTS = new Set([
  "df-text-input",
  "df-number-input",
  "df-slider",
]);

export type ShortcutKeyEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  composedPath(): EventTarget[];
};

type Binding = {
  keys: readonly string[];
  modalId?: string;
  onUp: (key: string) => void;
};

const bindings = new Map<number, Binding>();
const downKeys = new Set<string>();
const downListeners = new Set<() => void>();

let nextBindingId = 1;
let activeModalId: string | undefined;
let listening = false;

export function normalizeShortcutKey(key: string): string {
  if (SPECIAL_KEYS.has(key)) return key;
  return key.toLowerCase();
}

export function setActiveShortcutModal(modalId: string | undefined): void {
  activeModalId = modalId;
}

export function registerShortcut(
  key: string | readonly string[],
  onUp: (key: string) => void,
  options?: { modalId?: string }
): () => void {
  const keys = [
    ...new Set(
      (typeof key === "string" ? [key] : key)
        .map(normalizeShortcutKey)
        .filter((shortcut) => shortcut.length > 0)
    ),
  ];
  if (keys.length === 0) return () => {};

  const id = nextBindingId++;
  bindings.set(id, { keys, modalId: options?.modalId, onUp });
  attach();

  return () => {
    bindings.delete(id);
    detachIfIdle();
  };
}

export function isShortcutKeyDown(key: string): boolean {
  return downKeys.has(normalizeShortcutKey(key));
}

export function subscribeShortcutKeys(listener: () => void): () => void {
  downListeners.add(listener);
  return () => {
    downListeners.delete(listener);
  };
}

export function onShortcutKeyDown(event: ShortcutKeyEvent): void {
  if (shouldIgnoreShortcut(event)) return;
  const key = normalizeShortcutKey(event.key);
  if (downKeys.has(key)) return;
  downKeys.add(key);
  notifyKeyState();
}

export function onShortcutKeyUp(event: ShortcutKeyEvent): void {
  const key = normalizeShortcutKey(event.key);
  const pressed = downKeys.delete(key);
  if (pressed) notifyKeyState();
  // Fire only when the matching keydown was accepted. A release inside an input
  // still counts if the press itself was not ignored.
  if (!pressed) return;

  for (const binding of bindingsFor(key)) {
    binding.onUp(key);
  }
}

function bindingsFor(key: string): Binding[] {
  const matches: Binding[] = [];
  for (const binding of bindings.values()) {
    if (binding.keys.includes(key)) matches.push(binding);
  }

  const modalMatches = matches.filter(
    (binding) =>
      binding.modalId !== undefined && binding.modalId === activeModalId
  );
  if (modalMatches.length > 0) return modalMatches;
  return matches.filter((binding) => binding.modalId === undefined);
}

export function shouldIgnoreShortcut(event: ShortcutKeyEvent): boolean {
  if (event.isComposing || event.key === "Process" || event.keyCode === 229) {
    return true;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return true;

  for (const node of event.composedPath()) {
    if (isEditableTarget(node)) return true;
  }
  return false;
}

function isEditableTarget(node: EventTarget): boolean {
  const tag = tagNameOf(node);
  if (tag === "textarea" || tag === "select") return true;
  if (EDITABLE_HOSTS.has(tag)) return true;
  if (tag === "input") return inputType(node) !== "range";
  return isContentEditable(node);
}

function tagNameOf(node: EventTarget): string {
  if (typeof node !== "object" || node === null || !("tagName" in node)) {
    return "";
  }
  const tag = node.tagName;
  return typeof tag === "string" ? tag.toLowerCase() : "";
}

function inputType(node: EventTarget): string {
  if (typeof node !== "object" || node === null || !("type" in node)) return "";
  const type = node.type;
  return typeof type === "string" ? type.toLowerCase() : "";
}

function isContentEditable(node: EventTarget): boolean {
  if (typeof node !== "object" || node === null) return false;
  if ("isContentEditable" in node && node.isContentEditable === true)
    return true;
  if (!("contentEditable" in node)) return false;
  const value = node.contentEditable;
  return value === "true" || value === "plaintext-only";
}

function notifyKeyState(): void {
  for (const listener of downListeners) listener();
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  onShortcutKeyDown(event);
}

function onDocumentKeyUp(event: KeyboardEvent): void {
  onShortcutKeyUp(event);
}

function onWindowBlur(): void {
  if (downKeys.size === 0) return;
  downKeys.clear();
  notifyKeyState();
}

function attach(): void {
  if (listening || typeof document === "undefined") return;
  document.addEventListener("keydown", onDocumentKeyDown);
  document.addEventListener("keyup", onDocumentKeyUp);
  window.addEventListener("blur", onWindowBlur);
  listening = true;
}

function detachIfIdle(): void {
  if (bindings.size > 0) return;
  if (listening && typeof document !== "undefined") {
    document.removeEventListener("keydown", onDocumentKeyDown);
    document.removeEventListener("keyup", onDocumentKeyUp);
    window.removeEventListener("blur", onWindowBlur);
  }
  listening = false;
  if (downKeys.size === 0) return;
  downKeys.clear();
  notifyKeyState();
}
