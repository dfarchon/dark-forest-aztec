/**
 * Human durations for player-facing copy.
 *
 * "resets in 3 hours" is something a player can act on. A timestamp, a
 * countdown to the second, or "00:00 UTC" all make them do arithmetic to answer
 * the only question they actually have: is it worth waiting?
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Rounds a duration to the coarsest unit that is still useful, and never
 * pretends to precision it does not have.
 *
 * Deliberately vague near zero: "in under a minute" beats "in 3 seconds",
 * which invites a player to sit and watch a number.
 */
export function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "any moment now";
  if (ms < MINUTE) return "under a minute";

  if (ms < HOUR) {
    const minutes = Math.round(ms / MINUTE);
    return minutes === 1 ? "a minute" : `${minutes} minutes`;
  }

  const hours = ms / HOUR;
  // Below three hours, half-hours are worth showing: "1.5 hours" is the
  // difference between waiting and going to do something else.
  if (hours < 3) {
    const halves = Math.round(hours * 2) / 2;
    if (halves === 1) return "an hour";
    return Number.isInteger(halves) ? `${halves} hours` : `${halves} hours`;
  }

  const rounded = Math.round(hours);
  return rounded === 24 ? "a day" : `${rounded} hours`;
}

/** "resets in 3 hours" — the phrase most copy actually wants. */
export function resetsIn(ms: number): string {
  return `resets in ${humanizeDuration(ms)}`;
}
