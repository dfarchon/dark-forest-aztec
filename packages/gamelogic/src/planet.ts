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
 * L = range * L_OVER_RANGE is the max reachable distance when sending 100% of energyCap.
 * Matches original Solidity DFMoveFacet: range * log2(20) ≈ range * 4.32.
 */
export const L_OVER_RANGE = 4.32;

/**
 * Piecewise linear helper: given energy percent p (0-100), returns D_max as a fraction of L.
 * Constraint points: (0,0) (25,0.5) (50,0.75) (100,1.0), connected by straight lines.
 */
export function getDMaxFraction(p: number): number {
  if (p <= 0) return 0;
  if (p <= 25) return (2 * p) / 100;
  if (p <= 50) return (25 + p) / 100;
  return (100 + p) / 200;
}

/**
 * Max reachable distance for a given energy percentage.
 * Uses piecewise linear D_max matching the Noir move contract.
 * @param rangeBoost Multiplier applied to the resulting range (e.g. for abandon boost).
 */
export function getRange(
  planet: Planet,
  percentEnergySending = 100,
  rangeBoost = 1,
): number {
  if (percentEnergySending === 0) return 0;
  return (
    planet.range *
    L_OVER_RANGE *
    getDMaxFraction(percentEnergySending) *
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
