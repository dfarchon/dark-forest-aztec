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

let current: FeeGateState = { kind: "closed" };
let lastModalShownAt = 0;
const listeners = new Set<(state: FeeGateState) => void>();

export function publishFeeGate(event: FeeGateEvent): void {
  if (event.kind !== "send-failed") lastModalShownAt = Date.now();
  current = event;
  for (const listener of listeners) listener(current);
}

export function dismissFeeGate(): void {
  current = { kind: "closed" };
  for (const listener of listeners) listener(current);
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
export function feeGateModalShownRecently(withinMs = 10_000): boolean {
  return Date.now() - lastModalShownAt < withinMs;
}
