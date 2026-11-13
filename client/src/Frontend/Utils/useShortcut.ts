import { useEffect, useRef, useState } from "react";

import {
  isShortcutKeyDown,
  registerShortcut,
  subscribeShortcutKeys,
} from "./ShortcutRegistry";

/**
 * Register a shortcut for as long as this component is mounted and `enabled`.
 * `onUp` runs on keyup. Pass `modalId` so the binding only wins while that modal is active.
 */
export function useShortcut(
  key: string | readonly string[],
  onUp: (key: string) => void,
  options?: { modalId?: string; enabled?: boolean }
): void {
  const enabled = options?.enabled !== false;
  const modalId = options?.modalId;
  const onUpRef = useRef(onUp);
  onUpRef.current = onUp;

  const keys = typeof key === "string" ? [key] : key;
  const registrationKey = keys.join("\0");

  useEffect(() => {
    if (!enabled || registrationKey.length === 0) return;
    return registerShortcut(
      registrationKey.split("\0"),
      (pressed) => onUpRef.current(pressed),
      { modalId }
    );
  }, [enabled, modalId, registrationKey]);
}

/** True while `key` is held and the press was not ignored. */
export function useShortcutKeyDown(key: string | undefined): boolean {
  const [down, setDown] = useState(false);

  useEffect(() => {
    if (!key) return;
    const sync = () => setDown(isShortcutKeyDown(key));
    sync();
    return subscribeShortcutKeys(sync);
  }, [key]);

  return key ? down : false;
}
