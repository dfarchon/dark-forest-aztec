/**
 * The fee gate: the one place that decides whether to interrupt a player about
 * fee juice, and with which story.
 *
 * The rule that shapes everything here: a player who can pay is NEVER shown a
 * wall. The gate fires only when an action has no fee source at all — no
 * sponsorship AND no own balance — and its copy depends on why:
 *
 *   "sponsorship-spent"  they were sponsored today and used it up. The gauge
 *                        shows the spent allowance and when it returns.
 *   "needs-fee-juice"    sponsorship never covered them (no paymaster, wrong
 *                        account class, no seat). Plain "you need fee juice",
 *                        no gauge — showing spent pips for an allowance they
 *                        never had would be a lie.
 *   "send-failed"        an action already failed for lack of a fee source.
 *                        Rendered as a corner toast, not a modal: the action is
 *                        already dead, a second full-screen stop punishes twice.
 *
 * Same tiny listener pattern as QuotaStatus — advisory UI state, no framework.
 */

export type FeeGateEvent =
  | {
      kind: "sponsorship-spent";
      /** How many sponsored transactions the day started with, for the gauge. */
      allowancePerDay: number;
      resetsAt: string;
      millisUntilReset: number;
    }
  | { kind: "needs-fee-juice" }
  | { kind: "send-failed" };

export type FeeGateState = FeeGateEvent | { kind: "closed" };

/** Identity for the currently displayed event, so a dismiss can only close
 *  the thing the player actually clicked away. */
export type FeeGateId = number;

let current: FeeGateState = { kind: "closed" };
let currentId: FeeGateId = 0;
let lastModalShownAt = 0;
/** Outstanding modal claims (see claimModalSlot). Counted, not boolean: two
 *  publishers racing must not have the first's completion release the second. */
let pendingModals = 0;
const listeners = new Set<(state: FeeGateState) => void>();

export function publishFeeGate(event: FeeGateEvent): FeeGateId {
  if (event.kind !== "send-failed") lastModalShownAt = Date.now();
  current = event;
  currentId = currentId + 1;
  for (const listener of listeners) listener(current);
  return currentId;
}

/** Current event's id; pass it to dismissFeeGate to close only that event. */
export function currentFeeGateId(): FeeGateId {
  return currentId;
}

export function dismissFeeGate(id?: FeeGateId): void {
  // A newer event arrived after this modal rendered: the click belongs to the
  // old one, so leave the new one standing.
  if (id !== undefined && id !== currentId) return;
  if (current.kind === "closed") return;
  current = { kind: "closed" };
  currentId = currentId + 1;
  for (const listener of listeners) listener(current);
}

/**
 * Claims a modal slot before an async publish. The release MUST run in a
 * finally — a claim that is never released would suppress every later notice.
 * A watchdog releases it anyway, because "no interruption at all" is a worse
 * failure than "one duplicate".
 */
export function claimModalSlot(watchdogMs = 8_000): () => void {
  pendingModals += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pendingModals = Math.max(0, pendingModals - 1);
  };
  setTimeout(release, watchdogMs);
  return release;
}

export function modalSlotClaimed(): boolean {
  return pendingModals > 0;
}

export function getFeeGateState(): FeeGateState {
  return current;
}

export function subscribeToFeeGate(
  listener: (state: FeeGateState) => void
): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/**
 * Whether the blocking modal fired recently enough that a follow-up
 * send-failure toast would just repeat it. The gate throw and the transaction
 * failure it causes arrive within the same second; one interruption is enough.
 */
export function feeGateModalShownRecently(withinMs = 3_000): boolean {
  // Narrow on purpose: this exists to swallow the toast that trails its OWN
  // modal by milliseconds, not to mute an unrelated failure seconds later.
  return Date.now() - lastModalShownAt < withinMs;
}
