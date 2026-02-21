/**
 * ThrottledConcurrentQueue: port of darkforest-v0.6 ThrottledConcurrentQueue.
 *
 * Executes promises with a max throughput (throttle) and optional max concurrency.
 * No external dependencies — uses a simple ring buffer instead of mnemonist.
 */

import type { ConcurrentQueueConfiguration } from "./types";

// ---------------------------------------------------------------------------
// Deferred helper (replaces p-defer)
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Ring buffer (replaces mnemonist/circular-buffer)
// ---------------------------------------------------------------------------

class RingBuffer {
  private buf: (number | undefined)[];
  private head = 0;
  private tail = 0;
  private _size = 0;
  public readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  get size(): number {
    return this._size;
  }

  push(value: number): void {
    if (this._size === this.capacity) {
      // Overwrite oldest
      this.buf[this.tail] = value;
      this.tail = (this.tail + 1) % this.capacity;
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.buf[this.tail] = value;
      this.tail = (this.tail + 1) % this.capacity;
      this._size++;
    }
  }

  shift(): number | undefined {
    if (this._size === 0) return undefined;
    const val = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this._size--;
    return val;
  }

  peekFirst(): number | undefined {
    if (this._size === 0) return undefined;
    return this.buf[this.head];
  }
}

// ---------------------------------------------------------------------------
// QueuedTask
// ---------------------------------------------------------------------------

interface QueuedTask<T, U> {
  resolve: (t: T) => void;
  reject: (e: Error | undefined) => void;
  start: () => Promise<T>;
  metadata: U | undefined;
}

// ---------------------------------------------------------------------------
// ThrottledConcurrentQueue
// ---------------------------------------------------------------------------

export interface Queue {
  add<T>(start: () => Promise<T>): Promise<T>;
  size: () => number;
}

/**
 * A queue that executes promises with a max throughput, and optionally max
 * concurrency. Port of darkforest-v0.6 ThrottledConcurrentQueue.
 */
export class ThrottledConcurrentQueue<U = unknown> implements Queue {
  private readonly invocationIntervalMs: number;
  private readonly maxConcurrency: number;
  private taskQueue: Array<QueuedTask<unknown, U>> = [];
  private executionTimestamps: RingBuffer;
  private concurrency = 0;
  private executionTimeout: ReturnType<typeof setTimeout> | undefined;

  public constructor(config: ConcurrentQueueConfiguration) {
    this.invocationIntervalMs = config.invocationIntervalMs;
    this.maxConcurrency = config.maxConcurrency ?? Number.POSITIVE_INFINITY;
    this.executionTimestamps = new RingBuffer(
      config.maxInvocationsPerIntervalMs
    );

    if (config.maxInvocationsPerIntervalMs <= 0) {
      throw new Error("must allow at least one invocation per interval");
    }
    if (this.invocationIntervalMs <= 0) {
      throw new Error("invocation interval must be positive");
    }
    if (this.maxConcurrency <= 0) {
      throw new Error("max concurrency must be positive");
    }
  }

  /**
   * Adds a task to be executed at some point in the future.
   */
  public add<T>(start: () => Promise<T>, metadata?: U): Promise<T> {
    const { resolve, reject, promise } = deferred<T>();

    this.taskQueue.unshift({
      resolve: resolve as (t: unknown) => void,
      reject,
      start,
      metadata,
    });

    setTimeout(() => {
      this.executeNextTasks();
    }, 0);

    return promise;
  }

  /**
   * Remove one task from the queue by predicate. Throws if not found.
   */
  public remove(
    predicate: (metadata: U | undefined) => boolean
  ): QueuedTask<unknown, U> {
    const foundIndex = this.taskQueue.findIndex((task) =>
      predicate(task.metadata)
    );
    if (foundIndex === -1) throw new Error("specified task was not found");
    return this.taskQueue.splice(foundIndex, 1)[0];
  }

  /**
   * Prioritize a queued task (move to end = next to execute). FILO order.
   * Throws if not found.
   */
  public prioritize(
    predicate: (metadata: U | undefined) => boolean
  ): QueuedTask<unknown, U> {
    const foundIndex = this.taskQueue.findIndex((task) =>
      predicate(task.metadata)
    );
    if (foundIndex === -1) throw new Error("specified task was not found");
    const foundTask = this.taskQueue.splice(foundIndex, 1)[0];
    this.taskQueue.push(foundTask);
    return foundTask;
  }

  /**
   * Returns the amount of queued items (not including currently executing).
   */
  public size(): number {
    return this.taskQueue.length;
  }

  /**
   * Clear all pending tasks and cancel scheduled execution.
   */
  public destroy(): void {
    if (this.executionTimeout) {
      clearTimeout(this.executionTimeout);
      this.executionTimeout = undefined;
    }
    this.taskQueue = [];
  }

  private async executeNextTasks(): Promise<void> {
    this.deleteOutdatedExecutionTimestamps();

    const tasksToExecute = Math.min(
      this.throttleQuotaRemaining(),
      this.concurrencyQuotaRemaining(),
      this.taskQueue.length
    );

    for (let i = 0; i < tasksToExecute; i++) {
      this.next().then(this.executeNextTasks.bind(this));
    }

    const nextPossible = this.nextPossibleExecution();

    if (this.taskQueue.length > 0 && nextPossible) {
      if (this.executionTimeout) {
        clearTimeout(this.executionTimeout);
      }
      this.executionTimeout = setTimeout(
        this.executeNextTasks.bind(this),
        nextPossible
      );
    }
  }

  private nextPossibleExecution(): number | undefined {
    const oldest = this.executionTimestamps.peekFirst();
    if (!oldest || this.concurrencyQuotaRemaining() === 0) return undefined;
    return Date.now() - oldest + this.invocationIntervalMs;
  }

  private concurrencyQuotaRemaining(): number {
    return this.maxConcurrency - this.concurrency;
  }

  private throttleQuotaRemaining(): number {
    return this.executionTimestamps.capacity - this.executionTimestamps.size;
  }

  private deleteOutdatedExecutionTimestamps(): void {
    const now = Date.now();
    let oldest = this.executionTimestamps.peekFirst();
    while (oldest && oldest < now - this.invocationIntervalMs) {
      this.executionTimestamps.shift();
      oldest = this.executionTimestamps.peekFirst();
    }
  }

  private async next(): Promise<void> {
    const task = this.taskQueue.pop();
    if (!task) return;

    this.executionTimestamps.push(Date.now());
    this.concurrency++;

    try {
      task.resolve(await task.start());
    } catch (e) {
      task.reject(e as Error);
    }

    this.concurrency--;
  }
}
