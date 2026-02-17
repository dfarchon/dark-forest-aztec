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
 * Compute effective range for a planet given percent energy sending.
 * @param rangeBoost Multiplier applied to the resulting range (e.g. for abandon boost).
 */
export function getRange(
  planet: Planet,
  percentEnergySending = 100,
  rangeBoost = 1,
): number {
  if (percentEnergySending === 0) return 0;
  return (
    Math.max(Math.log2(percentEnergySending / 5), 0) * planet.range * rangeBoost
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
