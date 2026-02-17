import { LOCATION_ID_UB } from "@dfpunk/constants";
import type { RevealedCoords } from "@dfpunk/types";
import { address } from "./address";
import { locationIdFromHexStr, locationIdFromDecStr } from "./location";
import type { PlanetRevealedCoordsState } from "./chain_state";

const HALF_UB = LOCATION_ID_UB / 2n;

function toSignedNumber(s: string): number {
  let n = BigInt(s);
  if (n > HALF_UB) n = n - LOCATION_ID_UB;
  return Number(n);
}

function toLocationId(s: string) {
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

/**
 * Decodes chain state (key + PlanetRevealedCoordsState) into RevealedCoords (see @dfpunk/types).
 * key is the location id string; state.x and state.y are residue mod p, converted to signed number.
 */
export function decodePlanetRevealedCoords(
  key: string,
  state: PlanetRevealedCoordsState,
): RevealedCoords {
  const hash = toLocationId(state.location_id);
  return {
    hash,
    x: toSignedNumber(state.x),
    y: toSignedNumber(state.y),
    revealer: address(state.revealer),
  };
}
