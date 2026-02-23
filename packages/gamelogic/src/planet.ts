import { EMPTY_ADDRESS } from "@dfpunk/constants";
import { PlanetMessageType } from "@dfpunk/types";
import type {
  EmojiFlagBody,
  LocatablePlanet,
  Planet,
  PlanetMessage,
} from "@dfpunk/types";

export const getPlanetRank = (planet: Planet | undefined): number => {
  if (!planet) return 0;
  return planet.upgradeState.reduce((a: number, b: number) => a + b);
};

/**
 * Decay scale L = range * DECAY_SCALE_OVER_RANGE. Contract uses linear decay so max distance
 * matches Solidity (range * log2(20) at 100% send). Export for client energy calculations.
 */
export const DECAY_SCALE_OVER_RANGE = 455 / 100; // L/range = 91/20, matches contract decay_range_times_hundred = range*455

/**
 * Max reachable distance (matches Solidity DFMoveFacet: range * log2(20) at 100% send).
 * Contract uses linear decay with scale L = range * 455/100 so this matches.
 * popArriving > 0 when dist < L * (1 - 5/percentEnergySending) => dist < range * (455/100) * (1 - 5/percent).
 * @param rangeBoost Multiplier applied to the resulting range (e.g. for abandon boost).
 */

export function getRange(
  planet: Planet,
  percentEnergySending = 100,
  rangeBoost = 1,
): number {
  if (percentEnergySending === 0) return 0;
  return (
    Math.max(1 - 5 / percentEnergySending, 0) *
    planet.range *
    DECAY_SCALE_OVER_RANGE *
    rangeBoost
  );
}

export function hasOwner(planet: Planet): boolean {
  return planet.owner !== EMPTY_ADDRESS;
}

export function isEmojiFlagMessage(
  planetMessage: PlanetMessage<unknown>,
): planetMessage is PlanetMessage<EmojiFlagBody> {
  return (
    planetMessage.body !== undefined &&
    planetMessage.type === PlanetMessageType.EmojiFlag
  );
}

export function isLocatable(planet?: Planet): planet is LocatablePlanet {
  return (
    planet !== undefined && (planet as LocatablePlanet).location !== undefined
  );
}

/**
 * Returns the time (ms) until the next broadcast of planet coordinates is allowed.
 */
export function timeUntilNextBroadcastAvailable(
  lastRevealTimestamp: number | undefined,
  locationRevealCooldown: number,
): number {
  if (!lastRevealTimestamp) {
    return 0;
  }
  return (lastRevealTimestamp + locationRevealCooldown) * 1000 - Date.now();
}
