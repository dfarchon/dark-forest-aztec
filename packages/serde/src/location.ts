import { LOCATION_ID_UB } from "@dfpunk/constants";
import type { LocationId } from "@dfpunk/types";
/**
 * Converts a possibly 0x-prefixed string of hex digits to a `LocationId`: a
 * non-0x-prefixed all lowercase hex string of exactly 64 hex characters
 * (0-padded if necessary). LocationIDs should only be instantiated through
 * `locationIdFromHexStr`, `locationIdFromDecStr`, `locationIdFromBigInt`, and
 * `locationIdFromEthersBN`.
 *
 * @param location A possibly 0x-prefixed `string` of hex digits representing a
 * location ID.
 */
export function locationIdFromHexStr(location: string) {
  const locationBI = BigInt(
    location.startsWith("0x") ? location : "0x" + location,
  );
  if (locationBI >= BigInt(LOCATION_ID_UB))
    throw new Error("not a valid location");
  let ret = locationBI.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as LocationId;
}

/**
 * Converts a string representing a decimal number into a LocationID: a
 * non-0x-prefixed all lowercase hex string of exactly 64 hex characters
 * (0-padded if necessary). LocationIDs should only be instantiated through
 * `locationIdFromHexStr`, `locationIdFromDecStr`, `locationIdFromBigInt`, and
 * `locationIdFromEthersBN`.
 *
 * @param location `string` of decimal digits, the base 10 representation of a
 * location ID.
 */
export function locationIdFromDecStr(location: string) {
  const locationBI = BigInt(location);
  if (locationBI >= BigInt(LOCATION_ID_UB))
    throw new Error("not a valid location");
  let ret = locationBI.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as LocationId;
}

/**
 * Converts a bigint representation of location ID into a LocationID: a
 * non-0x-prefixed all lowercase hex string of exactly 64 hex characters
 * (0-padded). LocationIDs should only be instantiated through
 * `locationIdFromHexStr`, `locationIdFromDecStr`, `locationIdFromBigInt`, and
 * `locationIdFromEthersBN`.
 *
 * @param location `bigint` representation of a location ID.
 */
export function locationIdFromBigInt(location: bigint): LocationId {
  const locationBI = BigInt(location);
  if (locationBI >= BigInt(LOCATION_ID_UB))
    throw new Error("not a valid location");
  let ret = locationBI.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as LocationId;
}

/**
 * Converts an ethers.js BigNumber (type aliased here as `EthersBN`)
 * representation of a location ID into a LocationID: a non-0x-prefixed all
 * lowercase hex string of exactly 64 hex characters (0-padded). LocationIDs
 * should only be instantiated through `locationIdFromHexStr`,
 * `locationIdFromDecStr`, `locationIdFromBigInt`, and `locationIdFromEthersBN`.
 *
 * @param location ethers.js `BigNumber` representation of a locationID.
 */
// export function locationIdFromEthersBN(location: EthersBN): LocationId {
//   return locationIdFromDecStr(location.toString());
// }

/**
 * Converts a LocationID to a decimal string with the same numerical value; can
 * be used if you need to pass an artifact ID into a web3 call.
 *
 * @param locationId LocationID to convert into a `string` of decimal digits
 */
export function locationIdToDecStr(locationId: LocationId): string {
  return BigInt("0x" + locationId).toString(10);
}
