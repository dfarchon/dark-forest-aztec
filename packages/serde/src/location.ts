import { LOCATION_ID_UB } from "@dfpunk/constants";
import type { LocationId } from "@dfpunk/types";

/**
 * Converts a possibly 0x-prefixed hex string to a LocationId: non-0x-prefixed
 * lowercase hex string of exactly 64 hex characters (0-padded if necessary).
 */
export function locationIdFromHexStr(location: string): LocationId {
  const locationBI = BigInt(
    location.startsWith("0x") ? location : "0x" + location,
  );
  if (locationBI >= LOCATION_ID_UB) throw new Error("not a valid location");
  let ret = locationBI.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as LocationId;
}

/**
 * Converts a decimal string to a LocationId: non-0x-prefixed lowercase hex
 * string of exactly 64 hex characters (0-padded if necessary).
 */
export function locationIdFromDecStr(location: string): LocationId {
  const locationBI = BigInt(location);
  if (locationBI >= LOCATION_ID_UB) throw new Error("not a valid location");
  let ret = locationBI.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as LocationId;
}

/**
 * Converts a bigint to a LocationId: non-0x-prefixed lowercase hex string
 * of exactly 64 hex characters (0-padded if necessary).
 */
export function locationIdFromBigInt(location: bigint): LocationId {
  if (location >= LOCATION_ID_UB) throw new Error("not a valid location");
  let ret = location.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as LocationId;
}

/**
 * Accepts a chain/field value (bigint or string) and returns a LocationId.
 */
export function locationIdFromField(f: bigint | string): LocationId {
  if (typeof f === "bigint") return locationIdFromBigInt(f);
  const s = String(f);
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

/**
 * Converts a LocationId to a decimal string.
 */
export function locationIdToDecStr(locationId: LocationId): string {
  return BigInt("0x" + locationId).toString(10);
}
