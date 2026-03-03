/**
 * Debounce helper (mirrors EthConnection usage: leading + trailing).
 * Use for block processing so we don't hammer the node/API on every new block.
 */

export type DebouncedFn<T extends unknown[]> = (...args: T) => void;

/**
 * Debounce a function.
 * @param fn - function to debounce
 * @param waitMs - delay in ms
 * @param leading - invoke on first call
 * @param trailing - invoke after waitMs when calls stop
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  waitMs: number,
  leading: boolean,
  trailing: boolean,
): DebouncedFn<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: T | undefined;
  let leadingDone = false;

  function invoke(args: T) {
    lastArgs = undefined;
    leadingDone = true;
    fn(...args);
  }

  function run(...args: T) {
    lastArgs = args;
    if (leading && !leadingDone) {
      invoke(args);
    }
    if (trailing) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        if (lastArgs !== undefined) invoke(lastArgs);
      }, waitMs);
    }
  }

  return run;
}
