import type { QueuedArrival } from "../world/arrival";

/**
 * Convenience type for storing a voyage and a reference to a timeout that is triggered on voyage
 * arrival (in case the timeout needs to be cancelled).
 */
export interface ArrivalWithTimer {
  arrivalData: QueuedArrival;
  /** Null when arrival is applied only via flushMaturedArrivals on block ticks. */
  timer: ReturnType<typeof setTimeout> | null;
}
