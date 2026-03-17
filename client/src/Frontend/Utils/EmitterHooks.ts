import { Callback, Monomitter } from "@dfpunk/events";
import React, { useEffect, useState } from "react";

import { Wrapper } from "../../Backend/Utils/Wrapper";

/**
 * Execute something on emitter callback
 * @param emitter `Monomitter` to subscribe to
 * @param callback callback to subscribe
 */
export function useEmitterSubscribe<T>(
  emitter: Monomitter<T>,
  callback: Callback<T>,
  deps: React.DependencyList
) {
  useEffect(
    () => {
      return emitter.subscribe(callback).unsubscribe;
    },
    // Disable exhaustive because we don't change if the callback changes, only deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      emitter,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ...deps,
    ]
  );
}

/**
 * Schedules a setState so it never runs during another component's render.
 * Prevents "Cannot update a component while rendering a different component" warnings
 * when emitters publish synchronously during render.
 */
function scheduleSetState<T, V extends T>(
  setVal: React.Dispatch<React.SetStateAction<T>>,
  value: V
): void {
  queueMicrotask(() => setVal(value as T));
}

/**
 * Use returned value from an emitter
 * @param emitter `Monomitter` to subscribe to
 * @param initialVal initial state value
 */
export function useEmitterValue<T>(
  emitter: Monomitter<T>,
  initialVal: T | undefined
): T | undefined {
  const [val, setVal] = useState<T | undefined>(initialVal);

  useEffect(() => {
    const sub = emitter.subscribe((v) => scheduleSetState(setVal, v));

    return sub.unsubscribe;
  }, [emitter]);

  return val;
}

/**
 * Use returned value from an emitter, and clone the reference - used to force an update to the UI
 * @param emitter `Monomitter` to subscribe to
 * @param initialVal initial state value
 */
export function useWrappedEmitter<T>(
  emitter: Monomitter<T | undefined>,
  initialVal: T | undefined
): Wrapper<T | undefined> {
  const [val, setVal] = useState<Wrapper<T | undefined>>(
    new Wrapper(initialVal)
  );

  useEffect(() => {
    const sub = emitter.subscribe((v) => {
      scheduleSetState(setVal, new Wrapper(v));
    });

    return sub.unsubscribe;
  }, [emitter]);

  return val;
}
