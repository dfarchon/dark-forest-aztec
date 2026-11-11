import type { IndexerChangePayload } from "../types.ts";

export type ChangeListener = (payload: IndexerChangePayload) => void;

/**
 * Fan-out for table changes. The owner decides when a payload is worth
 * emitting; this class only stores listeners and waits on them.
 */
export class ChangeEmitter {
  private readonly listeners = new Set<ChangeListener>();

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(payload: IndexerChangePayload): void {
    for (const cb of this.listeners) {
      try {
        cb(payload);
      } catch (err) {
        console.error("[IndexerService] subscriber threw:", err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  /**
   * Resolves when `predicate` is already true or becomes true on a later emit.
   * Rejects with `timeoutError` if that does not happen within `timeoutMs`.
   */
  waitUntil(
    predicate: () => boolean,
    timeoutMs: number,
    timeoutError: Error,
  ): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let unsub = () => {};
      let timer: ReturnType<typeof setTimeout>;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        if (err) reject(err);
        else resolve();
      };
      timer = setTimeout(() => finish(timeoutError), timeoutMs);
      unsub = this.subscribe(() => {
        if (predicate()) finish();
      });
      if (predicate()) finish();
    });
  }
}
