/**
 * Functions for determining properties of objects from their hex ID
 * (e.g. planet bonuses from LocationId).
 *
 * @packageDocumentation
 */
import type { LocationId, Planet, PlanetBonus } from "@dfpunk/world-types";

/**
 * Extracts a range of bytes from a hex string as a big integer.
 *
 * @param hexStr Hex string (e.g. LocationID, no 0x prefix).
 * @param startByte First byte index to include.
 * @param endByte Byte index after the last byte to include.
 */
export function getBytesFromHex(
  hexStr: string,
  startByte: number,
  endByte: number,
): bigint {
  const byteString = hexStr.substring(2 * startByte, 2 * endByte);
  return BigInt("0x" + byteString);
}

const bonusById = new Map<LocationId, PlanetBonus>();

/**
 * Extracts the bonuses of a planet from its LocationID.
 *
 * @param hex LocationID of the planet.
 */
export function bonusFromHex(hex: LocationId): PlanetBonus {
  const bonus = bonusById.get(hex);
  if (bonus) return bonus;

  const newBonus = Array(6).fill(false) as PlanetBonus;

  for (let i = 0; i < newBonus.length; i++) {
    newBonus[i] = getBytesFromHex(hex, 9 + i, 10 + i) < 16n;
  }

  bonusById.set(hex, newBonus);
  return newBonus;
}

/**
 * Returns whether the planet's LocationID indicates any bonuses.
 *
 * @param planet Planet to check.
 */
export function planetHasBonus(planet?: Planet): boolean {
  if (!planet) return false;
  return bonusFromHex(planet.locationId).some((b) => b);
}
